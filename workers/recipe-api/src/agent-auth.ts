import type { AgentSession, Capability } from "@better-auth/agent-auth";
import {
  createAgentAuthAuditHandler,
  createAgentAuthConfiguration,
  createAgentAuthPlugin,
  createAgentExecutionHandler,
  type AgentAuthAuditRecord,
  type AgentExecutionAuditEvent,
  type AgentExecutionRateLimits,
} from "agent-auth";
import { APIError } from "better-auth";
import { and, desc, eq, ilike, or } from "drizzle-orm";
import type { Db } from "recipe-db";
import * as schema from "recipe-db/schema";
import {
  RECIPE_IMPORT_MAX_IMAGES,
  RECIPE_IMPORT_STAGES,
  RECIPE_IMPORT_STATUSES,
} from "recipe-domain/import-storage";
import {
  CookLogMutationEventSchema,
  MAX_COOK_LOG_MUTATION_EVENTS,
} from "recipe-domain/cook-log";
import {
  MAX_PANTRY_ITEMS,
  MAX_PANTRY_FRESHNESS_ESTIMATE_DAYS,
  MAX_PANTRY_MUTATION_CHANGES,
  PANTRY_LOCATIONS,
  PantryLocationSchema,
} from "recipe-domain/pantry";
import { UnitSchema } from "recipe-domain/unit";
import { RECIPE_VISIBILITIES } from "recipe-domain/visibility";
import { z } from "zod";
import {
  type AgentRecipeImportServices,
  createAgentRecipeImport,
  readAgentRecipeImportStatus,
} from "./agent-recipe-imports";
import { appendCookLog } from "./cook-log/services/append-cook-log";
import { previewCookLogMutationUndo } from "./cook-log/services/preview-cook-log-mutation-undo";
import {
  cookingInsightsResponse,
  cookingLogResponse,
  decodeCookingLogCursor,
} from "./cooking-reads";
import { readPantry } from "./pantry";
import { previewPantryMutationUndo } from "./pantry/services/preview-pantry-mutation-undo";
import { reconcilePantry } from "./pantry/services/reconcile-pantry";
import { readableRecipeFilter } from "./recipe-access";
import { inspectRecipeDataset } from "./recipe-dataset";
import { enforceRateLimit } from "./http/rate-limit";

const READ_GRANT_TTL_SECONDS = 30 * 24 * 60 * 60;
const MAX_COOK_LOG_RANGE_MS = 90 * 24 * 60 * 60 * 1_000;
const AGENT_AUTH_PROVIDER_NAME = "Robbie's Recipes";
const AGENT_AUTH_PROVIDER_DESCRIPTION =
  "Delegated access to recipes and personal cooking data.";
const AGENT_AUTH_MODES = ["delegated"] as const;
const AGENT_AUTH_APPROVAL_METHODS = ["device_authorization"] as const;
const AGENT_EXECUTION_WINDOW_SECONDS = 60;

const AGENT_EXECUTION_RATE_LIMITS = {
  capability: { max: 30, windowSeconds: AGENT_EXECUTION_WINDOW_SECONDS },
  agent: { max: 60, windowSeconds: AGENT_EXECUTION_WINDOW_SECONDS },
  user: { max: 240, windowSeconds: AGENT_EXECUTION_WINDOW_SECONDS },
  host: { max: 480, windowSeconds: AGENT_EXECUTION_WINDOW_SECONDS },
  ip: { max: 1_200, windowSeconds: AGENT_EXECUTION_WINDOW_SECONDS },
} as const satisfies AgentExecutionRateLimits;

export function recipeAgentConfiguration(baseUrl: string) {
  return createAgentAuthConfiguration({
    baseUrl,
    providerName: AGENT_AUTH_PROVIDER_NAME,
    description: AGENT_AUTH_PROVIDER_DESCRIPTION,
    modes: [...AGENT_AUTH_MODES],
    approvalMethods: [...AGENT_AUTH_APPROVAL_METHODS],
  });
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

const recipeImportCreateInput = z
  .object({
    imageUrls: z.array(z.url()).min(1).max(RECIPE_IMPORT_MAX_IMAGES),
    idempotencyKey: z.uuid(),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

const recipeImportStatusInput = z
  .object({
    jobId: z.uuid().optional(),
    limit: z.number().int().min(1).max(20).default(10),
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

const pantryReconcileInput = z
  .object({
    idempotencyKey: z.uuid(),
    reason: z.string().trim().min(1).max(500),
    changes: z
      .array(
        z
          .object({
            ingredientSlug: z.string().trim().min(1).max(200),
            expectedVersion: z.string().regex(/^\d+$/).nullable(),
            location: PantryLocationSchema.nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_PANTRY_MUTATION_CHANGES),
  })
  .strict();

const cookLogAppendInput = z
  .object({
    idempotencyKey: z.uuid(),
    reason: z.string().trim().min(1).max(500),
    events: z
      .array(CookLogMutationEventSchema)
      .min(1)
      .max(MAX_COOK_LOG_MUTATION_EVENTS),
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
  required: [
    "resourceId",
    "scope",
    "revision",
    "stock",
    "items",
    "itemVersions",
  ],
  properties: {
    resourceId: { type: "string" },
    scope: { enum: ["personal", "household"] },
    revision: { type: "string", pattern: "^[0-9]+$" },
    stock: {
      type: "object",
      maxProperties: MAX_PANTRY_ITEMS,
      additionalProperties: { enum: PANTRY_LOCATIONS },
    },
    items: {
      type: "object",
      maxProperties: MAX_PANTRY_ITEMS,
      additionalProperties: {
        type: "object",
        additionalProperties: false,
        required: ["location", "quantity", "freshness", "source"],
        properties: {
          location: { enum: PANTRY_LOCATIONS },
          quantity: {
            anyOf: [
              { type: "null" },
              {
                type: "object",
                additionalProperties: false,
                required: ["amount", "unit"],
                properties: {
                  amount: { type: "number", exclusiveMinimum: 0 },
                  unit: { enum: UnitSchema.options },
                },
              },
            ],
          },
          freshness: {
            type: "object",
            additionalProperties: false,
            required: [
              "useBy",
              "bestBefore",
              "stockedAt",
              "openedAt",
              "frozenAt",
              "estimate",
            ],
            properties: {
              useBy: { type: ["string", "null"], format: "date" },
              bestBefore: { type: ["string", "null"], format: "date" },
              stockedAt: { type: ["string", "null"], format: "date" },
              openedAt: { type: ["string", "null"], format: "date" },
              frozenAt: { type: ["string", "null"], format: "date" },
              estimate: {
                anyOf: [
                  { type: "null" },
                  {
                    type: "object",
                    additionalProperties: false,
                    required: ["expectedDays", "startingOn", "storage", "basis"],
                    properties: {
                      expectedDays: {
                        type: "integer",
                        minimum: 1,
                        maximum: MAX_PANTRY_FRESHNESS_ESTIMATE_DAYS,
                      },
                      startingOn: { type: "string", format: "date" },
                      storage: { enum: PANTRY_LOCATIONS },
                      basis: { enum: ["user", "catalog"] },
                    },
                  },
                ],
              },
            },
          },
          source: {
            type: "object",
            additionalProperties: false,
            required: ["kind", "provenance"],
            properties: {
              kind: { enum: ["user", "inferred"] },
              provenance: { type: "string", minLength: 1, maxLength: 200 },
            },
          },
        },
      },
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

const recipeImportSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "status",
    "currentStage",
    "progressLabel",
    "imageCount",
    "error",
    "createdAt",
    "finishedAt",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    status: { enum: RECIPE_IMPORT_STATUSES },
    currentStage: {
      anyOf: [
        { enum: RECIPE_IMPORT_STAGES },
        { type: "null" },
      ],
    },
    progressLabel: { type: ["string", "null"] },
    imageCount: {
      type: "integer",
      minimum: 1,
      maximum: RECIPE_IMPORT_MAX_IMAGES,
    },
    error: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["type", "message"],
          properties: {
            type: { type: ["string", "null"] },
            message: { type: "string" },
          },
        },
        { type: "null" },
      ],
    },
    createdAt: { type: "string", format: "date-time" },
    finishedAt: { type: ["string", "null"], format: "date-time" },
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
    name: "recipe_import.create",
    description:
      "Create an attributed recipe-photo import from bounded public image URLs. The resulting draft is never published automatically.",
    approvalStrength: "session",
    grantTTL: READ_GRANT_TTL_SECONDS,
    input: {
      type: "object",
      additionalProperties: false,
      required: ["imageUrls", "idempotencyKey", "reason"],
      properties: {
        imageUrls: {
          type: "array",
          minItems: 1,
          maxItems: RECIPE_IMPORT_MAX_IMAGES,
          items: { type: "string", format: "uri", maxLength: 2_048 },
        },
        idempotencyKey: { type: "string", format: "uuid" },
        reason: { type: "string", minLength: 1, maxLength: 500 },
      },
    },
    output: {
      type: "object",
      additionalProperties: false,
      required: ["import", "replayed"],
      properties: { import: recipeImportSchema, replayed: { type: "boolean" } },
    },
  },
  {
    name: "recipe_import.status",
    description:
      "Read bounded import status for the delegated user without exposing source uploads, storage keys, prompts, or private extraction artifacts.",
    approvalStrength: "session",
    grantTTL: READ_GRANT_TTL_SECONDS,
    input: {
      type: "object",
      additionalProperties: false,
      properties: {
        jobId: { type: "string", format: "uuid" },
        limit: { type: "integer", minimum: 1, maximum: 20, default: 10 },
      },
    },
    output: {
      type: "object",
      additionalProperties: false,
      required: ["imports"],
      properties: {
        imports: { type: "array", maxItems: 20, items: recipeImportSchema },
      },
    },
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
    name: "pantry.reconcile",
    description:
      "Apply an attributed, idempotent pantry change set with row-version conflict checks and a compensating undo preview.",
    approvalStrength: "session",
    grantTTL: READ_GRANT_TTL_SECONDS,
    input: {
      type: "object",
      additionalProperties: false,
      required: ["idempotencyKey", "reason", "changes"],
      properties: {
        idempotencyKey: { type: "string", format: "uuid" },
        reason: { type: "string", minLength: 1, maxLength: 500 },
        changes: {
          type: "array",
          minItems: 1,
          maxItems: MAX_PANTRY_MUTATION_CHANGES,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["ingredientSlug", "expectedVersion", "location"],
            properties: {
              ingredientSlug: { type: "string", minLength: 1, maxLength: 200 },
              expectedVersion: {
                type: ["string", "null"],
                pattern: "^[0-9]+$",
              },
              location: { enum: [...PANTRY_LOCATIONS, null] },
            },
          },
        },
      },
    },
    output: {
      type: "object",
      additionalProperties: false,
      required: ["changeSetId", "replayed", "pantry", "undoPreview"],
      properties: {
        changeSetId: { type: "string", format: "uuid" },
        replayed: { type: "boolean" },
        pantry: pantrySnapshotSchema,
        undoPreview: { type: "object" },
      },
    },
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
    name: "cook_log.append",
    description:
      "Append an attributed, idempotent batch of completed cooking events with a compensating undo preview.",
    approvalStrength: "session",
    grantTTL: READ_GRANT_TTL_SECONDS,
    input: {
      type: "object",
      additionalProperties: false,
      required: ["idempotencyKey", "reason", "events"],
      properties: {
        idempotencyKey: { type: "string", format: "uuid" },
        reason: { type: "string", minLength: 1, maxLength: 500 },
        events: {
          type: "array",
          minItems: 1,
          maxItems: MAX_COOK_LOG_MUTATION_EVENTS,
          items: {
            type: "object",
            additionalProperties: false,
            required: [
              "sessionId",
              "recipeSlug",
              "recipeTitle",
              "servings",
              "diners",
              "cookedAt",
            ],
            properties: {
              sessionId: { type: "string", format: "uuid" },
              recipeSlug: { type: "string", minLength: 1, maxLength: 120 },
              recipeTitle: { type: "string", minLength: 1, maxLength: 120 },
              servings: { type: "integer", minimum: 1, maximum: 1_000 },
              diners: {
                type: "array",
                maxItems: 20,
                items: { type: "string", minLength: 1, maxLength: 120 },
              },
              cookedAt: { type: "string", format: "date-time" },
            },
          },
        },
      },
    },
    output: {
      type: "object",
      additionalProperties: false,
      required: ["changeSetId", "replayed", "undoPreview"],
      properties: {
        changeSetId: { type: "string", format: "uuid" },
        replayed: { type: "boolean" },
        undoPreview: { type: "object" },
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

type AgentCapabilityHandler = (
  db: Db,
  args: Record<string, unknown> | undefined,
  agentSession: AgentSession,
  services: AgentRecipeImportServices,
) => Promise<AgentCapabilityResult>;

async function searchRecipes(
  db: Db,
  args: Record<string, unknown> | undefined,
  agentSession: AgentSession,
) {
  const userId = agentSession.user.id;
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

async function readRecipe(
  db: Db,
  args: Record<string, unknown> | undefined,
  agentSession: AgentSession,
) {
  const userId = agentSession.user.id;
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

async function inspectDataset(
  db: Db,
  args: Record<string, unknown> | undefined,
  agentSession: AgentSession,
) {
  const input = recipeDatasetInspectInput.parse(args ?? {});
  return inspectRecipeDataset(db, agentSession.user.id, input);
}

async function createRecipeImport(
  db: Db,
  args: Record<string, unknown> | undefined,
  agentSession: AgentSession,
  services: AgentRecipeImportServices,
) {
  return createAgentRecipeImport(
    db,
    services,
    agentSession,
    recipeImportCreateInput.parse(args ?? {}),
  );
}

async function readRecipeImportStatus(
  db: Db,
  args: Record<string, unknown> | undefined,
  agentSession: AgentSession,
) {
  return readAgentRecipeImportStatus(
    db,
    agentSession.user.id,
    recipeImportStatusInput.parse(args ?? {}),
  );
}

async function readPantryCapability(
  db: Db,
  args: Record<string, unknown> | undefined,
  agentSession: AgentSession,
) {
  noArgumentsInput.parse(args ?? {});
  const pantry = await readPantry(db, agentSession.user.id);
  return { ...pantry, scope: pantry.scope.type };
}

function mutationActor(agentSession: AgentSession) {
  return {
    type: "agent" as const,
    userId: agentSession.user.id,
    agentId: agentSession.agent.id,
    agentName: agentSession.agent.name,
    hostId: agentSession.agent.hostId,
  };
}

async function reconcilePantryCapability(
  db: Db,
  args: Record<string, unknown> | undefined,
  agentSession: AgentSession,
) {
  const input = pantryReconcileInput.parse(args ?? {});
  const result = await reconcilePantry(db, {
    ...input,
    actor: mutationActor(agentSession),
    capability: "pantry.reconcile",
  });
  const undoPreview = await previewPantryMutationUndo(
    db,
    agentSession.user.id,
    result.changeSetId,
  );
  return {
    ...result,
    pantry: { ...result.pantry, scope: result.pantry.scope.type },
    undoPreview,
  };
}

async function appendCookLogCapability(
  db: Db,
  args: Record<string, unknown> | undefined,
  agentSession: AgentSession,
) {
  const input = cookLogAppendInput.parse(args ?? {});
  const result = await appendCookLog(db, {
    ...input,
    actor: mutationActor(agentSession),
  });
  const undoPreview = await previewCookLogMutationUndo(
    db,
    agentSession.user.id,
    result.changeSetId,
  );
  return { ...result, undoPreview };
}

async function readShoppingList(
  db: Db,
  args: Record<string, unknown> | undefined,
  agentSession: AgentSession,
) {
  noArgumentsInput.parse(args ?? {});
  const userId = agentSession.user.id;
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
    .where(and(ownerFilter, eq(schema.shoppingList.status, "active")))
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

async function readCookLog(
  db: Db,
  args: Record<string, unknown> | undefined,
  agentSession: AgentSession,
) {
  const input = cookLogReadInput.parse(args ?? {});
  return cookingLogResponse(
    db,
    agentSession.user.id,
    cookingLogQuery(input),
  );
}

async function readCookingInsights(
  db: Db,
  args: Record<string, unknown> | undefined,
  agentSession: AgentSession,
) {
  noArgumentsInput.parse(args ?? {});
  return cookingInsightsResponse(db, agentSession.user.id);
}

type AgentCapabilityResult =
  | Awaited<ReturnType<typeof searchRecipes>>
  | Awaited<ReturnType<typeof readRecipe>>
  | Awaited<ReturnType<typeof inspectDataset>>
  | Awaited<ReturnType<typeof createRecipeImport>>
  | Awaited<ReturnType<typeof readRecipeImportStatus>>
  | Awaited<ReturnType<typeof readPantryCapability>>
  | Awaited<ReturnType<typeof reconcilePantryCapability>>
  | Awaited<ReturnType<typeof readShoppingList>>
  | Awaited<ReturnType<typeof readCookLog>>
  | Awaited<ReturnType<typeof appendCookLogCapability>>
  | Awaited<ReturnType<typeof readCookingInsights>>;

const agentCapabilityHandlers: Record<string, AgentCapabilityHandler> = {
  "recipes.search": searchRecipes,
  "recipes.read": readRecipe,
  "recipes.dataset.inspect": inspectDataset,
  "recipe_import.create": createRecipeImport,
  "recipe_import.status": readRecipeImportStatus,
  "pantry.read": readPantryCapability,
  "pantry.reconcile": reconcilePantryCapability,
  "shopping_list.read": readShoppingList,
  "cook_log.read": readCookLog,
  "cook_log.append": appendCookLogCapability,
  "cooking_insights.read": readCookingInsights,
};

export async function executeRecipeAgentCapability(
  db: Db,
  capability: string,
  args: Record<string, unknown> | undefined,
  agentSession: AgentSession,
  services: AgentRecipeImportServices = {},
) {
  const handler = agentCapabilityHandlers[capability];
  if (!handler) throw new Error(`Unsupported agent capability: ${capability}`);
  return handler(db, args, agentSession, services);
}

async function writeAgentAuthAuditRecord(
  db: Db,
  record: AgentAuthAuditRecord | AgentExecutionAuditEvent,
) {
  await db.insert(schema.agentAuthAuditEvent).values(record);
}

export function createRecipeAgentAuthPlugin(
  db: Db,
  services: AgentRecipeImportServices = {},
) {
  const onExecute = createAgentExecutionHandler({
    limits: AGENT_EXECUTION_RATE_LIMITS,
    consumeRateLimit: (key, rule) =>
      enforceRateLimit(db, key, { ...rule, failClosed: true }),
    audit: (event) => writeAgentAuthAuditRecord(db, event),
    execute: ({ capability, arguments: args, agentSession }) =>
      executeRecipeAgentCapability(db, capability, args, agentSession, services),
  });
  return createAgentAuthPlugin({
    providerName: AGENT_AUTH_PROVIDER_NAME,
    providerDescription: AGENT_AUTH_PROVIDER_DESCRIPTION,
    deviceAuthorizationPage: "/recipes/settings/agents/approve",
    capabilities: RECIPE_SITE_AGENT_CAPABILITIES,
    onEvent: createAgentAuthAuditHandler({
      includeCapabilityExecutions: false,
      write: (record) => writeAgentAuthAuditRecord(db, record),
    }),
    onExecute,
  });
}
