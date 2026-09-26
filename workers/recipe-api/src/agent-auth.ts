import {
  agentAuth,
  type AgentAuthEvent,
  type AgentSession,
  type Capability,
} from "@better-auth/agent-auth";
import { APIError } from "better-auth";
import { and, desc, eq, ilike, or } from "drizzle-orm";
import type { Db } from "recipe-db";
import * as schema from "recipe-db/schema";
import { RECIPE_VISIBILITIES } from "recipe-domain/visibility";
import { z } from "zod";
import {
  cookingInsightsResponse,
  cookingLogResponse,
  decodeCookingLogCursor,
} from "./cooking-reads";
import { MAX_PANTRY_ITEMS, readPantry } from "./pantry";
import { readableRecipeFilter } from "./recipe-access";
import { inspectRecipeDataset } from "./recipe-dataset";

const READ_GRANT_TTL_SECONDS = 30 * 24 * 60 * 60;
const MAX_AGENT_LIFETIME_SECONDS = 30 * 24 * 60 * 60;
const MAX_COOK_LOG_RANGE_MS = 90 * 24 * 60 * 60 * 1_000;
const AGENT_AUTH_PROVIDER_NAME = "Robbie's Recipes";
const AGENT_AUTH_PROVIDER_DESCRIPTION =
  "Delegated access to recipes and personal cooking data.";
const AGENT_AUTH_MODES = ["delegated"] as const;
const AGENT_AUTH_APPROVAL_METHODS = ["device_authorization"] as const;

export function recipeAgentConfiguration(baseUrl: string) {
  const issuer = `${new URL(baseUrl).origin}/api/auth`;
  const paths = {
    register: "/agent/register",
    capabilities: "/capability/list",
    describe_capability: "/capability/describe",
    execute: "/capability/execute",
    request_capability: "/agent/request-capability",
    status: "/agent/status",
    reactivate: "/agent/reactivate",
    revoke: "/agent/revoke",
    revoke_host: "/host/revoke",
    rotate_key: "/agent/rotate-key",
    rotate_host_key: "/host/rotate-key",
    introspect: "/agent/introspect",
  };
  const endpoints = Object.fromEntries(
    Object.entries(paths).map(([name, path]) => [name, `${issuer}${path}`]),
  );

  return {
    version: "1.0-draft",
    provider_name: AGENT_AUTH_PROVIDER_NAME,
    description: AGENT_AUTH_PROVIDER_DESCRIPTION,
    issuer,
    default_location: endpoints.execute,
    algorithms: ["Ed25519"],
    modes: [...AGENT_AUTH_MODES],
    approval_methods: [...AGENT_AUTH_APPROVAL_METHODS],
    endpoints,
  };
}

const recipeSearchInput = z
  .object({
    query: z.string().trim().min(1).max(200),
    limit: z.number().int().min(1).max(25).default(10),
  })
  .strict();

const recipeReadInput = z
  .object({
    slug: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  })
  .strict();

const recipeDatasetInspectInput = z
  .object({
    sampleSize: z.number().int().min(1).max(200).default(100),
    top: z.number().int().min(1).max(25).default(10),
  })
  .strict();

const cookLogReadInput = z
  .object({
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
    limit: z.number().int().min(1).max(50).default(20),
    cursor: z
      .string()
      .max(500)
      .refine((value) => decodeCookingLogCursor(value) !== undefined, {
        message: "Cursor is invalid",
      })
      .optional(),
  })
  .strict();

const noArgumentsInput = z.object({}).strict();

function cookingLogQuery(input: z.infer<typeof cookLogReadInput>) {
  const cursor = decodeCookingLogCursor(input.cursor);
  let to = input.to ? new Date(input.to) : new Date();
  let from = input.from
    ? new Date(input.from)
    : new Date(to.getTime() - MAX_COOK_LOG_RANGE_MS);

  if (cursor) {
    const cursorFrom = new Date(cursor.from);
    const cursorTo = new Date(cursor.to);
    const conflictsWithFrom =
      input.from !== undefined &&
      new Date(input.from).getTime() !== cursorFrom.getTime();
    const conflictsWithTo =
      input.to !== undefined &&
      new Date(input.to).getTime() !== cursorTo.getTime();
    if (conflictsWithFrom || conflictsWithTo) {
      throw new Error("Cursor does not match the requested date range");
    }
    from = cursorFrom;
    to = cursorTo;
  }

  if (from > to) {
    throw new APIError("BAD_REQUEST", { message: "from must not be after to" });
  }
  if (to.getTime() - from.getTime() > MAX_COOK_LOG_RANGE_MS) {
    throw new APIError("BAD_REQUEST", {
      message: "Cook log range must not exceed 90 days",
    });
  }

  return { from, to, limit: input.limit, cursor };
}

const recipeSummarySchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "slug",
    "title",
    "description",
    "visibility",
    "owned",
    "updatedAt",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    slug: { type: "string" },
    title: { type: "string" },
    description: { type: ["string", "null"] },
    visibility: { enum: RECIPE_VISIBILITIES },
    owned: { type: "boolean" },
    updatedAt: { type: "string", format: "date-time" },
  },
} as const;

const completedCookingSessionSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "recipeSlug",
    "recipeTitle",
    "servings",
    "completedAt",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    recipeSlug: { type: "string" },
    recipeTitle: { type: "string" },
    servings: { type: "integer", minimum: 1 },
    completedAt: { type: "string", format: "date-time" },
  },
} as const;

const pantrySnapshotSchema = {
  type: "object",
  additionalProperties: false,
  required: ["resourceId", "scope", "revision", "stock", "itemVersions"],
  properties: {
    resourceId: { type: "string" },
    scope: { enum: ["personal", "household"] },
    revision: { type: "string", pattern: "^[0-9]+$" },
    stock: {
      type: "object",
      maxProperties: MAX_PANTRY_ITEMS,
      additionalProperties: { enum: schema.pantryLocationEnum.enumValues },
    },
    itemVersions: {
      type: "object",
      maxProperties: MAX_PANTRY_ITEMS,
      additionalProperties: { type: "string", pattern: "^[0-9]+$" },
    },
  },
} as const;

const recipeDatasetInspectionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["population", "visibility", "sample"],
  properties: {
    population: {
      type: "object",
      additionalProperties: false,
      description:
        "Exact visible count and the size of the most recently updated sample inspected for detailed statistics.",
      required: ["visibleRecipes", "sampledRecipes", "truncated"],
      properties: {
        visibleRecipes: { type: "integer", minimum: 0 },
        sampledRecipes: { type: "integer", minimum: 0, maximum: 200 },
        truncated: { type: "boolean" },
      },
    },
    visibility: {
      type: "object",
      additionalProperties: false,
      required: ["public", "household", "private"],
      properties: {
        public: { type: "integer", minimum: 0 },
        household: { type: "integer", minimum: 0 },
        private: { type: "integer", minimum: 0 },
      },
    },
    sample: {
      type: "object",
      additionalProperties: false,
      description:
        "Statistics from the bounded, most recently updated recipe sample. No recipe body or canonical URL is returned.",
      required: [
        "parseQuality",
        "provenance",
        "coverage",
        "ingredients",
        "cuisines",
      ],
      properties: {
        parseQuality: {
          type: "object",
          additionalProperties: false,
          required: ["validPayloads", "invalidPayloads", "withInstructionSdk"],
          properties: {
            validPayloads: { type: "integer", minimum: 0 },
            invalidPayloads: { type: "integer", minimum: 0 },
            withInstructionSdk: { type: "integer", minimum: 0 },
          },
        },
        provenance: {
          type: "object",
          additionalProperties: false,
          required: ["withCanonicalUrl", "withoutCanonicalUrl"],
          properties: {
            withCanonicalUrl: { type: "integer", minimum: 0 },
            withoutCanonicalUrl: { type: "integer", minimum: 0 },
          },
        },
        coverage: {
          type: "object",
          additionalProperties: false,
          required: ["withCuisine", "withIngredients", "withCookware"],
          properties: {
            withCuisine: { type: "integer", minimum: 0 },
            withIngredients: { type: "integer", minimum: 0 },
            withCookware: { type: "integer", minimum: 0 },
          },
        },
        ingredients: {
          type: "object",
          additionalProperties: false,
          required: ["distinct", "top"],
          properties: {
            distinct: { type: "integer", minimum: 0 },
            top: {
              type: "array",
              maxItems: 25,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["ingredient", "recipeCount"],
                properties: {
                  ingredient: { type: "string" },
                  recipeCount: { type: "integer", minimum: 1 },
                },
              },
            },
          },
        },
        cuisines: {
          type: "object",
          additionalProperties: false,
          required: ["distinct", "top"],
          properties: {
            distinct: { type: "integer", minimum: 0 },
            top: {
              type: "array",
              maxItems: 25,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["cuisine", "recipeCount"],
                properties: {
                  cuisine: { type: "string" },
                  recipeCount: { type: "integer", minimum: 1 },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

const shoppingListSnapshotSchema = {
  type: "object",
  additionalProperties: false,
  required: ["recipes", "checked", "extras"],
  properties: {
    recipes: {
      type: "array",
      maxItems: 200,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["slug"],
        properties: {
          slug: { type: "string", minLength: 1, maxLength: 200 },
          servings: { type: "integer", minimum: 1, maximum: 1_000 },
        },
      },
    },
    checked: {
      type: "array",
      maxItems: 1_000,
      items: { type: "string", minLength: 1, maxLength: 200 },
    },
    extras: {
      type: "array",
      maxItems: 500,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "text", "checked"],
        properties: {
          id: { type: "string", minLength: 1, maxLength: 200 },
          text: { type: "string", minLength: 1, maxLength: 500 },
          checked: { type: "boolean" },
        },
      },
    },
  },
} as const;

export const RECIPE_SITE_AGENT_CAPABILITIES = [
  {
    name: "recipes.search",
    description:
      "Search recipes visible to the delegated user by title, description, ingredient, or instruction text.",
    approvalStrength: "session",
    grantTTL: READ_GRANT_TTL_SECONDS,
    input: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: { type: "string", minLength: 1, maxLength: 200 },
        limit: { type: "integer", minimum: 1, maximum: 25, default: 10 },
      },
    },
    output: {
      type: "object",
      additionalProperties: false,
      required: ["items"],
      properties: {
        items: { type: "array", maxItems: 25, items: recipeSummarySchema },
      },
    },
  },
  {
    name: "recipes.read",
    description:
      "Read one recipe visible to the delegated user, including its Cooklang body.",
    approvalStrength: "session",
    grantTTL: READ_GRANT_TTL_SECONDS,
    input: {
      type: "object",
      additionalProperties: false,
      required: ["slug"],
      properties: {
        slug: {
          type: "string",
          minLength: 1,
          maxLength: 120,
          pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
        },
      },
    },
    output: {
      type: "object",
      additionalProperties: false,
      required: ["recipe"],
      properties: {
        recipe: {
          anyOf: [
            {
              ...recipeSummarySchema,
              required: [...recipeSummarySchema.required, "body"],
              properties: {
                ...recipeSummarySchema.properties,
                body: { type: ["string", "null"] },
              },
            },
            { type: "null" },
          ],
        },
      },
    },
  },
  {
    name: "recipes.dataset.inspect",
    description:
      "Inspect aggregate coverage, provenance, parse quality, ingredients, and cuisines for recipes visible to the delegated user.",
    approvalStrength: "session",
    grantTTL: READ_GRANT_TTL_SECONDS,
    input: {
      type: "object",
      additionalProperties: false,
      properties: {
        sampleSize: {
          type: "integer",
          minimum: 1,
          maximum: 200,
          default: 100,
          description:
            "Number of the most recently updated visible recipes to inspect in detail.",
        },
        top: {
          type: "integer",
          minimum: 1,
          maximum: 25,
          default: 10,
          description:
            "Maximum ingredient and cuisine frequency rows to return.",
        },
      },
    },
    output: recipeDatasetInspectionSchema,
  },
  {
    name: "pantry.read",
    description:
      "Read the current pantry belonging to the delegated user or their household, including item versions for conflict detection.",
    approvalStrength: "session",
    grantTTL: READ_GRANT_TTL_SECONDS,
    input: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
    output: pantrySnapshotSchema,
  },
  {
    name: "shopping_list.read",
    description:
      "Read the current shopping list belonging to the delegated user or their household.",
    approvalStrength: "session",
    grantTTL: READ_GRANT_TTL_SECONDS,
    input: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
    output: {
      type: "object",
      additionalProperties: false,
      required: ["shoppingList"],
      properties: {
        shoppingList: {
          anyOf: [
            {
              type: "object",
              additionalProperties: false,
              required: [
                "id",
                "resourceId",
                "scope",
                "revision",
                "snapshot",
                "createdAt",
                "updatedAt",
              ],
              properties: {
                id: { type: "string", format: "uuid" },
                resourceId: { type: "string" },
                scope: { enum: ["personal", "household"] },
                revision: { type: "string", pattern: "^[0-9]+$" },
                snapshot: shoppingListSnapshotSchema,
                createdAt: { type: "string", format: "date-time" },
                updatedAt: { type: "string", format: "date-time" },
              },
            },
            { type: "null" },
          ],
        },
      },
    },
  },
  {
    name: "cook_log.read",
    description:
      "Read the delegated user's completed cooking sessions within a bounded date range.",
    approvalStrength: "session",
    grantTTL: READ_GRANT_TTL_SECONDS,
    input: {
      type: "object",
      additionalProperties: false,
      properties: {
        from: { type: "string", format: "date-time" },
        to: { type: "string", format: "date-time" },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
        cursor: { type: "string", maxLength: 500 },
      },
    },
    output: {
      type: "object",
      additionalProperties: false,
      required: ["items", "nextCursor"],
      properties: {
        items: {
          type: "array",
          maxItems: 50,
          items: completedCookingSessionSchema,
        },
        nextCursor: { type: ["string", "null"] },
      },
    },
  },
  {
    name: "cooking_insights.read",
    description:
      "Read server-computed cooking totals and the delegated user's recent completed sessions.",
    approvalStrength: "session",
    grantTTL: READ_GRANT_TTL_SECONDS,
    input: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
    output: {
      type: "object",
      additionalProperties: false,
      required: [
        "cookModeStarts",
        "mealsCooked",
        "distinctRecipesCooked",
        "recent",
      ],
      properties: {
        cookModeStarts: { type: "integer", minimum: 0 },
        mealsCooked: { type: "integer", minimum: 0 },
        distinctRecipesCooked: { type: "integer", minimum: 0 },
        recent: {
          type: "array",
          maxItems: 20,
          items: {
            ...completedCookingSessionSchema,
            required: [
              ...completedCookingSessionSchema.required,
              "startedAt",
            ],
            properties: {
              ...completedCookingSessionSchema.properties,
              startedAt: { type: "string", format: "date-time" },
              completedAt: {
                type: ["string", "null"],
                format: "date-time",
              },
            },
          },
        },
      },
    },
  },
] satisfies Capability[];

export function escapedLikePattern(value: string): string {
  const escape = String.fromCodePoint(92);
  const escaped = value
    .replaceAll(escape, escape.repeat(2))
    .replaceAll("%", escape + "%")
    .replaceAll("_", escape + "_");
  return "%" + escaped + "%";
}

function recipeSummary(
  recipe: typeof schema.recipe.$inferSelect,
  userId: string,
) {
  return {
    id: recipe.id,
    slug: recipe.slug,
    title: recipe.title,
    description: recipe.description,
    visibility: recipe.visibility,
    owned: recipe.userId === userId,
    updatedAt: recipe.updatedAt,
  };
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing function predates the complexity limit; new violations remain prohibited.
export async function executeRecipeAgentCapability(
  db: Db,
  capability: string,
  args: Record<string, unknown> | undefined,
  agentSession: AgentSession,
) {
  const userId = agentSession.user.id;

  if (capability === "recipes.search") {
    const visibility = await readableRecipeFilter(db, userId);
    const input = recipeSearchInput.parse(args ?? {});
    const pattern = escapedLikePattern(input.query);
    const recipes = await db
      .select()
      .from(schema.recipe)
      .where(
        and(
          visibility,
          or(
            ilike(schema.recipe.title, pattern),
            ilike(schema.recipe.description, pattern),
            ilike(schema.recipe.body, pattern),
          ),
        ),
      )
      .orderBy(desc(schema.recipe.updatedAt), desc(schema.recipe.id))
      .limit(input.limit);

    return { items: recipes.map((recipe) => recipeSummary(recipe, userId)) };
  }

  if (capability === "recipes.read") {
    const visibility = await readableRecipeFilter(db, userId);
    const input = recipeReadInput.parse(args ?? {});
    const [recipe] = await db
      .select()
      .from(schema.recipe)
      .where(and(visibility, eq(schema.recipe.slug, input.slug)))
      .limit(1);

    return {
      recipe: recipe
        ? { ...recipeSummary(recipe, userId), body: recipe.body }
        : null,
    };
  }

  if (capability === "recipes.dataset.inspect") {
    const input = recipeDatasetInspectInput.parse(args ?? {});
    return inspectRecipeDataset(db, userId, input);
  }

  if (capability === "pantry.read") {
    noArgumentsInput.parse(args ?? {});
    const pantry = await readPantry(db, userId);
    return { ...pantry, scope: pantry.scope.type };
  }

  if (capability === "shopping_list.read") {
    noArgumentsInput.parse(args ?? {});
    const [membership] = await db
      .select({ organizationId: schema.member.organizationId })
      .from(schema.member)
      .where(eq(schema.member.userId, userId))
      .limit(1);
    const scope = membership ? "household" : "personal";
    const resourceId = membership?.organizationId ?? userId;
    const ownerFilter = membership
      ? eq(schema.shoppingList.organizationId, membership.organizationId)
      : eq(schema.shoppingList.userId, userId);
    const [shoppingList] = await db
      .select()
      .from(schema.shoppingList)
      .where(
        and(ownerFilter, eq(schema.shoppingList.status, "active")),
      )
      .limit(1);

    return {
      shoppingList: shoppingList
        ? {
            id: shoppingList.id,
            resourceId,
            scope,
            revision: shoppingList.revision.toString(),
            snapshot: shoppingList.snapshot,
            createdAt: shoppingList.createdAt.toISOString(),
            updatedAt: shoppingList.updatedAt.toISOString(),
          }
        : null,
    };
  }

  if (capability === "cook_log.read") {
    const input = cookLogReadInput.parse(args ?? {});
    return cookingLogResponse(db, userId, cookingLogQuery(input));
  }

  if (capability === "cooking_insights.read") {
    noArgumentsInput.parse(args ?? {});
    return cookingInsightsResponse(db, userId);
  }

  throw new Error(`Unsupported agent capability: ${capability}`);
}

async function writeAgentAuthAuditEvent(db: Db, event: AgentAuthEvent) {
  let userId: string | undefined;
  if (event.type === "capability.executed") {
    userId = event.userId;
  } else if (event.actorType === "user") {
    userId = event.actorId;
  }

  await db.insert(schema.agentAuthAuditEvent).values({
    eventType: event.type,
    actorType: event.actorType,
    actorId: event.actorId,
    userId,
    agentId: event.agentId,
    hostId: event.hostId,
    targetType: event.targetType,
    targetId: event.targetId,
    capability:
      event.type === "capability.executed" ? event.capability : undefined,
    outcome: event.type === "capability.executed" ? event.status : undefined,
    durationMs:
      event.type === "capability.executed" ? event.durationMs : undefined,
  });
}

export function createRecipeAgentAuthPlugin(db: Db) {
  return agentAuth({
    providerName: AGENT_AUTH_PROVIDER_NAME,
    providerDescription: AGENT_AUTH_PROVIDER_DESCRIPTION,
    modes: [...AGENT_AUTH_MODES],
    approvalMethods: [...AGENT_AUTH_APPROVAL_METHODS],
    deviceAuthorizationPage: "/recipes/settings/agents/approve",
    capabilities: RECIPE_SITE_AGENT_CAPABILITIES,
    validateCapabilities: (capabilities) =>
      capabilities.every((name) =>
        RECIPE_SITE_AGENT_CAPABILITIES.some(
          (capability) => capability.name === name,
        ),
      ),
    allowDynamicHostRegistration: false,
    defaultHostCapabilities: [],
    jwtMaxAge: 60,
    agentSessionTTL: MAX_AGENT_LIFETIME_SECONDS,
    agentMaxLifetime: MAX_AGENT_LIFETIME_SECONDS,
    absoluteLifetime: 90 * 24 * 60 * 60,
    // Better Auth checks a JTI with get() before its later set(). The
    // PostgreSQL adapter claims agent-auth:jti keys atomically inside get(),
    // so concurrent requests cannot both observe an unused token.
    jtiCacheStorage: "secondary-storage",
    jwksCacheStorage: "secondary-storage",
    onEvent: (event) => writeAgentAuthAuditEvent(db, event),
    onExecute: ({ capability, arguments: args, agentSession }) =>
      executeRecipeAgentCapability(db, capability, args, agentSession),
  });
}
