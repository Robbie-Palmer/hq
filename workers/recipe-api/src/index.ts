import {
  createRoute,
  extendZodWithOpenApi,
  OpenAPIHono,
  type RouteConfig,
} from "@hono/zod-openapi";
import type { Context, Handler } from "hono";
import {
  injectTraceContext,
  traceCarrierFromHeaders,
  traceCarrierFromSpan,
  withPostHogRequest,
  withPostHogSpan,
} from "observability";
import {
  and,
  count,
  desc,
  eq,
  exists,
  gt,
  gte,
  inArray,
  isNull,
  lt,
  notInArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import {
  closeDbClient,
  createDb,
  databaseConnection,
  type Db,
  type DbClient,
  schema,
} from "recipe-db";
import { SavedRecipePayloadSchema } from "recipe-domain/serialization";
import {
  isRecipeAppRouteSlug,
  LOWERCASE_KEBAB_CASE_PATTERN,
  RECIPE_SLUG_MAX_LENGTH,
} from "recipe-domain/slugs";
import { RecipeVisibilitySchema } from "recipe-domain/visibility";
import {
  importJobPrefix,
  sourceImageKey,
} from "recipe-domain/import-storage";
import { parseRecipeFile } from "recipe-parsing/recipe-file";
import { parseSchemaOrgRecipeHtml } from "recipe-parsing/schema-org";
import { recipeAgentConfiguration } from "./agent-auth";
import {
  AgentMutationConflictError,
  listAgentMutationHistory,
  previewAgentMutationUndo,
  undoAgentMutation,
} from "./agent-mutations";
import { createAuth, isPreviewAuthEnabled } from "./auth";
import { verifyCloudflareAccess } from "./cloudflare-access";
import { cookingInsightsResponse } from "./cooking-reads";
import { hasPostgresErrorCode } from "./db/errors";
import {
  decodeFeedCursor,
  type FeedCursor,
  paginateRecipeFeed,
  recipeFeedCursorFilter,
  recipeFeedCursorTimestamp,
} from "./feed-pagination";
import {
  type AuthenticatedSession,
  type AuthorizationVariables,
  authorizationResponse,
  authorizeHouseholdMembershipManagement,
  authorizeOwnerOnly,
  authorizeRecipeRead,
  forbidden,
  hasSessionSignal,
  loadBetterAuthSession,
  unauthenticated,
} from "./http/authorization";
import { enforceRateLimit, rateLimitedResponse } from "./http/rate-limit";
import { validateCsrf } from "./http/security";
import { parseJsonBody } from "./http/validation";
import { hasExpectedImageSignature } from "./image-signature";
import {
  createHouseholdNotification,
  createRecipeRecommendationNotification,
  decryptAgentApprovalCode,
  type HouseholdNotificationKind,
  markInvitationNotificationRead,
  notifyAgentRegistrationApproval,
} from "./notifications";
import {
  findPantryAggregate,
  MAX_PANTRY_ITEMS,
  pantryAggregateScopeFilter,
  type PantryLocation,
  type PantryResponse,
  pantryResourceId,
  pantryResponseForScope,
  type PantryScope,
  pantryScopeFilter,
  readPantry,
  resolvePantryScope,
} from "./pantry";
import { readableRecipeFilter } from "./recipe-access";
import { fetchRecipePage, RecipeUrlImportError } from "./recipe-url-import";
import {
  type PantryChangeKind,
  type PantryRealtimeEvent,
  REALTIME_AUTHORIZATION_LIFETIME_MS,
  realtimeRoomRequestHeaders,
} from "./realtime-room";
import {
  findPreviewScenario,
  previewScenarios,
} from "./preview-scenarios";
import {
  normalizeEmail,
  userOwnsVerifiedEmail,
  verifiedEmailOwnerId,
  verifiedEmailsForUser,
} from "./user-emails";

export type Bindings = {
  HYPERDRIVE?: Hyperdrive;
  DATABASE_URL?: string;
  DEPLOYMENT_ENV?: string;
  POSTHOG_KEY?: string;
  POSTHOG_OTLP_BASE_URL?: string;
  BETTER_AUTH_URL: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  BETTER_AUTH_SECRET: string;
  PREVIEW_AUTH_PASSWORD?: string;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  ARTIFACTS?: R2Bucket;
  RECIPE_INGEST_WORKFLOW?: Workflow;
  HOUSEHOLD_REALTIME?: DurableObjectNamespace;
};

type Recipe = typeof schema.recipe.$inferSelect;
type RecipeImportJob = typeof schema.recipeImportJob.$inferSelect;
type Household = typeof schema.organization.$inferSelect;
type HouseholdMember = typeof schema.member.$inferSelect;
type HouseholdInvitation = typeof schema.invitation.$inferSelect;
type ShoppingListSnapshot = typeof schema.shoppingList.$inferInsert.snapshot;
type ShoppingListResponse = {
  id: string;
  resourceId: string;
  revision: string;
  scope: PantryResponse["scope"];
  snapshot: ShoppingListSnapshot;
  createdAt: string;
  updatedAt: string;
};
type DbTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
type InvitationNotificationStatus =
  | "pending"
  | "accepted"
  | "declined"
  | "expired"
  | "unavailable";
type AuthSessionResult =
  | { success: true; session: AuthenticatedSession }
  | { success: false; response: Response };
type RecipeSessionContext = {
  db: Db;
  session: AuthenticatedSession;
};
type DietProfileResponse = {
  presetDietKeys: string[];
  excludedIngredientSlugs: string[];
  excludedGroupKeys: string[];
  recipeMatchMode: "hide" | "warn";
};
type AppEnv = {
  Bindings: Bindings;
  Variables: Partial<AuthorizationVariables>;
};

type SpanAttributes = Record<string, boolean | number | string>;

extendZodWithOpenApi(z);

const app = new OpenAPIHono<AppEnv>();

const previewSignInBodySchema = z.object({
  scenario: z.string().trim().min(1).max(100),
});

const recipeSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(RECIPE_SLUG_MAX_LENGTH)
  .regex(LOWERCASE_KEBAB_CASE_PATTERN, {
    message:
      "Slug must use lowercase letters, numbers, and single hyphens between words",
  });

const creatableRecipeSlugSchema = recipeSlugSchema.refine(
  (slug) => !isRecipeAppRouteSlug(slug),
  { message: "Slug is reserved for a recipe application route" },
);
const dietRecipeMatchModeSchema = z.enum(["hide", "warn"]);
const pantryLocationSchema = z.enum(schema.pantryLocationEnum.enumValues);
const pantryIngredientSlugSchema = z.string().min(1).max(200);
const pantryResponseSchema = z
  .object({
    resourceId: z.string().min(1),
    revision: z.string().regex(/^\d+$/),
    operationId: z.uuid().optional(),
    scope: z.discriminatedUnion("type", [
      z.object({ type: z.literal("personal") }).strict(),
      z
        .object({
          type: z.literal("household"),
          household: z
            .object({ id: z.string().min(1), name: z.string() })
            .strict(),
        })
        .strict(),
    ]),
    stock: z.record(z.string().min(1), pantryLocationSchema),
    itemVersions: z.record(z.string().min(1), z.string().regex(/^\d+$/)),
  })
  .strict();
const pantryOperationReceiptSchema = z
  .object({ version: z.literal(1), pantry: pantryResponseSchema })
  .strict();
const undoAgentMutationBodySchema = z
  .object({
    stableItemIds: z.array(z.uuid().max(36)).min(1).max(100).optional(),
  })
  .strict();
const feedScopeSchema = z.enum(["public", "following"]);
const feedLimitSchema = z.coerce.number().int().min(1).max(30).default(12);
const recipeListLimitSchema = z.coerce.number().int().min(1).max(100).default(100);
const RECIPE_BOOTSTRAP_LIMIT = 10_000;
const publicCookIdSchema = z.string().trim().min(1).max(128);
const PUBLIC_COOK_CONNECTION_LIMIT = 50;
// Visibility revocation follows the bounded CDN window documented in README.md.
const PUBLIC_RECIPE_READ_CACHE_CONTROL =
  "public, s-maxage=60, stale-while-revalidate=300";
const PRIVATE_RECIPE_READ_CACHE_CONTROL = "private, no-store";
const RECIPE_READ_VARY = "Cookie, Authorization";
const feedViewerMembership = alias(schema.member, "feed_viewer_membership");
const feedRecipeOwnerMembership = alias(
  schema.member,
  "feed_recipe_owner_membership",
);

const dietKeySchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(80)
  .regex(LOWERCASE_KEBAB_CASE_PATTERN, {
    message:
      "Diet keys must use lowercase letters, numbers, and single hyphens between words",
  });

const uniqueDietKeysSchema = z
  .array(dietKeySchema)
  .max(80)
  .transform((values) => Array.from(new Set(values)));

const recipeBoxBodySchema = z
  .object({
    recipeSlugs: z.array(recipeSlugSchema).max(100).optional(),
    // Temporary deploy-order compatibility for the previous static catalog UI.
    staticRecipeSlugs: z.array(recipeSlugSchema).max(100).optional(),
  })
  .strict()
  .refine((body) => body.recipeSlugs || body.staticRecipeSlugs, {
    message:
      "At least one of recipeSlugs or staticRecipeSlugs must be provided",
  })
  .transform((body) => ({
    recipeSlugs: Array.from(
      new Set(body.recipeSlugs ?? body.staticRecipeSlugs ?? []),
    ),
  }));

const cookingSessionBodySchema = z
  .object({
    sessionId: z.uuid().max(36),
    recipeSlug: recipeSlugSchema,
    recipeTitle: z.string().trim().min(1).max(120),
    servings: z
      .number()
      .int()
      .min(1)
      .max(1_000)
      .openapi({ format: "int32" }),
    event: z.enum(["started", "completed"]),
  })
  .strict();

const recommendRecipeBodySchema = z
  .object({
    recipientUserId: z.string().trim().min(1).max(128),
  })
  .strict();

const MAX_RECIPE_BODY_BYTES = 100_000;
const savedRecipePayloadSchema = SavedRecipePayloadSchema.extend({
  source: z.string().trim().min(1).max(10_000),
})
  .strict();

const savedRecipeBodySchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_RECIPE_BODY_BYTES)
  .superRefine((value, context) => {
    if (new TextEncoder().encode(value).byteLength > MAX_RECIPE_BODY_BYTES) {
      context.addIssue({
        code: "custom",
        message: `Recipe body must be at most ${MAX_RECIPE_BODY_BYTES} bytes`,
      });
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(value);
    } catch {
      context.addIssue({
        code: "custom",
        message: "Recipe body must be valid JSON",
      });
      return;
    }

    const result = savedRecipePayloadSchema.safeParse(payload);
    if (!result.success) {
      for (const issue of result.error.issues) {
        context.addIssue({
          code: "custom",
          path: issue.path,
          message: issue.message,
        });
      }
    }
  });

// Household invitations stay valid for 48 hours after they are created.
const INVITATION_EXPIRY_MS = 48 * 60 * 60 * 1000;
const NOTIFICATION_PAGE_SIZE = 100;

const HOUSEHOLD_INVITE_RATE_LIMIT = { max: 10, windowSeconds: 60 * 60 };
const RECIPE_RECOMMENDATION_RATE_LIMIT = {
  max: 30,
  windowSeconds: 60 * 60,
};
const RECIPE_URL_IMPORT_RATE_LIMIT = { max: 20, windowSeconds: 60 * 60 };
const RECIPE_FILE_IMPORT_RATE_LIMIT = { max: 20, windowSeconds: 60 * 60 };
const RECIPE_PHOTO_IMPORT_RATE_LIMIT = { max: 20, windowSeconds: 60 * 60 };

const createRecipeBodySchema = z.object({
  slug: creatableRecipeSlugSchema,
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(500).optional(),
  body: savedRecipeBodySchema,
  visibility: RecipeVisibilitySchema.default("private"),
});

const importRecipeUrlBodySchema = z
  .object({ url: z.string().trim().min(1).max(2_048) })
  .strict();

const importRecipeFileBodySchema = z
  .object({
    filename: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .regex(
        /\.(?:cook|cooklang|json|jsonld)$/i,
        "Use a .cook, .cooklang, .json, or .jsonld file",
      ),
    content: z
      .string()
      .min(1)
      .max(100_000)
      .refine(
        (value) => new TextEncoder().encode(value).byteLength <= 100_000,
        "File content must be 100 KB or smaller",
      ),
  })
  .strict();

const updateRecipeBodySchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().min(1).max(500).nullable().optional(),
    body: savedRecipeBodySchema.nullable().optional(),
    visibility: RecipeVisibilitySchema.optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: "At least one recipe field must be provided",
  });

const createHouseholdBodySchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

const updateHouseholdBodySchema = z
  .object({
    name: z.string().trim().min(1).max(120),
  })
  .strict();

const inviteHouseholdMemberBodySchema = z
  .object({
    email: z.string().trim().check(z.email()).max(320),
  })
  .strict();

const pantryStockBodySchema = z
  .object({
    stock: z
      .record(pantryIngredientSlugSchema, pantryLocationSchema)
      .refine((stock) => Object.keys(stock).length <= MAX_PANTRY_ITEMS, {
        message: `A pantry can contain at most ${MAX_PANTRY_ITEMS} ingredients`,
      }),
  })
  .strict();

const pantryItemBodySchema = z
  .object({
    location: pantryLocationSchema,
  })
  .strict();

const shoppingListSnapshotSchema = z
  .object({
    recipes: z
      .array(
        z
          .object({
            slug: z.string().trim().min(1).max(200),
            servings: z
              .number()
              .int()
              .min(1)
              .max(1_000)
              .openapi({ format: "int32" })
              .optional(),
          })
          .strict(),
      )
      .max(200),
    checked: z.array(z.string().trim().min(1).max(200)).max(1_000),
    extras: z
      .array(
        z
          .object({
            id: z.string().trim().min(1).max(200),
            text: z.string().trim().min(1).max(500),
            checked: z.boolean(),
          })
          .strict(),
      )
      .max(500),
  })
  .strict()
  .openapi("ShoppingListSnapshot");

const shoppingListScopeSchema = z
  .discriminatedUnion("type", [
    z.object({ type: z.literal("personal") }).strict(),
    z
      .object({
        type: z.literal("household"),
        household: z
          .object({
            id: z.string().min(1).max(200),
            name: z.string().max(200),
          })
          .strict(),
      })
      .strict(),
  ])
  .openapi("ShoppingListScope");

const shoppingListResponseSchema = z
  .object({
    id: z.uuid().max(36),
    resourceId: z.string().min(1).max(200),
    revision: z.string().regex(/^\d+$/).max(30),
    scope: shoppingListScopeSchema,
    snapshot: shoppingListSnapshotSchema,
    createdAt: z.iso.datetime().max(40),
    updatedAt: z.iso.datetime().max(40),
  })
  .strict()
  .openapi("ShoppingList");

const updateShoppingListBodySchema = z
  .object({
    listId: z.uuid().max(36),
    revision: z.string().regex(/^\d+$/).max(30),
    snapshot: shoppingListSnapshotSchema,
  })
  .strict();

const createShoppingListBodySchema = z
  .object({
    previousListId: z.uuid().max(36),
    previousRevision: z.string().regex(/^\d+$/).max(30),
    snapshot: shoppingListSnapshotSchema,
  })
  .strict();

const updateDietProfileBodySchema = z
  .object({
    presetDietKeys: uniqueDietKeysSchema.default([]),
    excludedIngredientSlugs: uniqueDietKeysSchema.default([]),
    excludedGroupKeys: uniqueDietKeysSchema.default([]),
    recipeMatchMode: dietRecipeMatchModeSchema.default("hide"),
  })
  .strict();

const errorSchema = z
  .object({
    error: z.string().max(500),
    details: z
      .array(
        z.object({
          path: z.array(z.union([z.string().max(200), z.number()])).max(20),
          message: z.string().max(500),
        }),
      )
      .max(100)
      .optional(),
  })
  .openapi("Error");

const jsonResponseSchema = z
  .object({})
  .catchall(z.unknown())
  .openapi("JsonResponse");

const notificationUnreadCountResponseSchema = z
  .object({
    unreadCount: z
      .number()
      .int()
      .min(0)
      .max(2_147_483_647)
      .openapi({ format: "int32" }),
  })
  .openapi("NotificationUnreadCountResponse");

const agentConfigurationSchema = z
  .object({
    version: z.string().max(32),
    provider_name: z.string().max(200),
    description: z.string().max(500),
    issuer: z.url().max(2_048),
    default_location: z.url().max(2_048),
    algorithms: z.array(z.string().max(32)).max(10),
    modes: z.array(z.enum(["delegated", "autonomous"])).max(2),
    approval_methods: z.array(z.string().max(64)).max(10),
    endpoints: z.record(z.string().max(64), z.url().max(2_048)),
    jwks_uri: z.url().max(2_048).optional(),
  })
  .openapi("AgentConfiguration");

const pantryOperationHeadersSchema = z.object({
  "idempotency-key": z.uuid().max(36).optional().openapi({
    description:
      "Client-generated operation ID. Reusing it for the same pantry command returns the committed result while its receipt is retained for at least 24 hours.",
  }),
});

const ERROR_STATUS_CODES = [
  400, 401, 403, 404, 409, 410, 415, 422, 500, 502, 503,
] as const;

type SuccessStatus = 101 | 200 | 201 | 202 | 204;

type RouteMethod = "get" | "post" | "put" | "patch" | "delete";
type RouteKey = `${Uppercase<RouteMethod>} /${string}`;
type RouteMetadata = {
  requestBodySchema?: z.ZodType;
  querySchema?: z.ZodObject;
  headersSchema?: z.ZodObject;
  successStatuses?: readonly SuccessStatus[];
  successResponseSchema?: z.ZodType;
  additionalErrorStatuses?: readonly number[];
  rateLimited?: true;
};

export const routeMetadata = {
  "GET /health": {},
  "GET /.well-known/agent-configuration": {},
  "GET /api/auth/preview/scenarios": {},
  "POST /api/auth/preview/sign-up": {},
  "POST /api/auth/preview/sign-in": {
    requestBodySchema: previewSignInBodySchema,
  },
  "GET /api/profile/diet": {},
  "GET /api/profile/diet/options": {},
  "PUT /api/profile/diet": {
    requestBodySchema: updateDietProfileBodySchema,
  },
  "GET /api/profile/recipe-box": {},
  "GET /api/profile/bootstrap": {},
  "PUT /api/profile/recipe-box": { requestBodySchema: recipeBoxBodySchema },
  "GET /api/profile/cooking-insights": {},
  "GET /api/profile/agent-mutations": {},
  "GET /api/profile/agent-mutations/:changeSetId/undo-preview": {},
  "POST /api/profile/agent-mutations/:changeSetId/undo": {
    requestBodySchema: undoAgentMutationBodySchema,
    headersSchema: pantryOperationHeadersSchema,
  },
  "POST /api/profile/cooking-sessions": {
    requestBodySchema: cookingSessionBodySchema,
    successStatuses: [200, 201],
  },
  "GET /shopping-lists/current": {
    successResponseSchema: shoppingListResponseSchema,
  },
  "PUT /shopping-lists/current": {
    requestBodySchema: updateShoppingListBodySchema,
    successResponseSchema: shoppingListResponseSchema,
  },
  "POST /shopping-lists": {
    requestBodySchema: createShoppingListBodySchema,
    successStatuses: [201],
    successResponseSchema: shoppingListResponseSchema,
  },
  "GET /pantry": {},
  "GET /pantry/realtime": {
    successStatuses: [101],
    additionalErrorStatuses: [426, 429],
  },
  "PUT /pantry": {
    requestBodySchema: pantryStockBodySchema,
    headersSchema: pantryOperationHeadersSchema,
  },
  "PATCH /pantry": {
    requestBodySchema: pantryStockBodySchema,
    headersSchema: pantryOperationHeadersSchema,
  },
  "PUT /pantry/items/:ingredientSlug": {
    requestBodySchema: pantryItemBodySchema,
    headersSchema: pantryOperationHeadersSchema,
  },
  "DELETE /pantry/items/:ingredientSlug": {
    headersSchema: pantryOperationHeadersSchema,
    successStatuses: [200],
  },
  "GET /households": {},
  "GET /households/invitations": {},
  "POST /households": {
    requestBodySchema: createHouseholdBodySchema,
    successStatuses: [201],
  },
  "PATCH /households/:householdId": {
    requestBodySchema: updateHouseholdBodySchema,
  },
  "GET /households/:householdId/members": {},
  "GET /households/:householdId/invitations": {},
  "POST /households/:householdId/invitations": {
    requestBodySchema: inviteHouseholdMemberBodySchema,
    successStatuses: [201],
    rateLimited: true,
  },
  "POST /households/invitations/:invitationId/accept": {},
  "POST /households/invitations/:invitationId/decline": {},
  "DELETE /households/:householdId/invitations/:invitationId": {},
  "DELETE /households/:householdId/members/:memberId": {},
  "POST /households/:householdId/leave": { successStatuses: [204] },
  "DELETE /households/:householdId": {},
  "GET /notifications/unread-count": {
    successResponseSchema: notificationUnreadCountResponseSchema,
  },
  "GET /notifications": {
    querySchema: z.object({
      offset: z.string().regex(/^\d+$/).max(10).optional(),
    }),
  },
  "POST /notifications/read-all": { successStatuses: [204] },
  "POST /notifications/clear-all": { successStatuses: [204] },
  "POST /notifications/:notificationId/actions/:actionKey": {},
  "PATCH /notifications/:notificationId": {},
  "GET /recipes": {
    querySchema: z.object({
      scope: z.literal("owned").optional(),
      limit: z.string().regex(/^\d+$/).max(3).optional(),
      cursor: z.string().max(500).optional(),
    }),
  },
  "GET /recipes/discover/feed": {
    querySchema: z.object({
      scope: feedScopeSchema.optional(),
      limit: z.string().regex(/^\d+$/).max(2).optional(),
      cursor: z.string().max(500).optional(),
    }),
  },
  "GET /recipes/cooks": {
    querySchema: z.object({ cook: z.string().max(128).optional() }),
  },
  "GET /recipes/cooks/me/connections": {},
  "GET /recipes/cooks/:cookId/follow": {},
  "PUT /recipes/cooks/:cookId/follow": {},
  "DELETE /recipes/cooks/:cookId/follow": { successStatuses: [200] },
  "POST /recipe-drafts/url": {
    requestBodySchema: importRecipeUrlBodySchema,
    rateLimited: true,
  },
  "POST /recipe-drafts/file": {
    requestBodySchema: importRecipeFileBodySchema,
    rateLimited: true,
  },
  "GET /recipes/:slug": {},
  "POST /recipes/:slug/recommendations": {
    requestBodySchema: recommendRecipeBodySchema,
    successStatuses: [201],
    rateLimited: true,
  },
  "POST /recipes": {
    requestBodySchema: createRecipeBodySchema,
    successStatuses: [201],
  },
  "PATCH /recipes/:slug": { requestBodySchema: updateRecipeBodySchema },
  "POST /recipes/:slug/household-share": {},
  "DELETE /recipes/:slug/household-share": { successStatuses: [200] },
  "DELETE /recipes/:slug": {},
  "POST /recipe-imports": {
    successStatuses: [202],
    rateLimited: true,
  },
  "GET /recipe-imports": {},
  "GET /recipe-imports/:jobId": {},
} as const satisfies Record<RouteKey, RouteMetadata>;

type RegisteredRouteKey = keyof typeof routeMetadata;
type RegisteredRouteArguments = {
  [Key in RegisteredRouteKey]: Key extends `${infer Method extends Uppercase<RouteMethod>} ${infer Path}`
    ? [method: Lowercase<Method>, path: Path, handler: Handler<AppEnv>]
    : never;
}[RegisteredRouteKey];

function openApiPath(path: string): string {
  return path.replace(/:(\w+)/g, "{$1}");
}

function operationId(method: string, path: string): string {
  const words = `${method}-${path}`
    .replace(/[{}:]/g, "")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  return words
    .map((word, index) =>
      index === 0
        ? word.toLowerCase()
        : `${word[0]?.toUpperCase()}${word.slice(1)}`,
    )
    .join("");
}

const uuidIdSchema = z.uuid().max(36);

const UUID_PATH_PARAMETER_NAMES = new Set([
  "householdId",
  "invitationId",
  "memberId",
  "notificationId",
  "changeSetId",
]);

const notificationActionKeySchema = z.enum([
  "accept",
  "decline",
  "add_to_recipe_box",
]);

function pathParameterSchema(name: string) {
  if (UUID_PATH_PARAMETER_NAMES.has(name)) return uuidIdSchema;
  if (name === "actionKey") return notificationActionKeySchema;
  return z.string().min(1).max(200);
}

function pathParamsSchema(path: string) {
  const parameterNames = [...path.matchAll(/:(\w+)/g)].map(
    (match) => match[1] as string,
  );
  if (parameterNames.length === 0) return undefined;

  return z.object(
    Object.fromEntries(
      parameterNames.map((name) => [name, pathParameterSchema(name)]),
    ),
  );
}

function successDescription(status: SuccessStatus): string {
  switch (status) {
    case 101:
      return "WebSocket protocol upgrade";
    case 201:
      return "Resource created";
    case 202:
      return "Request accepted for asynchronous processing";
    default:
      return "Successful response";
  }
}

function successResponsesFor(
  metadata: RouteMetadata,
  method: RouteMethod,
): RouteConfig["responses"] {
  const statuses =
    metadata.successStatuses ??
    ([method === "delete" ? 204 : 200] as readonly SuccessStatus[]);
  const responses: RouteConfig["responses"] = {};
  const responseSchema =
    metadata.successResponseSchema ?? jsonResponseSchema;

  for (const status of statuses) {
    if (status === 101) {
      responses[status] = { description: successDescription(status) };
    } else if (status === 204) {
      responses[status] = { description: "Successful response with no content" };
    } else {
      responses[status] = {
        description: successDescription(status),
        content: {
          "application/json": { schema: responseSchema },
        },
      };
    }
  }

  return responses;
}

function securityFor(path: string): NonNullable<RouteConfig["security"]> {
  if (path === "/health" || path === "/.well-known/agent-configuration") {
    return [];
  }
  if (path.startsWith("/api/auth/preview/")) {
    return [{ cloudflareAccess: [] }];
  }
  return [{ sessionCookie: [] }];
}

function registerRoute(
  ...[method, path, handler]: RegisteredRouteArguments
): void {
  const key = `${method.toUpperCase()} ${path}` as RegisteredRouteKey;
  const metadata: RouteMetadata = routeMetadata[key];
  const isAgentConfiguration =
    key === "GET /.well-known/agent-configuration";
  const paramsSchema = pathParamsSchema(path);
  const errorResponses: RouteConfig["responses"] = isAgentConfiguration
    ? {
        503: {
          description: "Agent Auth configuration unavailable",
          content: { "application/json": { schema: errorSchema } },
        },
      }
    : Object.fromEntries(
        [
          ...ERROR_STATUS_CODES,
          ...(metadata.additionalErrorStatuses ?? []),
        ].map((status) => [
          status,
          {
            description: `Error (${status})`,
            content: { "application/json": { schema: errorSchema } },
          },
        ]),
      );
  const successResponses: RouteConfig["responses"] = isAgentConfiguration
    ? {
        200: {
          description: "Delegated Agent Auth discovery configuration",
          headers: {
            "Cache-Control": {
              description: "Public discovery document cache lifetime",
              schema: {
                type: "string",
                enum: ["public, max-age=3600"],
              },
            },
          },
          content: {
            "application/json": { schema: agentConfigurationSchema },
          },
        },
      }
    : successResponsesFor(metadata, method);
  const rateLimitResponses: RouteConfig["responses"] = {};
  if (metadata.rateLimited) {
    rateLimitResponses[429] = {
      description: "Rate limit exceeded",
      headers: {
        "Retry-After": {
          description: "Seconds until the request may be retried",
          schema: {
            type: "string" as const,
            pattern: "^[1-9][0-9]*$",
            maxLength: 10,
          },
        },
      },
      content: { "application/json": { schema: errorSchema } },
    };
  }
  const pathSegmentIndex = path.startsWith("/api/") ? 1 : 0;
  const routeTag = path.startsWith("/.well-known/")
    ? "agent-auth"
    : (path.split("/").filter(Boolean).at(pathSegmentIndex) ?? "system");
  const route = createRoute({
    method,
    path: openApiPath(path),
    operationId: operationId(method, path),
    summary: `${method.toUpperCase()} ${path}`,
    description: `Recipe API operation for ${method.toUpperCase()} ${path}.`,
    tags: [routeTag],
    security: securityFor(path),
    request: {
      ...(paramsSchema ? { params: paramsSchema } : {}),
      ...(metadata.querySchema ? { query: metadata.querySchema } : {}),
      ...(metadata.headersSchema
        ? { headers: metadata.headersSchema }
        : {}),
      ...(metadata.requestBodySchema
        ? {
            body: {
              required: true,
              content: {
                "application/json": { schema: metadata.requestBodySchema },
              },
            },
          }
        : {}),
    },
    responses: {
      ...successResponses,
      ...errorResponses,
      ...rateLimitResponses,
    },
  });

  // Handler validation remains in parseJsonBody and the route-specific guards,
  // which preserve the API's shared Error envelope and media-type semantics.
  // Register a hidden request-free runtime route, then add the complete route
  // definition to the OpenAPI registry. Both are derived from this one
  // createRoute declaration, so routing and documentation cannot diverge.
  const runtimeRoute = createRoute({ ...route, request: {}, hide: true });
  app.openapi(runtimeRoute, handler as never);
  app.openAPIRegistry.registerPath(route);
}

app.openAPIRegistry.registerComponent("securitySchemes", "sessionCookie", {
  type: "apiKey",
  in: "cookie",
  name: "better-auth.session_token",
  description: "Better Auth session cookie",
});

app.openAPIRegistry.registerComponent("securitySchemes", "cloudflareAccess", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "Cloudflare Access JWT",
  description: "Cloudflare Access identity token used by preview environments",
});

app.notFound((c) => c.json({ error: "Not found" }, 404));

registerRoute("get", "/health", (c) => c.json({ status: "ok" }));

registerRoute("get", "/.well-known/agent-configuration", async (c) => {
  if (!hasAuthConfiguration(c.env)) {
    return c.json({ error: "Auth configuration is incomplete" }, 503);
  }
  if (!isValidAuthURL(c.env.BETTER_AUTH_URL)) {
    return c.json({ error: "Auth configuration is invalid" }, 503);
  }

  return c.json(recipeAgentConfiguration(c.env.BETTER_AUTH_URL), 200, {
    "Cache-Control": "public, max-age=3600",
  });
});

function isValidAuthURL(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

const NO_DATABASE_CONNECTION_ERROR =
  "No database connection configured (HYPERDRIVE or DATABASE_URL required)";

function requireDatabaseConnection(c: Context<AppEnv>): string | Response {
  const connectionString = databaseConnection(c.env);
  if (!connectionString) {
    return c.json({ error: NO_DATABASE_CONNECTION_ERROR }, 503);
  }
  return connectionString;
}

function recipeResponse(recipe: Recipe) {
  const { userId: _userId, ...response } = recipe;
  return response;
}

async function recipeBoxResponse(db: Db, userId: string) {
  const [profile, items] = await Promise.all([
    db
      .select({ completedAt: schema.userRecipeBox.completedAt })
      .from(schema.userRecipeBox)
      .where(eq(schema.userRecipeBox.userId, userId))
      .limit(1),
    db
      .select({ recipeSlug: schema.userRecipeBoxItem.recipeSlug })
      .from(schema.userRecipeBoxItem)
      .where(eq(schema.userRecipeBoxItem.userId, userId)),
  ]);

  const recipeSlugs = items
    .map((item) => item.recipeSlug)
    .sort((first, second) => first.localeCompare(second));
  return {
    completed: Boolean(profile[0]),
    recipeSlugs,
    // Remove after the Postgres-backed UI has been deployed everywhere.
    staticRecipeSlugs: recipeSlugs,
  };
}

function householdResponse(household: Household) {
  const { metadata: _metadata, ...response } = household;
  return response;
}

function memberResponse(
  member: HouseholdMember & {
    user: Pick<typeof schema.user.$inferSelect, "id" | "email" | "name" | "image">;
  },
) {
  return {
    id: member.id,
    role: member.role,
    createdAt: member.createdAt,
    user: member.user,
  };
}

function invitationResponse(invitation: HouseholdInvitation) {
  return {
    id: invitation.id,
    householdId: invitation.organizationId,
    email: invitation.email,
    role: invitation.role,
    status: invitation.status,
    expiresAt: invitation.expiresAt,
    createdAt: invitation.createdAt,
  };
}

function defaultDietProfile(userId: string) {
  return {
    userId,
    presetDietKeys: [],
    excludedIngredientSlugs: [],
    excludedGroupKeys: [],
    recipeMatchMode: "hide" as const,
  };
}

function dietProfileResponse(profile: DietProfileResponse) {
  return {
    presetDietKeys: profile.presetDietKeys,
    excludedIngredientSlugs: profile.excludedIngredientSlugs,
    excludedGroupKeys: profile.excludedGroupKeys,
    recipeMatchMode: profile.recipeMatchMode,
  };
}

function dietUnknownReferencesResponse(
  c: Context<AppEnv>,
  details: DietReferenceIssue[],
) {
  return c.json(
    {
      error: "Unknown diet reference",
      details,
    },
    400,
  );
}

type DietReferenceIssue = {
  path: string[];
  message: string;
};

class MissingDietReferencesError extends Error {
  constructor(readonly details: DietReferenceIssue[]) {
    super("Unknown diet reference");
  }
}

function createId() {
  return crypto.randomUUID();
}

function householdSlug() {
  return `household-${createId()}`;
}

function invalidSlugResponse(c: Context<AppEnv>) {
  return c.json(
    {
      error: "Invalid recipe slug",
      details: [
        {
          path: ["slug"],
          message:
            "Slug must use lowercase letters, numbers, and single hyphens between words",
        },
      ],
    },
    400,
  );
}

function setRecipeReadCacheHeaders(
  c: Context<AppEnv>,
  anonymousPublicRead: boolean,
): void {
  c.header(
    "Cache-Control",
    anonymousPublicRead
      ? PUBLIC_RECIPE_READ_CACHE_CONTROL
      : PRIVATE_RECIPE_READ_CACHE_CONTROL,
  );
  c.header("Vary", RECIPE_READ_VARY);
}

function parseRecipeSlug(c: Context<AppEnv>) {
  const result = recipeSlugSchema.safeParse(c.req.param("slug"));
  if (!result.success) {
    return {
      success: false,
      response: invalidSlugResponse(c),
    } as const;
  }
  return { success: true, slug: result.data } as const;
}

function uuidParam(
  c: Context<AppEnv>,
  name:
    | "householdId"
    | "invitationId"
    | "memberId"
    | "notificationId"
    | "changeSetId",
  label: string,
): string | Response {
  const result = uuidIdSchema.safeParse(c.req.param(name));
  return result.success
    ? result.data
    : c.json({ error: `Invalid ${label}` }, 400);
}

function hasAuthConfiguration(env: Bindings): boolean {
  if (!env.BETTER_AUTH_URL || !env.BETTER_AUTH_SECRET) return false;
  if (env.DEPLOYMENT_ENV === "preview") {
    return Boolean(
      env.PREVIEW_AUTH_PASSWORD &&
        env.CF_ACCESS_TEAM_DOMAIN &&
        env.CF_ACCESS_AUD,
    );
  }
  return Boolean(
    env.GOOGLE_CLIENT_ID &&
      env.GOOGLE_CLIENT_SECRET &&
      env.GITHUB_CLIENT_ID &&
      env.GITHUB_CLIENT_SECRET,
  );
}

function hasLoadableAuthConfiguration(env: Bindings): boolean {
  return hasAuthConfiguration(env) && isValidAuthURL(env.BETTER_AUTH_URL);
}

async function loadOptionalRecipeSession(
  c: Context<AppEnv>,
  db: Db,
): Promise<AuthenticatedSession | null> {
  if (!hasLoadableAuthConfiguration(c.env)) return null;
  try {
    return await withRecipeApiSpan(c, "auth.session.lookup", () =>
      loadBetterAuthSession(c, db),
    );
  } catch (error) {
    console.error("Recipe session lookup failed", error);
    return null;
  }
}

async function requireRecipeSession(
  c: Context<AppEnv>,
  db: Db,
): Promise<AuthSessionResult> {
  if (!hasAuthConfiguration(c.env)) {
    return {
      success: false,
      response: c.json({ error: "Auth configuration is incomplete" }, 503),
    };
  }
  if (!isValidAuthURL(c.env.BETTER_AUTH_URL)) {
    return {
      success: false,
      response: c.json({ error: "Auth configuration is invalid" }, 503),
    };
  }

  try {
    const session = await withRecipeApiSpan(c, "auth.session.lookup", () =>
      loadBetterAuthSession(c, db),
    );
    if (!session) {
      return {
        success: false,
        response: authorizationResponse(c, unauthenticated()),
      };
    }
    return { success: true, session };
  } catch (error) {
    console.error("Recipe session lookup failed", error);
    return {
      success: false,
      response: c.json({ error: "Auth session lookup failed" }, 503),
    };
  }
}

type WithDbOptions = {
  // Map domain errors to responses before the generic 502 fallback applies.
  onError?: (error: unknown) => Response | undefined;
};

function withRecipeApiSpan<T>(
  c: Context<AppEnv>,
  spanName: string,
  operation: () => Promise<T>,
  attributes?: SpanAttributes,
  options?: { flush?: boolean },
): Promise<T> {
  let waitUntil:
    | { waitUntil(promise: Promise<unknown>): void }
    | undefined;
  try {
    waitUntil = c.executionCtx;
  } catch {
    // Hono's direct app.request() test helper has no execution context.
  }
  return withPostHogSpan(
    {
      env: c.env,
      serviceName: "recipe-api",
      spanName,
      traceCarrier: traceCarrierFromHeaders(c.req.raw.headers),
      waitUntil,
      attributes,
      // Request children rely on the outer request flush. Background work
      // flushes itself because it can finish after the response span.
      flush: options?.flush ?? false,
    },
    operation,
  );
}

async function withDatabase(
  c: Context<AppEnv>,
  failureKind: "query" | "mutation" | "lookup",
  logMessage: string,
  action: (db: Db) => Promise<Response> | Response,
  options?: WithDbOptions,
): Promise<Response> {
  const connectionString = requireDatabaseConnection(c);
  if (connectionString instanceof Response) return connectionString;

  let client: DbClient | undefined;
  try {
    const connection = await withRecipeApiSpan(
      c,
      "db.client.create",
      async () => createDb(connectionString),
      { "db.system.name": "postgresql" },
    );
    client = connection.client;
    return await withRecipeApiSpan(
      c,
      "db.operation",
      () => Promise.resolve(action(connection.db)),
      { "db.system.name": "postgresql" },
    );
  } catch (e) {
    const mapped = options?.onError?.(e);
    if (mapped) return mapped;
    console.error(logMessage, e);
    return c.json({ error: `Database ${failureKind} failed` }, 502);
  } finally {
    await withRecipeApiSpan(
      c,
      "db.client.close",
      () => closeDbClient(client),
      { "db.system.name": "postgresql" },
    );
  }
}

async function withRecipeSession(
  c: Context<AppEnv>,
  failureKind: "query" | "mutation" | "lookup",
  logMessage: string,
  action: (context: RecipeSessionContext) => Promise<Response> | Response,
  options?: WithDbOptions,
): Promise<Response> {
  return withDatabase(
    c,
    failureKind,
    logMessage,
    async (db) => {
      const session = await requireRecipeSession(c, db);
      if (!session.success) return session.response;
      return action({ db, session: session.session });
    },
    options,
  );
}

function isUniqueViolation(error: unknown): boolean {
  return hasPostgresErrorCode(error, "23505");
}

function isForeignKeyViolation(error: unknown): boolean {
  return hasPostgresErrorCode(error, "23503");
}

async function findRecipeBySlug(
  db: Db,
  slug: string,
): Promise<Recipe | undefined> {
  const [recipe] = await db
    .select()
    .from(schema.recipe)
    .where(eq(schema.recipe.slug, slug))
    .limit(1);
  return recipe;
}

async function listRecipesPage(
  db: Db,
  visibilityFilter: SQL | undefined,
  cursor: FeedCursor | undefined,
  limit: number,
): Promise<{ recipes: Recipe[]; nextCursor: string | null }> {
  const cursorFilter = recipeFeedCursorFilter(cursor);
  const rows = await db
    .select({
      recipe: schema.recipe,
      cursorCreatedAt: recipeFeedCursorTimestamp(),
    })
    .from(schema.recipe)
    .where(
      visibilityFilter && cursorFilter
        ? and(visibilityFilter, cursorFilter)
        : (cursorFilter ?? visibilityFilter),
    )
    .orderBy(desc(schema.recipe.createdAt), desc(schema.recipe.id))
    .limit(limit + 1);
  const page = paginateRecipeFeed(rows, limit);
  return {
    recipes: page.items.map(({ recipe }) => recipe),
    nextCursor: page.nextCursor,
  };
}

async function listBootstrapRecipes(db: Db, visibilityFilter: SQL) {
  const page = await listRecipesPage(
    db,
    visibilityFilter,
    undefined,
    RECIPE_BOOTSTRAP_LIMIT,
  );
  if (page.nextCursor) {
    throw new Error("Recipe bootstrap limit exceeded");
  }
  return page.recipes.map(recipeResponse);
}

async function findOwnedRecipeBySlug(
  db: Db,
  slug: string,
  userId: string,
): Promise<Recipe | undefined> {
  const [recipe] = await db
    .select()
    .from(schema.recipe)
    .where(and(eq(schema.recipe.slug, slug), eq(schema.recipe.userId, userId)))
    .limit(1);
  return recipe;
}

async function usersShareHousehold(
  db: Db,
  firstUserId: string,
  secondUserId: string,
): Promise<boolean> {
  if (firstUserId === secondUserId) return true;

  const [firstMember, secondMember] = await Promise.all([
    findUserHouseholdMembership(db, firstUserId),
    findUserHouseholdMembership(db, secondUserId),
  ]);
  return Boolean(
    firstMember &&
      secondMember &&
      firstMember.organizationId === secondMember.organizationId,
  );
}

async function findUserHouseholdMembership(
  db: Pick<Db, "select">,
  userId: string,
): Promise<HouseholdMember | undefined> {
  const [member] = await db
    .select()
    .from(schema.member)
    .where(eq(schema.member.userId, userId))
    .limit(1);
  return member;
}

async function lockUser(db: Pick<Db, "select">, userId: string): Promise<void> {
  await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .for("update")
    .limit(1);
}

async function lockHousehold(
  db: Pick<Db, "select">,
  householdId: string,
): Promise<boolean> {
  const [household] = await db
    .select({ id: schema.organization.id })
    .from(schema.organization)
    .where(eq(schema.organization.id, householdId))
    .for("update")
    .limit(1);
  return Boolean(household);
}

const EMPTY_SHOPPING_LIST: ShoppingListSnapshot = {
  recipes: [],
  checked: [],
  extras: [],
};

function shoppingListScopeFilter(scope: PantryScope): SQL {
  return scope.type === "household"
    ? eq(schema.shoppingList.organizationId, scope.householdId)
    : eq(schema.shoppingList.userId, scope.userId);
}

function shoppingListResponse(
  list: typeof schema.shoppingList.$inferSelect,
  scope: PantryScope,
): ShoppingListResponse {
  return {
    id: list.id,
    resourceId: pantryResourceId(scope),
    revision: list.revision.toString(),
    scope:
      scope.type === "household"
        ? {
            type: "household",
            household: {
              id: scope.householdId,
              name: scope.householdName,
            },
          }
        : { type: "personal" },
    snapshot: list.snapshot,
    createdAt: list.createdAt.toISOString(),
    updatedAt: list.updatedAt.toISOString(),
  };
}

async function createShoppingList(
  db: Pick<Db, "insert">,
  scope: PantryScope,
  snapshot: ShoppingListSnapshot = EMPTY_SHOPPING_LIST,
) {
  const [list] = await db
    .insert(schema.shoppingList)
    .values({
      userId: scope.type === "personal" ? scope.userId : null,
      organizationId: scope.type === "household" ? scope.householdId : null,
      snapshot,
    })
    .returning();
  if (!list) throw new Error("Shopping list was not created");
  return list;
}

async function findActiveShoppingList(
  db: Pick<Db, "select">,
  scope: PantryScope,
) {
  const [list] = await db
    .select()
    .from(schema.shoppingList)
    .where(
      and(
        shoppingListScopeFilter(scope),
        eq(schema.shoppingList.status, "active"),
      ),
    )
    .limit(1);
  return list;
}

async function currentShoppingList(db: Db, userId: string) {
  return db.transaction(async (tx) => {
    const scope = await lockPantryScope(tx, userId);
    const list =
      (await findActiveShoppingList(tx, scope)) ??
      (await createShoppingList(tx, scope));
    return shoppingListResponse(list, scope);
  });
}

async function lockPantryScope(
  db: Pick<Db, "select">,
  userId: string,
): Promise<PantryScope> {
  await lockUser(db, userId);
  const scope = await resolvePantryScope(db, userId);
  if (
    scope.type === "household" &&
    !(await lockHousehold(db, scope.householdId))
  ) {
    throw new Error("Household no longer exists");
  }
  return scope;
}

async function ensurePantryAggregate(tx: DbTransaction, scope: PantryScope) {
  const [created] = await tx
    .insert(schema.pantryAggregate)
    .values({
      userId: scope.type === "personal" ? scope.userId : null,
      organizationId: scope.type === "household" ? scope.householdId : null,
    })
    .onConflictDoNothing()
    .returning({
      id: schema.pantryAggregate.id,
      revision: schema.pantryAggregate.revision,
    });
  if (created) return created;

  const [aggregate] = await tx
    .select({
      id: schema.pantryAggregate.id,
      revision: schema.pantryAggregate.revision,
    })
    .from(schema.pantryAggregate)
    .where(pantryAggregateScopeFilter(scope))
    .for("update")
    .limit(1);
  if (!aggregate) throw new Error("Pantry aggregate could not be created");
  return aggregate;
}

async function clearPantryOperationsForScope(
  tx: DbTransaction,
  scope: PantryScope,
): Promise<void> {
  const aggregate = await findPantryAggregate(tx, scope);
  if (!aggregate) return;
  await tx
    .delete(schema.pantryOperation)
    .where(eq(schema.pantryOperation.aggregateId, aggregate.id));
}

class PantryOperationConflictError extends Error {
  constructor() {
    super("Operation ID was already used for a different pantry command");
  }
}

class UnknownPantryIngredientError extends Error {
  constructor(readonly ingredientSlug: string) {
    super(`Unknown ingredient: ${ingredientSlug}`);
  }
}

class PantryItemLimitError extends Error {
  constructor() {
    super(`A pantry can contain at most ${MAX_PANTRY_ITEMS} ingredients`);
  }
}

async function enforcePantryItemLimit(
  tx: DbTransaction,
  scope: PantryScope,
): Promise<void> {
  const items = await tx
    .select({ ingredientSlug: schema.pantryItem.ingredientSlug })
    .from(schema.pantryItem)
    .where(pantryScopeFilter(scope))
    .limit(MAX_PANTRY_ITEMS + 1);
  if (items.length > MAX_PANTRY_ITEMS) throw new PantryItemLimitError();
}

function pantryOperationId(c: Context<AppEnv>): string | Response {
  const supplied = c.req.header("Idempotency-Key");
  if (!supplied) return crypto.randomUUID();
  const parsed = uuidIdSchema.safeParse(supplied);
  return parsed.success
    ? parsed.data
    : c.json({ error: "Invalid Idempotency-Key header" }, 400);
}

function pantryStockFingerprint(
  kind: "replace" | "restore",
  stock: Record<string, PantryLocation>,
): string {
  return JSON.stringify([
    kind,
    Object.entries(stock).sort(([a], [b]) => a.localeCompare(b)),
  ]);
}

async function executePantryOperation(
  db: Db,
  userId: string,
  operationId: string,
  commandFingerprint: string,
  mutate: (tx: DbTransaction, scope: PantryScope) => Promise<void>,
): Promise<PantryResponse> {
  return db.transaction(async (tx) => {
    const scope = await lockPantryScope(tx, userId);
    const aggregate = await ensurePantryAggregate(tx, scope);
    const [recorded] = await tx
      .select({
        commandFingerprint: schema.pantryOperation.commandFingerprint,
        result: schema.pantryOperation.result,
      })
      .from(schema.pantryOperation)
      .where(
        and(
          eq(schema.pantryOperation.aggregateId, aggregate.id),
          eq(schema.pantryOperation.operationId, operationId),
        ),
      )
      .limit(1);
    if (recorded) {
      if (recorded.commandFingerprint !== commandFingerprint) {
        throw new PantryOperationConflictError();
      }
      const receipt = pantryOperationReceiptSchema.safeParse(recorded.result);
      if (receipt.success) return receipt.data.pantry;
      await tx
        .delete(schema.pantryOperation)
        .where(
          and(
            eq(schema.pantryOperation.aggregateId, aggregate.id),
            eq(schema.pantryOperation.operationId, operationId),
          ),
        );
    }

    await mutate(tx, scope);
    // A human pantry command supersedes any agent-removal absence markers.
    // Clearing them makes a later undo surface a conflict even if a recreated
    // item has since been removed again.
    await tx
      .delete(schema.pantryItemAbsence)
      .where(eq(schema.pantryItemAbsence.aggregateId, aggregate.id));
    await enforcePantryItemLimit(tx, scope);
    const [updatedAggregate] = await tx
      .update(schema.pantryAggregate)
      .set({
        revision: sql`${schema.pantryAggregate.revision} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(schema.pantryAggregate.id, aggregate.id))
      .returning({ revision: schema.pantryAggregate.revision });
    if (!updatedAggregate) throw new Error("Pantry revision update failed");

    const result = await pantryResponseForScope(tx, scope, {
      operationId,
      revision: updatedAggregate.revision,
    });
    await tx.insert(schema.pantryOperation).values({
      aggregateId: aggregate.id,
      operationId,
      commandFingerprint,
      result: { version: 1, pantry: result },
    });
    return result;
  });
}

const PANTRY_PUBLICATION_ATTEMPTS = 2;
const PANTRY_PUBLICATION_TIMEOUT_MS = 2_000;

function pantryPublicationRetryDelayMs(): number {
  const [sample = 0] = crypto.getRandomValues(new Uint8Array(1));
  if (sample < 64) return 20;
  if (sample < 128) return 33;
  if (sample < 192) return 47;
  return 60;
}

async function publishPantryChange(
  c: Context<AppEnv>,
  db: Db,
  pantry: PantryResponse,
  changeKind: PantryChangeKind,
): Promise<void> {
  if (
    pantry.scope.type !== "household" ||
    !pantry.operationId ||
    !c.env.HOUSEHOLD_REALTIME
  ) {
    return;
  }
  const householdId = pantry.scope.household.id;

  const event: PantryRealtimeEvent = {
    type: "resource.changed",
    resourceType: "pantry",
    resourceId: pantry.resourceId,
    revision: pantry.revision,
    operationId: pantry.operationId,
    changeKind,
    pantry,
  };
  let lastError: unknown;
  try {
    const authorizedUserIds = await withRecipeApiSpan(
      c,
      "pantry.realtime.membership.lookup",
      () => findHouseholdMemberUserIds(db, householdId),
    );
    const room = c.env.HOUSEHOLD_REALTIME.get(
      c.env.HOUSEHOLD_REALTIME.idFromName(pantry.resourceId),
    );
    for (
      let attempt = 1;
      attempt <= PANTRY_PUBLICATION_ATTEMPTS;
      attempt += 1
    ) {
      try {
        const response = await withRecipeApiSpan(
          c,
          "pantry.realtime.room.publish",
          () =>
            room.fetch("https://household-realtime/publish", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ event, authorizedUserIds }),
              signal: AbortSignal.timeout(PANTRY_PUBLICATION_TIMEOUT_MS),
            }),
          { "app.realtime.publish.attempt": attempt },
        );
        if (response.ok) return;
        lastError = new Error(`Realtime room returned ${response.status}`);
      } catch (error) {
        lastError = error;
      }
      if (attempt < PANTRY_PUBLICATION_ATTEMPTS) {
        await new Promise((resolve) =>
          setTimeout(resolve, pantryPublicationRetryDelayMs()),
        );
      }
    }
  } catch (error) {
    lastError = error;
  }

  console.error(
    JSON.stringify({
      message: "Pantry realtime publication failed",
      resourceType: event.resourceType,
      resourceId: event.resourceId,
      revision: event.revision,
      operationId: event.operationId,
      error:
        lastError instanceof Error ? lastError.message : String(lastError),
    }),
  );
}

async function executeCollaborativePantryOperation(
  c: Context<AppEnv>,
  db: Db,
  userId: string,
  operationId: string,
  commandFingerprint: string,
  changeKind: PantryChangeKind,
  mutate: (tx: DbTransaction, scope: PantryScope) => Promise<void>,
): Promise<PantryResponse> {
  const pantry = await withRecipeApiSpan(
    c,
    "pantry.mutation.transaction",
    () =>
      executePantryOperation(
        db,
        userId,
        operationId,
        commandFingerprint,
        mutate,
      ),
    { "app.pantry.change.kind": changeKind },
  );
  // The transaction has committed. Publication runs outside the response path,
  // so a stalled room cannot delay this command or later commands queued by the
  // same browser. Clients repair missed snapshots when they reconnect.
  const publication = withRecipeApiSpan(
    c,
    "pantry.realtime.publish",
    () => publishPantryChange(c, db, pantry, changeKind),
    { "app.pantry.change.kind": changeKind },
    { flush: true },
  );
  const executionCtx = requestExecutionContext(c);
  if (executionCtx) executionCtx.waitUntil(publication);
  else await publication;
  return pantry;
}

function requestExecutionContext(
  c: Context<AppEnv>,
): { waitUntil(promise: Promise<unknown>): void } | undefined {
  try {
    return c.executionCtx;
  } catch {
    return undefined;
  }
}

function pantryMutationErrorResponse(c: Context<AppEnv>, error: unknown) {
  if (error instanceof PantryOperationConflictError) {
    return c.json({ error: error.message }, 409);
  }
  if (error instanceof UnknownPantryIngredientError) {
    return c.json({ error: error.message }, 400);
  }
  if (error instanceof PantryItemLimitError) {
    return c.json({ error: error.message }, 409);
  }
  return undefined;
}

async function findUnknownPantryIngredient(
  db: Pick<Db, "select">,
  ingredientSlugs: string[],
): Promise<string | undefined> {
  if (ingredientSlugs.length === 0) return undefined;

  const knownIngredients = await db
    .select({ slug: schema.ingredient.slug })
    .from(schema.ingredient)
    .where(inArray(schema.ingredient.slug, ingredientSlugs));
  const knownSlugs = new Set(knownIngredients.map(({ slug }) => slug));
  return ingredientSlugs.find((slug) => !knownSlugs.has(slug));
}

async function acceptPendingInvitation(
  db: Db,
  invitation: HouseholdInvitation,
  userId: string,
  ownerNotification?: {
    userId: string;
    household: Household;
    actorUserId: string;
    actorName: string;
  },
): Promise<HouseholdMember> {
  return db.transaction(async (tx) => {
    await lockUser(tx, userId);
    if (!(await lockHousehold(tx, invitation.organizationId))) {
      throw new InvitationActionError(404, "Household not found");
    }
    const [pantryItem] = await tx
      .select({ id: schema.pantryItem.id })
      .from(schema.pantryItem)
      .where(eq(schema.pantryItem.userId, userId))
      .limit(1);
    if (pantryItem) {
      throw new InvitationActionError(
        409,
        "Pantry must be empty before joining a household",
      );
    }
    // An empty personal aggregate must not carry stale operation receipts into
    // a future solo pantry if this member later leaves the household.
    await tx
      .delete(schema.pantryAggregate)
      .where(eq(schema.pantryAggregate.userId, userId));

    const mutationTime = new Date();
    const [accepted] = await tx
      .update(schema.invitation)
      .set({ status: "accepted" })
      .where(
        and(
          eq(schema.invitation.id, invitation.id),
          eq(schema.invitation.status, "pending"),
          gt(schema.invitation.expiresAt, mutationTime),
        ),
      )
      .returning();
    if (!accepted) {
      throw new Error(
        invitation.expiresAt <= mutationTime
          ? "Invitation has expired"
          : "Invitation is not pending",
      );
    }

    const [member] = await tx
      .insert(schema.member)
      .values({
        id: createId(),
        organizationId: invitation.organizationId,
        userId,
        role: "member",
      })
      .returning();
    if (!member) throw new Error("Member insert failed");

    await markInvitationNotificationRead(
      tx,
      userId,
      invitation.id,
      mutationTime,
    );
    if (ownerNotification) {
      await createHouseholdNotification(tx, {
        recipientUserIds: [ownerNotification.userId],
        kind: "household_invite_accepted",
        household: ownerNotification.household,
        actor: {
          id: ownerNotification.actorUserId,
          name: ownerNotification.actorName,
        },
      });
    }
    return member;
  });
}

function invitationNotificationStatus(
  type: string,
  status: string | null,
  expiresAt: Date | null,
): InvitationNotificationStatus | null {
  if (type !== "household_invited") return null;
  if (status === "accepted") return "accepted";
  if (status === "rejected") return "declined";
  if (status === "pending" && expiresAt && expiresAt.getTime() <= Date.now()) {
    return "expired";
  }
  if (status === "pending") return "pending";
  return "unavailable";
}

type NotificationBaseRow = {
  id: string;
  eventId: string;
  kind: string;
  actorUserId: string | null;
  actorName: string | null;
  readAt: Date | null;
  occurredAt: Date;
};

type AgentApprovalNotificationStatus =
  | "pending"
  | "approved"
  | "denied"
  | "expired"
  | "unavailable";

function agentApprovalNotificationStatus(
  status: string | null,
  expiresAt: Date,
): AgentApprovalNotificationStatus {
  if (status === "approved") return "approved";
  if (status === "denied") return "denied";
  if (status === "pending" && expiresAt.getTime() > Date.now()) {
    return "pending";
  }
  if (status === "pending" || expiresAt.getTime() <= Date.now()) {
    return "expired";
  }
  return "unavailable";
}

const notificationBaseSelection = {
  id: schema.notificationDelivery.id,
  eventId: schema.notificationEvent.id,
  kind: schema.notificationEvent.kind,
  actorUserId: schema.notificationEvent.actorUserId,
  actorName: schema.notificationEvent.actorNameSnapshot,
  readAt: schema.notificationDelivery.readAt,
  occurredAt: schema.notificationEvent.occurredAt,
};

const householdNotificationKinds = new Set<HouseholdNotificationKind>([
  "household_invited",
  "household_removed",
  "household_deleted",
  "household_invite_accepted",
  "household_invite_declined",
  "household_member_left",
]);

function isHouseholdNotificationKind(
  kind: string,
): kind is HouseholdNotificationKind {
  return householdNotificationKinds.has(kind as HouseholdNotificationKind);
}

async function hydrateNotifications(
  db: Db,
  recipientUserId: string,
  rows: NotificationBaseRow[],
  approvalCodeSecret: string,
) {
  const agentApprovalEventIds = rows
    .filter(({ kind }) => kind === "agent_approval_requested")
    .map(({ eventId }) => eventId);
  const householdEventIds = rows
    .filter(({ kind }) => isHouseholdNotificationKind(kind))
    .map(({ eventId }) => eventId);
  const recommendationEventIds = rows
    .filter(({ kind }) => kind === "recipe_recommended")
    .map(({ eventId }) => eventId);

  const [agentApprovalRows, householdRows, recommendationRows] =
    await Promise.all([
      agentApprovalEventIds.length === 0
        ? []
        : db
            .select({
              eventId: schema.notificationAgentApprovalEvent.eventId,
              agentId: schema.notificationAgentApprovalEvent.agentIdSnapshot,
              agentName:
                schema.notificationAgentApprovalEvent.agentNameSnapshot,
              capabilities:
                schema.notificationAgentApprovalEvent.capabilitiesSnapshot,
              expiresAtSnapshot:
                schema.notificationAgentApprovalEvent.expiresAtSnapshot,
              approvalCodeCiphertext:
                schema.notificationAgentApprovalEvent.approvalCodeCiphertext,
              approvalStatus: schema.approvalRequest.status,
              approvalExpiresAt: schema.approvalRequest.expiresAt,
            })
            .from(schema.notificationAgentApprovalEvent)
            .leftJoin(
              schema.approvalRequest,
              eq(
                schema.notificationAgentApprovalEvent.approvalRequestId,
                schema.approvalRequest.id,
              ),
            )
            .where(
              inArray(
                schema.notificationAgentApprovalEvent.eventId,
                agentApprovalEventIds,
              ),
            ),
      householdEventIds.length === 0
        ? []
        : db
            .select({
              eventId: schema.notificationHouseholdEvent.eventId,
              householdId: schema.notificationHouseholdEvent.householdId,
              householdName:
                schema.notificationHouseholdEvent.householdNameSnapshot,
              invitationStatus: schema.invitation.status,
              invitationExpiresAt: schema.invitation.expiresAt,
            })
            .from(schema.notificationHouseholdEvent)
            .leftJoin(
              schema.notificationHouseholdInvitationEvent,
              eq(
                schema.notificationHouseholdEvent.eventId,
                schema.notificationHouseholdInvitationEvent.eventId,
              ),
            )
            .leftJoin(
              schema.invitation,
              eq(
                schema.notificationHouseholdInvitationEvent.invitationId,
                schema.invitation.id,
              ),
            )
            .where(
              inArray(
                schema.notificationHouseholdEvent.eventId,
                householdEventIds,
              ),
            ),
      recommendationEventIds.length === 0
        ? []
        : db
            .select({
              eventId: schema.notificationRecipeRecommendationEvent.eventId,
              recipeId: schema.notificationRecipeRecommendationEvent.recipeId,
              recipeSlug:
                schema.notificationRecipeRecommendationEvent.recipeSlugSnapshot,
              recipeTitle:
                schema.notificationRecipeRecommendationEvent.recipeTitleSnapshot,
              recipeVisibility: schema.recipe.visibility,
              recipeOwnerUserId: schema.recipe.userId,
            })
            .from(schema.notificationRecipeRecommendationEvent)
            .leftJoin(
              schema.recipe,
              eq(
                schema.notificationRecipeRecommendationEvent.recipeId,
                schema.recipe.id,
              ),
            )
            .where(
              inArray(
                schema.notificationRecipeRecommendationEvent.eventId,
                recommendationEventIds,
              ),
            ),
    ]);
  const agentApprovalsByEventId = new Map(
    agentApprovalRows.map((row) => [row.eventId, row]),
  );
  const householdsByEventId = new Map(
    householdRows.map((row) => [row.eventId, row]),
  );
  const recommendationsByEventId = new Map(
    recommendationRows.map((row) => [row.eventId, row]),
  );
  const recommendationSlugs = recommendationRows.map(
    ({ recipeSlug }) => recipeSlug,
  );
  const [agentApprovalCodes, savedRecommendationSlugs, recipientMembership] =
    await Promise.all([
      Promise.all(
        agentApprovalRows.map(async (row) => [
          row.eventId,
          row.approvalCodeCiphertext &&
          agentApprovalNotificationStatus(
            row.approvalStatus,
            row.approvalExpiresAt ?? row.expiresAtSnapshot,
          ) === "pending"
            ? await decryptAgentApprovalCode(
                row.approvalCodeCiphertext,
                approvalCodeSecret,
              ).catch(() => null)
            : null,
        ] as const),
      ),
      recommendationSlugs.length === 0
        ? []
        : db
            .select({ recipeSlug: schema.userRecipeBoxItem.recipeSlug })
            .from(schema.userRecipeBoxItem)
            .where(
              and(
                eq(schema.userRecipeBoxItem.userId, recipientUserId),
                inArray(
                  schema.userRecipeBoxItem.recipeSlug,
                  recommendationSlugs,
                ),
              ),
            ),
      recommendationRows.length === 0
        ? undefined
        : findUserHouseholdMembership(db, recipientUserId),
    ]);
  const agentApprovalCodesByEventId = new Map(agentApprovalCodes);
  const savedRecipeSlugs = new Set(
    savedRecommendationSlugs.map(({ recipeSlug }) => recipeSlug),
  );
  const householdMemberUserIds = new Set(
    recipientMembership
      ? await findHouseholdMemberUserIds(
          db,
          recipientMembership.organizationId,
        )
      : [],
  );

  function baseNotification(row: NotificationBaseRow) {
    return {
      id: row.id,
      eventId: row.eventId,
      kind: row.kind,
      actor:
        row.actorUserId || row.actorName
          ? { id: row.actorUserId, name: row.actorName }
          : null,
      readAt: row.readAt,
      occurredAt: row.occurredAt,
    };
  }

  function hydrateAgentApprovalNotification(row: NotificationBaseRow) {
    const detail = agentApprovalsByEventId.get(row.eventId);
    if (!detail) {
      throw new Error(
        `Agent approval notification ${row.eventId} has no subtype row`,
      );
    }
    const expiresAt = detail.approvalExpiresAt ?? detail.expiresAtSnapshot;
    const status = agentApprovalNotificationStatus(
      detail.approvalStatus,
      expiresAt,
    );
    const approvalCode = agentApprovalCodesByEventId.get(row.eventId);
    return {
      ...baseNotification(row),
      kind: "agent_approval_requested" as const,
      detail: {
        type: "agent_approval" as const,
        agent: { id: detail.agentId, name: detail.agentName },
        capabilities: detail.capabilities.split(" ").filter(Boolean),
        status,
        expiresAt,
        reviewUrl:
          status === "pending" && approvalCode
            ? `/recipes/settings/agents/approve?agent_id=${encodeURIComponent(detail.agentId)}&code=${encodeURIComponent(approvalCode)}`
            : null,
      },
      actions: [] as string[],
    };
  }

  function hydrateRecipeRecommendationNotification(
    row: NotificationBaseRow,
  ) {
    const detail = recommendationsByEventId.get(row.eventId);
    if (!detail) {
      throw new Error(
        `Recipe recommendation notification ${row.eventId} has no subtype row`,
      );
    }
    const saved = savedRecipeSlugs.has(detail.recipeSlug);
    const available =
      detail.recipeId !== null &&
      (detail.recipeVisibility === "public" ||
        (detail.recipeVisibility === "household" &&
          detail.recipeOwnerUserId !== null &&
          householdMemberUserIds.has(detail.recipeOwnerUserId)));
    return {
      ...baseNotification(row),
      kind: "recipe_recommended" as const,
      detail: {
        type: "recipe_recommendation" as const,
        recipe: {
          slug: detail.recipeSlug,
          title: detail.recipeTitle,
          available,
        },
        saved,
      },
      actions: available && !saved ? (["add_to_recipe_box"] as const) : [],
    };
  }

  function hydrateHouseholdNotification(row: NotificationBaseRow) {
    const detail = householdsByEventId.get(row.eventId);
    if (!detail) {
      throw new Error(`Household notification ${row.eventId} has no subtype row`);
    }
    const invitationStatus = invitationNotificationStatus(
      row.kind,
      detail.invitationStatus,
      detail.invitationExpiresAt,
    );
    return {
      ...baseNotification(row),
      kind: row.kind as HouseholdNotificationKind,
      detail: {
        type: "household" as const,
        household: {
          id: detail.householdId,
          name: detail.householdName,
        },
        invitationStatus,
      },
      actions:
        row.kind === "household_invited" && invitationStatus === "pending"
          ? (["accept", "decline"] as const)
          : [],
    };
  }

  return rows.map((row) => {
    if (row.kind === "agent_approval_requested") {
      return hydrateAgentApprovalNotification(row);
    }
    if (row.kind === "recipe_recommended") {
      return hydrateRecipeRecommendationNotification(row);
    }
    if (!isHouseholdNotificationKind(row.kind)) {
      return {
        ...baseNotification(row),
        detail: null,
        actions: [] as string[],
      };
    }
    return hydrateHouseholdNotification(row);
  });
}

function invitationAcceptanceFailure(
  c: Context<AppEnv>,
  error: unknown,
): Response | undefined {
  if (isUniqueViolation(error)) {
    return c.json({ error: "User already belongs to a household" }, 409);
  }
  if (error instanceof Error && error.message === "Invitation is not pending") {
    return c.json({ error: "Invitation is not pending" }, 409);
  }
  if (error instanceof Error && error.message === "Invitation has expired") {
    return c.json({ error: "Invitation has expired" }, 410);
  }
  return undefined;
}

class InvitationActionError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 410,
    message: string,
  ) {
    super(message);
  }
}

async function performInvitationAction(
  db: Db,
  user: AuthenticatedSession["user"],
  invitationId: string,
  action: "accept" | "decline",
) {
  const [invitation] = await db
    .select()
    .from(schema.invitation)
    .where(eq(schema.invitation.id, invitationId))
    .limit(1);
  if (!invitation) throw new InvitationActionError(404, "Invitation not found");
  if (invitation.status !== "pending") {
    throw new InvitationActionError(409, "Invitation is not pending");
  }
  if (invitation.expiresAt.getTime() < Date.now()) {
    throw new InvitationActionError(410, "Invitation has expired");
  }
  if (!(await userOwnsVerifiedEmail(db, user, invitation.email))) {
    throw new InvitationActionError(403, "Authorization required");
  }

  const [household, owner] = await Promise.all([
    findHouseholdById(db, invitation.organizationId),
    findHouseholdOwner(db, invitation.organizationId),
  ]);
  if (action === "accept") {
    if (await findUserHouseholdMembership(db, user.id)) {
      throw new InvitationActionError(
        409,
        "User already belongs to a household",
      );
    }
    const member = await acceptPendingInvitation(
      db,
      invitation,
      user.id,
      household && owner
        ? {
            userId: owner.userId,
            household,
            actorUserId: user.id,
            actorName: user.name,
          }
        : undefined,
    );
    return {
      invitation: { ...invitation, status: "accepted" },
      membershipCreated: Boolean(member),
    };
  }

  const mutationTime = new Date();
  const declined = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(schema.invitation)
      .set({ status: "rejected" })
      .where(
        and(
          eq(schema.invitation.id, invitationId),
          eq(schema.invitation.status, "pending"),
          gt(schema.invitation.expiresAt, mutationTime),
        ),
      )
      .returning();
    if (!updated) return undefined;

    await markInvitationNotificationRead(tx, user.id, invitationId, mutationTime);
    if (household && owner) {
      await createHouseholdNotification(tx, {
        recipientUserIds: [owner.userId],
        kind: "household_invite_declined",
        household,
        actor: { id: user.id, name: user.name },
      });
    }
    return updated;
  });
  if (!declined) {
    throw new InvitationActionError(
      invitation.expiresAt <= mutationTime ? 410 : 409,
      invitation.expiresAt <= mutationTime
        ? "Invitation has expired"
        : "Invitation is not pending",
    );
  }
  return { invitation: declined, membershipCreated: false };
}

function invitationActionFailure(
  c: Context<AppEnv>,
  error: unknown,
): Response | undefined {
  if (error instanceof InvitationActionError) {
    return c.json({ error: error.message }, error.status);
  }
  return invitationAcceptanceFailure(c, error);
}

async function dispatchNotificationAction(
  db: Db,
  user: AuthenticatedSession["user"],
  event: { id: string; kind: string },
  actionKey: string,
) {
  if (event.kind === "recipe_recommended") {
    await performRecipeRecommendationAction(db, user, event.id, actionKey);
    return;
  }
  if (event.kind !== "household_invited") {
    throw new InvitationActionError(
      409,
      "Notification action is no longer available",
    );
  }
  if (actionKey !== "accept" && actionKey !== "decline") {
    throw new InvitationActionError(400, "Unknown notification action");
  }
  const [detail] = await db
    .select({
      invitationId: schema.notificationHouseholdInvitationEvent.invitationId,
    })
    .from(schema.notificationHouseholdInvitationEvent)
    .where(eq(schema.notificationHouseholdInvitationEvent.eventId, event.id))
    .limit(1);
  if (!detail?.invitationId) {
    throw new InvitationActionError(
      409,
      "Notification action is no longer available",
    );
  }
  await performInvitationAction(db, user, detail.invitationId, actionKey);
}

async function performRecipeRecommendationAction(
  db: Db,
  user: AuthenticatedSession["user"],
  eventId: string,
  actionKey: string,
) {
  if (actionKey !== "add_to_recipe_box") {
    throw new InvitationActionError(400, "Unknown notification action");
  }
  const [detail] = await db
    .select({
      recipeId: schema.notificationRecipeRecommendationEvent.recipeId,
      recipeSlug:
        schema.notificationRecipeRecommendationEvent.recipeSlugSnapshot,
    })
    .from(schema.notificationRecipeRecommendationEvent)
    .where(eq(schema.notificationRecipeRecommendationEvent.eventId, eventId))
    .limit(1);
  if (!detail?.recipeId) {
    throw new InvitationActionError(409, "This recipe is no longer available");
  }
  const recipe = await findRecipeBySlug(db, detail.recipeSlug);
  if (recipe?.id !== detail.recipeId) {
    throw new InvitationActionError(409, "This recipe is no longer available");
  }
  if (recipe.visibility !== "public") {
    const decision = authorizeRecipeRead(user, recipe, {
      userSharesHouseholdWithOwner: await usersShareHousehold(
        db,
        recipe.userId,
        user.id,
      ),
    });
    if (!decision.allowed) {
      throw new InvitationActionError(
        409,
        "This recipe is no longer available to you",
      );
    }
  }
  await db.transaction(async (tx) => {
    const mutationTime = new Date();
    await tx
      .insert(schema.userRecipeBoxItem)
      .values({ userId: user.id, recipeSlug: detail.recipeSlug })
      .onConflictDoNothing();
    await tx
      .update(schema.notificationDelivery)
      .set({ readAt: mutationTime })
      .where(
        and(
          eq(schema.notificationDelivery.eventId, eventId),
          eq(schema.notificationDelivery.recipientUserId, user.id),
        ),
      );
  });
}

async function findHouseholdMemberUserIds(
  db: Pick<Db, "select">,
  householdId: string,
): Promise<string[]> {
  const members = await db
    .select({ userId: schema.member.userId })
    .from(schema.member)
    .where(eq(schema.member.organizationId, householdId));
  return members.map((member) => member.userId);
}

async function findHouseholdById(
  db: Pick<Db, "select">,
  householdId: string,
): Promise<Household | undefined> {
  const [household] = await db
    .select()
    .from(schema.organization)
    .where(eq(schema.organization.id, householdId))
    .limit(1);
  return household;
}

async function findHouseholdOwner(
  db: Db,
  householdId: string,
): Promise<HouseholdMember | undefined> {
  const [owner] = await db
    .select()
    .from(schema.member)
    .where(
      and(
        eq(schema.member.organizationId, householdId),
        eq(schema.member.role, "owner"),
      ),
    )
    .limit(1);
  return owner;
}

async function findHouseholdMembership(
  db: Pick<Db, "select">,
  householdId: string,
  userId: string,
): Promise<HouseholdMember | undefined> {
  const [member] = await db
    .select()
    .from(schema.member)
    .where(
      and(
        eq(schema.member.organizationId, householdId),
        eq(schema.member.userId, userId),
      ),
    )
    .limit(1);
  return member;
}

async function findDietProfile(
  db: Db,
  userId: string,
): Promise<DietProfileResponse | undefined> {
  const [profiles, presets, ingredients, groups] = await Promise.all([
    db
      .select()
      .from(schema.userDietProfile)
      .where(eq(schema.userDietProfile.userId, userId))
      .limit(1),
    db
      .select({ key: schema.userDietPreset.presetKey })
      .from(schema.userDietPreset)
      .where(eq(schema.userDietPreset.userId, userId)),
    db
      .select({ slug: schema.userDietExcludedIngredient.ingredientSlug })
      .from(schema.userDietExcludedIngredient)
      .where(eq(schema.userDietExcludedIngredient.userId, userId)),
    db
      .select({ key: schema.userDietExcludedGroup.groupKey })
      .from(schema.userDietExcludedGroup)
      .where(eq(schema.userDietExcludedGroup.userId, userId)),
  ]);
  const profile = profiles[0];
  if (!profile) return undefined;

  return {
    presetDietKeys: presets.map((preset) => preset.key),
    excludedIngredientSlugs: ingredients.map((ingredient) => ingredient.slug),
    excludedGroupKeys: groups.map((group) => group.key),
    recipeMatchMode: profile.recipeMatchMode,
  };
}

type IngredientGroupRelation = {
  narrowerGroupKey: string;
  broaderGroupKey: string;
  relationType: (typeof schema.ingredientGroupRelationTypeEnum.enumValues)[number];
};

function addToSetMap(
  map: Map<string, Set<string>>,
  key: string,
  value: string,
) {
  const values = map.get(key) ?? new Set<string>();
  values.add(value);
  map.set(key, values);
}

function directIngredientSlugsByGroup(
  groupMembers: readonly { groupKey: string; ingredientSlug: string }[],
) {
  const directIngredientSlugs = new Map<string, Set<string>>();
  for (const row of groupMembers) {
    addToSetMap(directIngredientSlugs, row.groupKey, row.ingredientSlug);
  }
  return directIngredientSlugs;
}

function narrowerClassificationKeysByGroup(
  groupRelations: readonly IngredientGroupRelation[],
) {
  const narrowerGroupKeys = new Map<string, Set<string>>();
  for (const relation of groupRelations) {
    if (relation.relationType !== "classification") continue;
    addToSetMap(
      narrowerGroupKeys,
      relation.broaderGroupKey,
      relation.narrowerGroupKey,
    );
  }
  return narrowerGroupKeys;
}

function expandedIngredientSlugsForGroup(
  groupKey: string,
  directIngredientSlugs: ReadonlyMap<string, ReadonlySet<string>>,
  narrowerGroupKeys: ReadonlyMap<string, ReadonlySet<string>>,
): string[] {
  const ingredientSlugs = new Set<string>();
  const visitedGroupKeys = new Set<string>();
  const pendingGroupKeys = [groupKey];

  while (pendingGroupKeys.length > 0) {
    const currentGroupKey = pendingGroupKeys.pop();
    if (!currentGroupKey || visitedGroupKeys.has(currentGroupKey)) continue;
    visitedGroupKeys.add(currentGroupKey);

    for (const ingredientSlug of
      directIngredientSlugs.get(currentGroupKey) ?? []) {
      ingredientSlugs.add(ingredientSlug);
    }
    for (const narrowerGroupKey of narrowerGroupKeys.get(currentGroupKey) ??
      []) {
      pendingGroupKeys.push(narrowerGroupKey);
    }
  }

  return [...ingredientSlugs].sort((a, b) => a.localeCompare(b));
}

function expandedIngredientSlugsByGroup(
  groupKeys: readonly string[],
  groupMembers: readonly { groupKey: string; ingredientSlug: string }[],
  groupRelations: readonly IngredientGroupRelation[],
): Map<string, string[]> {
  const directIngredientSlugs = directIngredientSlugsByGroup(groupMembers);
  const narrowerGroupKeys =
    narrowerClassificationKeysByGroup(groupRelations);
  return new Map(
    groupKeys.map((groupKey) => [
      groupKey,
      expandedIngredientSlugsForGroup(
        groupKey,
        directIngredientSlugs,
        narrowerGroupKeys,
      ),
    ]),
  );
}

async function listDietOptions(db: Db) {
  const [
    ingredients,
    groups,
    groupMembers,
    groupHierarchy,
    presets,
    presetGroups,
    presetIngredients,
  ] = await Promise.all([
      db
        .select({
          slug: schema.ingredient.slug,
          name: schema.ingredient.name,
          category: schema.ingredient.category,
        })
        .from(schema.ingredient),
      db
        .select({
          key: schema.ingredientGroup.key,
          label: schema.ingredientGroup.label,
          sub: schema.ingredientGroup.description,
        })
        .from(schema.ingredientGroup),
      db
        .select({
          groupKey: schema.ingredientGroupMember.groupKey,
          ingredientSlug: schema.ingredientGroupMember.ingredientSlug,
        })
        .from(schema.ingredientGroupMember),
      db
        .select({
          narrowerGroupKey: schema.ingredientGroupHierarchy.narrowerGroupKey,
          broaderGroupKey: schema.ingredientGroupHierarchy.broaderGroupKey,
          relationType: schema.ingredientGroupHierarchy.relationType,
        })
        .from(schema.ingredientGroupHierarchy),
      db
        .select({
          key: schema.dietPreset.key,
          label: schema.dietPreset.label,
          sub: schema.dietPreset.description,
        })
        .from(schema.dietPreset),
      db
        .select({
          presetKey: schema.dietPresetExcludedGroup.presetKey,
          groupKey: schema.dietPresetExcludedGroup.groupKey,
        })
        .from(schema.dietPresetExcludedGroup),
      db
        .select({
          presetKey: schema.dietPresetExcludedIngredient.presetKey,
          ingredientSlug: schema.dietPresetExcludedIngredient.ingredientSlug,
        })
        .from(schema.dietPresetExcludedIngredient),
    ]);

  const groupKeysByPreset = new Map<string, string[]>();
  for (const row of presetGroups) {
    const groupKeys = groupKeysByPreset.get(row.presetKey) ?? [];
    groupKeys.push(row.groupKey);
    groupKeysByPreset.set(row.presetKey, groupKeys);
  }

  const ingredientSlugsByPreset = new Map<string, string[]>();
  for (const row of presetIngredients) {
    const ingredientSlugs = ingredientSlugsByPreset.get(row.presetKey) ?? [];
    ingredientSlugs.push(row.ingredientSlug);
    ingredientSlugsByPreset.set(row.presetKey, ingredientSlugs);
  }

  const ingredientSlugsByGroup = expandedIngredientSlugsByGroup(
    groups.map((group) => group.key),
    groupMembers,
    groupHierarchy,
  );

  const broaderGroupKeysByGroup = new Map<string, string[]>();
  for (const row of groupHierarchy) {
    if (row.relationType !== "classification") continue;

    const broaderGroupKeys =
      broaderGroupKeysByGroup.get(row.narrowerGroupKey) ?? [];
    broaderGroupKeys.push(row.broaderGroupKey);
    broaderGroupKeysByGroup.set(row.narrowerGroupKey, broaderGroupKeys);
  }

  return {
    presets: presets
      .map((preset) => ({
        key: preset.key,
        label: preset.label,
        sub: preset.sub ?? "",
        excludedGroupKeys: groupKeysByPreset.get(preset.key) ?? [],
        excludedIngredientSlugs:
          ingredientSlugsByPreset.get(preset.key) ?? [],
      }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    groups: groups
      .map((group) => ({
        key: group.key,
        label: group.label,
        sub: group.sub ?? "",
        broaderGroupKeys: (
          broaderGroupKeysByGroup.get(group.key) ?? []
        ).sort((a, b) => a.localeCompare(b)),
        ingredientSlugs: ingredientSlugsByGroup.get(group.key) ?? [],
      }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    ingredients: ingredients
      .map((ingredient) => ({
        slug: ingredient.slug,
        name: ingredient.name,
        category: ingredient.category ?? undefined,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

async function findMissingDietReferences(
  db: Pick<Db, "select">,
  body: z.infer<typeof updateDietProfileBodySchema>,
) {
  const [presets, ingredients, groups] = await Promise.all([
    body.presetDietKeys.length > 0
      ? db
          .select({ key: schema.dietPreset.key })
          .from(schema.dietPreset)
          .where(inArray(schema.dietPreset.key, body.presetDietKeys))
      : [],
    body.excludedIngredientSlugs.length > 0
      ? db
          .select({ slug: schema.ingredient.slug })
          .from(schema.ingredient)
          .where(
            inArray(
              schema.ingredient.slug,
              body.excludedIngredientSlugs,
            ),
          )
      : [],
    body.excludedGroupKeys.length > 0
      ? db
          .select({ key: schema.ingredientGroup.key })
          .from(schema.ingredientGroup)
          .where(inArray(schema.ingredientGroup.key, body.excludedGroupKeys))
      : [],
  ]);

  const presetKeys = new Set(presets.map((preset) => preset.key));
  const ingredientSlugs = new Set(
    ingredients.map((ingredient) => ingredient.slug),
  );
  const groupKeys = new Set(groups.map((group) => group.key));

  return [
    ...body.presetDietKeys
      .filter((key) => !presetKeys.has(key))
      .map((key) => ({
        path: ["presetDietKeys"],
        message: `Unknown diet preset: ${key}`,
      })),
    ...body.excludedIngredientSlugs
      .filter((slug) => !ingredientSlugs.has(slug))
      .map((slug) => ({
        path: ["excludedIngredientSlugs"],
        message: `Unknown ingredient: ${slug}`,
      })),
    ...body.excludedGroupKeys
      .filter((key) => !groupKeys.has(key))
      .map((key) => ({
        path: ["excludedGroupKeys"],
        message: `Unknown ingredient group: ${key}`,
      })),
  ];
}

async function authorizeHouseholdOwnerResponse(
  c: Context<AppEnv>,
  db: Db,
  householdId: string,
  session: AuthenticatedSession,
): Promise<Response | undefined> {
  const [household, owner] = await Promise.all([
    findHouseholdById(db, householdId),
    findHouseholdOwner(db, householdId),
  ]);
  if (!household) return c.notFound();

  const decision = owner
    ? authorizeHouseholdMembershipManagement(session.user, {
        ownerId: owner.userId,
      })
    : forbidden();
  if (!decision.allowed) return authorizationResponse(c, decision);
  return undefined;
}

async function requireHouseholdMemberResponse(
  c: Context<AppEnv>,
  db: Db,
  householdId: string,
  session: AuthenticatedSession,
): Promise<Response | undefined> {
  const [household, membership] = await Promise.all([
    findHouseholdById(db, householdId),
    findHouseholdMembership(db, householdId, session.user.id),
  ]);
  if (!household) return c.notFound();

  if (!membership) return authorizationResponse(c, forbidden());
  return undefined;
}

async function hasPreviewAccess(request: Request, env: Bindings) {
  return isPreviewAuthEnabled(env) && verifyCloudflareAccess(request, env);
}

registerRoute("get", "/api/auth/preview/scenarios", async (c) => {
  if (!isPreviewAuthEnabled(c.env)) return c.notFound();
  if (!hasAuthConfiguration(c.env)) {
    return c.json({ error: "Preview auth configuration is incomplete" }, 503);
  }
  if (!(await hasPreviewAccess(c.req.raw, c.env))) {
    return c.json({ error: "Cloudflare Access authorization required" }, 403);
  }

  return c.json(
    previewScenarios.map(({ id, name, description }) => ({
      id,
      name,
      description,
    })),
  );
});

registerRoute("post", "/api/auth/preview/sign-up", async (c) => {
  if (!isPreviewAuthEnabled(c.env)) return c.notFound();
  if (!hasAuthConfiguration(c.env)) {
    return c.json({ error: "Preview auth configuration is incomplete" }, 503);
  }
  if (!(await hasPreviewAccess(c.req.raw, c.env))) {
    return c.json({ error: "Cloudflare Access authorization required" }, 403);
  }

  const csrfFailure = validateCsrf(c);
  if (csrfFailure) return csrfFailure;

  const connectionString = requireDatabaseConnection(c);
  if (connectionString instanceof Response) return connectionString;

  const { db, client } = createDb(connectionString);
  const suffix = crypto.randomUUID();
  const credentials = {
    email: `qa-${suffix}@preview.invalid`,
    name: `Fresh QA account ${suffix.slice(0, 8)}`,
    password: c.env.PREVIEW_AUTH_PASSWORD!,
  };
  try {
    const auth = createAuth(db, c.env, {
      allowPreviewSignUp: true,
      autoSignInPreviewSignUp: true,
    });
    return await auth.api.signUpEmail({
      body: credentials,
      headers: c.req.raw.headers,
      asResponse: true,
    });
  } catch (error) {
    console.error("Preview sign-up failed", error);
    return c.json({ error: "Preview sign-up failed" }, 502);
  } finally {
    await closeDbClient(client);
  }
});

registerRoute("post", "/api/auth/preview/sign-in", async (c) => {
  if (!isPreviewAuthEnabled(c.env)) return c.notFound();
  if (!hasAuthConfiguration(c.env)) {
    return c.json({ error: "Preview auth configuration is incomplete" }, 503);
  }
  if (!(await hasPreviewAccess(c.req.raw, c.env))) {
    return c.json({ error: "Cloudflare Access authorization required" }, 403);
  }

  const csrfFailure = validateCsrf(c);
  if (csrfFailure) return csrfFailure;

  const body = await parseJsonBody(c, previewSignInBodySchema);
  if (!body.success) return body.response;

  const scenario = findPreviewScenario(body.data.scenario);
  if (!scenario) return c.json({ error: "Unknown preview scenario" }, 400);

  const connectionString = requireDatabaseConnection(c);
  if (connectionString instanceof Response) return connectionString;

  const { db, client } = createDb(connectionString);
  try {
    const auth = createAuth(db, c.env);
    return await auth.api.signInEmail({
      body: {
        email: scenario.email,
        password: c.env.PREVIEW_AUTH_PASSWORD!,
      },
      headers: c.req.raw.headers,
      asResponse: true,
    });
  } catch (error) {
    console.error("Preview sign-in failed", error);
    return c.json({ error: "Preview sign-in failed" }, 401);
  } finally {
    await closeDbClient(client);
  }
});

app.on(["POST", "GET"], "/api/auth/*", async (c) => {
  // Preview credentials are server-owned. Only the Access-protected scenario
  // endpoint above may invoke Better Auth's email/password API.
  const blockedPasswordRoute = /^\/api\/auth\/sign-(in|up)\/email\/?$/;
  if (blockedPasswordRoute.test(c.req.path)) {
    return c.notFound();
  }
  // Households reuse Better Auth's organization tables but are managed entirely
  // through our own authorization-checked endpoints. Better Auth's organization
  // plugin is intentionally not registered; block these paths defensively so the
  // raw organization API can never be exposed.
  if (/^\/api\/auth\/organization(?:\/|$)/.test(c.req.path)) {
    return c.notFound();
  }

  const connectionString = requireDatabaseConnection(c);
  if (connectionString instanceof Response) return connectionString;
  if (!hasAuthConfiguration(c.env)) {
    return c.json({ error: "Auth configuration is incomplete" }, 503);
  }
  if (!isValidAuthURL(c.env.BETTER_AUTH_URL)) {
    return c.json({ error: "Auth configuration is invalid" }, 503);
  }

  const hasSessionCookie =
    /(?:^|;\s*)(?:__Secure-)?better-auth[.-]session_token=/.test(
      c.req.header("cookie") ?? "",
    );
  const machineAgentRequest =
    /^\/api\/auth\/(?:agent|capability|host)(?:\/|$)/.test(c.req.path) &&
    !hasSessionCookie &&
    (Boolean(c.req.header("authorization")) ||
      c.req.path === "/api/auth/agent/device/code" ||
      c.req.path === "/api/auth/host/enroll");
  const csrfFailure = machineAgentRequest ? undefined : validateCsrf(c);
  if (csrfFailure) return csrfFailure;

  const { db, client } = createDb(connectionString);
  try {
    const auth = createAuth(db, c.env);
    const response = await auth.handler(c.req.raw);
    if (c.req.path.replace(/\/$/, "") === "/api/auth/agent/register") {
      try {
        await notifyAgentRegistrationApproval(
          db,
          response,
          c.env.BETTER_AUTH_SECRET,
        );
      } catch (error) {
        console.error("Agent approval notification creation failed", error);
      }
    }
    return response;
  } finally {
    await closeDbClient(client);
  }
});

registerRoute("get", "/api/profile/diet", async (c) => {
  return withRecipeSession(
    c,
    "query",
    "GET /api/profile/diet query failed",
    async ({ db, session }) => {
      const profile =
        (await findDietProfile(db, session.user.id)) ??
        defaultDietProfile(session.user.id);
      return c.json(dietProfileResponse(profile));
    },
  );
});

registerRoute("get", "/api/profile/diet/options", async (c) => {
  return withRecipeSession(
    c,
    "query",
    "GET /api/profile/diet/options query failed",
    async ({ db }) => c.json(await listDietOptions(db)),
  );
});

registerRoute("put", "/api/profile/diet", async (c) => {
  const csrfFailure = validateCsrf(c);
  if (csrfFailure) return csrfFailure;

  const body = await parseJsonBody(c, updateDietProfileBodySchema);
  if (!body.success) return body.response;

  return withRecipeSession(
    c,
    "mutation",
    "PUT /api/profile/diet mutation failed",
    async ({ db, session }) => {
      try {
        const profile = await db.transaction(async (tx) => {
          const missingReferences = await findMissingDietReferences(tx, body.data);
          if (missingReferences.length > 0) {
            throw new MissingDietReferencesError(missingReferences);
          }

          const [savedProfile] = await tx
            .insert(schema.userDietProfile)
            .values({
              userId: session.user.id,
              recipeMatchMode: body.data.recipeMatchMode,
            })
            .onConflictDoUpdate({
              target: schema.userDietProfile.userId,
              set: {
                recipeMatchMode: body.data.recipeMatchMode,
                updatedAt: new Date(),
              },
            })
            .returning();

          if (!savedProfile) throw new Error("Diet profile upsert failed");

          await Promise.all([
            tx
              .delete(schema.userDietPreset)
              .where(eq(schema.userDietPreset.userId, session.user.id)),
            tx
              .delete(schema.userDietExcludedIngredient)
              .where(
                eq(schema.userDietExcludedIngredient.userId, session.user.id),
              ),
            tx
              .delete(schema.userDietExcludedGroup)
              .where(eq(schema.userDietExcludedGroup.userId, session.user.id)),
          ]);

          if (body.data.presetDietKeys.length > 0) {
            await tx.insert(schema.userDietPreset).values(
              body.data.presetDietKeys.map((presetKey) => ({
                userId: session.user.id,
                presetKey,
              })),
            );
          }

          if (body.data.excludedIngredientSlugs.length > 0) {
            await tx.insert(schema.userDietExcludedIngredient).values(
              body.data.excludedIngredientSlugs.map((ingredientSlug) => ({
                userId: session.user.id,
                ingredientSlug,
              })),
            );
          }

          if (body.data.excludedGroupKeys.length > 0) {
            await tx.insert(schema.userDietExcludedGroup).values(
              body.data.excludedGroupKeys.map((groupKey) => ({
                userId: session.user.id,
                groupKey,
              })),
            );
          }

          return {
            presetDietKeys: body.data.presetDietKeys,
            excludedIngredientSlugs: body.data.excludedIngredientSlugs,
            excludedGroupKeys: body.data.excludedGroupKeys,
            recipeMatchMode: savedProfile.recipeMatchMode,
          };
        });

        return c.json(dietProfileResponse(profile));
      } catch (error) {
        if (error instanceof MissingDietReferencesError) {
          return dietUnknownReferencesResponse(c, error.details);
        }
        if (isForeignKeyViolation(error)) {
          return dietUnknownReferencesResponse(c, [
            {
              path: [],
              message: "Diet reference was removed before the profile could be saved",
            },
          ]);
        }
        throw error;
      }
    },
  );
});

registerRoute("get", "/api/profile/recipe-box", async (c) => {
  return withRecipeSession(
    c,
    "query",
    "GET /api/profile/recipe-box query failed",
    async ({ db, session }) => c.json(await recipeBoxResponse(db, session.user.id)),
  );
});

registerRoute("get", "/api/profile/bootstrap", async (c) => {
  return withRecipeSession(
    c,
    "query",
    "GET /api/profile/bootstrap query failed",
    async ({ db, session }) => {
      c.header("Cache-Control", "private, no-store");
      const userId = session.user.id;
      const visibilityFilter = await readableRecipeFilter(db, userId);

      const [
        ownedRecipes,
        readableRecipes,
        box,
        storedDietProfile,
        dietOptions,
        unreadNotificationCount,
      ] = await Promise.all([
        listBootstrapRecipes(db, eq(schema.recipe.userId, userId)),
        listBootstrapRecipes(db, visibilityFilter),
        recipeBoxResponse(db, userId),
        findDietProfile(db, userId),
        listDietOptions(db),
        countUnreadNotifications(db, userId),
      ]);

      const ownedRecipeSlugs = new Set(
        ownedRecipes.map((recipe) => recipe.slug),
      );
      return c.json({
        recipeBox: {
          ownedRecipes,
          readableRecipes: readableRecipes.filter(
            (recipe) => !ownedRecipeSlugs.has(recipe.slug),
          ),
          profile: box,
        },
        diet: {
          profile: dietProfileResponse(
            storedDietProfile ?? defaultDietProfile(userId),
          ),
          options: dietOptions,
        },
        unreadNotificationCount,
      });
    },
  );
});

registerRoute("put", "/api/profile/recipe-box", async (c) => {
  const csrfFailure = validateCsrf(c);
  if (csrfFailure) return csrfFailure;

  return withRecipeSession(
    c,
    "mutation",
    "PUT /api/profile/recipe-box mutation failed",
    async ({ db, session }) => {
      const body = await parseJsonBody(c, recipeBoxBodySchema);
      if (!body.success) return body.response;

      await db.transaction(async (tx) => {
        await tx
          .insert(schema.userRecipeBox)
          .values({ userId: session.user.id, completedAt: new Date() })
          .onConflictDoUpdate({
            target: schema.userRecipeBox.userId,
            set: { updatedAt: new Date() },
          });
        await tx
          .delete(schema.userRecipeBoxItem)
          .where(eq(schema.userRecipeBoxItem.userId, session.user.id));
        if (body.data.recipeSlugs.length > 0) {
          await tx.insert(schema.userRecipeBoxItem).values(
            body.data.recipeSlugs.map((recipeSlug) => ({
              userId: session.user.id,
              recipeSlug,
            })),
          );
        }
      });

      return c.json(await recipeBoxResponse(db, session.user.id));
    },
  );
});

registerRoute("get", "/api/profile/agent-mutations", async (c) => {
  return withRecipeSession(
    c,
    "query",
    "GET /api/profile/agent-mutations query failed",
    async ({ db, session }) =>
      c.json({ items: await listAgentMutationHistory(db, session.user.id) }),
  );
});

registerRoute(
  "get",
  "/api/profile/agent-mutations/:changeSetId/undo-preview",
  async (c) => {
    const changeSetId = uuidParam(c, "changeSetId", "change-set ID");
    if (changeSetId instanceof Response) return changeSetId;
    return withRecipeSession(
      c,
      "query",
      "GET agent mutation undo preview failed",
      async ({ db, session }) => {
        try {
          const preview = await previewAgentMutationUndo(
            db,
            session.user.id,
            changeSetId,
          );
          return preview
            ? c.json(preview)
            : c.json({ error: "Mutation change set not found" }, 404);
        } catch (error) {
          if (error instanceof AgentMutationConflictError) {
            return c.json({ error: error.message }, 409);
          }
          throw error;
        }
      },
    );
  },
);

registerRoute(
  "post",
  "/api/profile/agent-mutations/:changeSetId/undo",
  async (c) => {
    const csrfFailure = validateCsrf(c);
    if (csrfFailure) return csrfFailure;
    const changeSetId = uuidParam(c, "changeSetId", "change-set ID");
    if (changeSetId instanceof Response) return changeSetId;
    const operationId = pantryOperationId(c);
    if (operationId instanceof Response) return operationId;
    const body = await parseJsonBody(c, undoAgentMutationBodySchema);
    if (!body.success) return body.response;
    return withRecipeSession(
      c,
      "mutation",
      "POST agent mutation undo failed",
      async ({ db, session }) => {
        try {
          const result = await undoAgentMutation(db, {
            userId: session.user.id,
            changeSetId,
            idempotencyKey: operationId,
            stableItemIds: body.data.stableItemIds,
          });
          if (!result) return c.json({ error: "Mutation change set not found" }, 404);
          return result.applied
            ? c.json(result)
            : c.json({ error: "Pantry changed after the agent mutation", ...result }, 409);
        } catch (error) {
          if (error instanceof AgentMutationConflictError) {
            return c.json({ error: error.message }, 409);
          }
          throw error;
        }
      },
    );
  },
);

registerRoute("get", "/api/profile/cooking-insights", async (c) => {
  return withRecipeSession(
    c,
    "query",
    "GET /api/profile/cooking-insights query failed",
    async ({ db, session }) =>
      c.json(await cookingInsightsResponse(db, session.user.id)),
  );
});

registerRoute("post", "/api/profile/cooking-sessions", async (c) => {
  const csrfFailure = validateCsrf(c);
  if (csrfFailure) return csrfFailure;

  const body = await parseJsonBody(c, cookingSessionBodySchema);
  if (!body.success) return body.response;

  return withRecipeSession(
    c,
    "mutation",
    "POST /api/profile/cooking-sessions mutation failed",
    async ({ db, session }) => {
      const completedAt =
        body.data.event === "completed" ? new Date() : undefined;
      const [created] = await db
        .insert(schema.cookingSession)
        .values({
          id: body.data.sessionId,
          userId: session.user.id,
          recipeSlug: body.data.recipeSlug,
          recipeTitle: body.data.recipeTitle,
          servings: body.data.servings,
          completedAt,
        })
        .onConflictDoNothing()
        .returning({ id: schema.cookingSession.id });

      if (!created && completedAt) {
        await db
          .update(schema.cookingSession)
          .set({ completedAt })
          .where(
            and(
              eq(schema.cookingSession.id, body.data.sessionId),
              eq(schema.cookingSession.userId, session.user.id),
              isNull(schema.cookingSession.completedAt),
            ),
          );
      }

      const [cookingSession] = await db
        .select({
          id: schema.cookingSession.id,
          recipeSlug: schema.cookingSession.recipeSlug,
          recipeTitle: schema.cookingSession.recipeTitle,
          servings: schema.cookingSession.servings,
          startedAt: schema.cookingSession.startedAt,
          completedAt: schema.cookingSession.completedAt,
        })
        .from(schema.cookingSession)
        .where(
          and(
            eq(schema.cookingSession.id, body.data.sessionId),
            eq(schema.cookingSession.userId, session.user.id),
          ),
        )
        .limit(1);

      if (!cookingSession) {
        return c.json({ error: "Cooking session ID is already in use" }, 409);
      }
      return c.json({ cookingSession }, created ? 201 : 200);
    },
  );
});

registerRoute("get", "/shopping-lists/current", async (c) => {
  return withRecipeSession(
    c,
    "query",
    "GET /shopping-lists/current query failed",
    async ({ db, session }) => {
      c.header("Cache-Control", "private, no-store");
      return c.json(await currentShoppingList(db, session.user.id));
    },
  );
});

registerRoute("put", "/shopping-lists/current", async (c) => {
  const csrfFailure = validateCsrf(c);
  if (csrfFailure) return csrfFailure;

  return withRecipeSession(
    c,
    "mutation",
    "PUT /shopping-lists/current mutation failed",
    async ({ db, session }) => {
      const body = await parseJsonBody(c, updateShoppingListBodySchema);
      if (!body.success) return body.response;

      const response = await db.transaction(async (tx) => {
        const scope = await lockPantryScope(tx, session.user.id);
        const current = await findActiveShoppingList(tx, scope);
        if (
          current?.id !== body.data.listId ||
          current.revision !== BigInt(body.data.revision)
        ) {
          return null;
        }
        const [updated] = await tx
          .update(schema.shoppingList)
          .set({
            snapshot: body.data.snapshot,
            revision: sql`${schema.shoppingList.revision} + 1`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.shoppingList.id, current.id),
              eq(schema.shoppingList.revision, current.revision),
            ),
          )
          .returning();
        if (!updated) throw new Error("Shopping list was not updated");
        return shoppingListResponse(updated, scope);
      });
      if (!response) {
        return c.json(
          { error: "Shopping list changed before this update was saved" },
          409,
        );
      }
      return c.json(response);
    },
  );
});

registerRoute("post", "/shopping-lists", async (c) => {
  const csrfFailure = validateCsrf(c);
  if (csrfFailure) return csrfFailure;

  return withRecipeSession(
    c,
    "mutation",
    "POST /shopping-lists mutation failed",
    async ({ db, session }) => {
      const body = await parseJsonBody(c, createShoppingListBodySchema);
      if (!body.success) return body.response;

      const response = await db.transaction(async (tx) => {
        const scope = await lockPantryScope(tx, session.user.id);
        const current = await findActiveShoppingList(tx, scope);
        if (
          current?.id !== body.data.previousListId ||
          current.revision !== BigInt(body.data.previousRevision)
        ) {
          return null;
        }
        await tx
          .update(schema.shoppingList)
          .set({
            status: "archived",
            snapshot: body.data.snapshot,
            revision: sql`${schema.shoppingList.revision} + 1`,
            closedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(schema.shoppingList.id, current.id));
        const next = await createShoppingList(tx, scope);
        return shoppingListResponse(next, scope);
      });
      if (!response) {
        return c.json(
          { error: "A new shopping list has already been started" },
          409,
        );
      }
      return c.json(response, 201);
    },
  );
});

registerRoute("get", "/pantry", async (c) => {
  return withRecipeSession(
    c,
    "query",
    "GET /pantry query failed",
    async ({ db, session }) => {
      c.header("Cache-Control", "private, no-store");
      const pantry = await withRecipeApiSpan(c, "pantry.read.query", () =>
        readPantry(db, session.user.id),
      );
      return withRecipeApiSpan(c, "http.response.serialize", async () =>
        c.json(pantry),
      );
    },
  );
});

registerRoute("get", "/pantry/realtime", async (c) => {
  if (c.req.header("upgrade")?.toLowerCase() !== "websocket") {
    return c.json({ error: "WebSocket upgrade required" }, 426);
  }
  if (!isValidAuthURL(c.env.BETTER_AUTH_URL)) {
    return c.json({ error: "Auth configuration is invalid" }, 503);
  }
  const requestOrigin = c.req.header("origin");
  const allowedOrigin = new URL(c.env.BETTER_AUTH_URL).origin;
  let parsedRequestOrigin: URL | undefined;
  try {
    parsedRequestOrigin = requestOrigin ? new URL(requestOrigin) : undefined;
  } catch {
    // Invalid Origin headers are rejected below.
  }
  if (
    !parsedRequestOrigin ||
    parsedRequestOrigin.username ||
    parsedRequestOrigin.password ||
    parsedRequestOrigin.pathname !== "/" ||
    parsedRequestOrigin.search ||
    parsedRequestOrigin.hash ||
    parsedRequestOrigin.origin !== allowedOrigin
  ) {
    return c.json({ error: "Realtime origin is not allowed" }, 403);
  }
  const realtimeRooms = c.env.HOUSEHOLD_REALTIME;
  if (!realtimeRooms) {
    return c.json({ error: "Realtime service is not configured" }, 503);
  }

  return withRecipeSession(
    c,
    "lookup",
    "GET /pantry/realtime lookup failed",
    async ({ db, session }) => {
      const scope = await resolvePantryScope(db, session.user.id);
      if (scope.type !== "household") {
        return c.json(
          { error: "Realtime pantry updates require a household" },
          409,
        );
      }

      const now = Date.now();
      const authorizationExpiresAt = Math.min(
        session.session.expiresAt.getTime(),
        now + REALTIME_AUTHORIZATION_LIFETIME_MS,
      );
      if (authorizationExpiresAt <= now) {
        return authorizationResponse(c, unauthenticated());
      }
      const room = realtimeRooms.get(
        realtimeRooms.idFromName(scope.householdId),
      );
      return room.fetch(
        new Request("https://household-realtime/connect", {
          headers: realtimeRoomRequestHeaders({
            userId: session.user.id,
            sessionId: session.session.id,
            resourceId: scope.householdId,
            authorizationExpiresAt,
          }),
        }),
      );
    },
  );
});

registerRoute("put", "/pantry", async (c) => {
  const csrfFailure = validateCsrf(c);
  if (csrfFailure) return csrfFailure;
  const operationId = pantryOperationId(c);
  if (operationId instanceof Response) return operationId;

  return withRecipeSession(
    c,
    "mutation",
    "PUT /pantry mutation failed",
    async ({ db, session }) => {
      const body = await parseJsonBody(c, pantryStockBodySchema);
      if (!body.success) return body.response;

      const stockEntries = Object.entries(body.data.stock);
      const ingredientSlugs = stockEntries.map(
        ([ingredientSlug]) => ingredientSlug,
      );

      const pantry = await executeCollaborativePantryOperation(
        c,
        db,
        session.user.id,
        operationId,
        pantryStockFingerprint("replace", body.data.stock),
        "pantry.replaced",
        async (tx, scope) => {
          const unknownSlug = await findUnknownPantryIngredient(
            tx,
            ingredientSlugs,
          );
          if (unknownSlug) throw new UnknownPantryIngredientError(unknownSlug);
          const scopeFilter = pantryScopeFilter(scope);
          await tx
            .delete(schema.pantryItem)
            .where(
              ingredientSlugs.length > 0
                ? and(
                    scopeFilter,
                    notInArray(
                      schema.pantryItem.ingredientSlug,
                      ingredientSlugs,
                    ),
                  )
                : scopeFilter,
            );
          if (ingredientSlugs.length > 0) {
            await tx
              .insert(schema.pantryItem)
              .values(
                stockEntries.map(([ingredientSlug, location]) => ({
                  userId: scope.type === "personal" ? scope.userId : null,
                  organizationId:
                    scope.type === "household" ? scope.householdId : null,
                  ingredientSlug,
                  location,
                })),
              )
              .onConflictDoUpdate({
                target:
                  scope.type === "household"
                    ? [
                        schema.pantryItem.organizationId,
                        schema.pantryItem.ingredientSlug,
                      ]
                    : [
                        schema.pantryItem.userId,
                        schema.pantryItem.ingredientSlug,
                      ],
                set: {
                  location: sql`excluded.location`,
                  version: sql`${schema.pantryItem.version} + 1`,
                  updatedAt: new Date(),
                },
              });
          }
        },
      );

      return c.json(pantry);
    },
    { onError: (error) => pantryMutationErrorResponse(c, error) },
  );
});

registerRoute("patch", "/pantry", async (c) => {
  const csrfFailure = validateCsrf(c);
  if (csrfFailure) return csrfFailure;
  const operationId = pantryOperationId(c);
  if (operationId instanceof Response) return operationId;

  return withRecipeSession(
    c,
    "mutation",
    "PATCH /pantry mutation failed",
    async ({ db, session }) => {
      const body = await parseJsonBody(c, pantryStockBodySchema);
      if (!body.success) return body.response;

      const stockEntries = Object.entries(body.data.stock);
      const ingredientSlugs = stockEntries.map(
        ([ingredientSlug]) => ingredientSlug,
      );

      const pantry = await executeCollaborativePantryOperation(
        c,
        db,
        session.user.id,
        operationId,
        pantryStockFingerprint("restore", body.data.stock),
        "pantry.restored",
        async (tx, scope) => {
          const unknownSlug = await findUnknownPantryIngredient(
            tx,
            ingredientSlugs,
          );
          if (unknownSlug) throw new UnknownPantryIngredientError(unknownSlug);
          if (stockEntries.length > 0) {
            await tx
              .insert(schema.pantryItem)
              .values(
                stockEntries.map(([ingredientSlug, location]) => ({
                  userId: scope.type === "personal" ? scope.userId : null,
                  organizationId:
                    scope.type === "household" ? scope.householdId : null,
                  ingredientSlug,
                  location,
                })),
              )
              .onConflictDoNothing();
          }
        },
      );

      return c.json(pantry);
    },
    { onError: (error) => pantryMutationErrorResponse(c, error) },
  );
});

registerRoute("put", "/pantry/items/:ingredientSlug", async (c) => {
  const csrfFailure = validateCsrf(c);
  if (csrfFailure) return csrfFailure;
  const operationId = pantryOperationId(c);
  if (operationId instanceof Response) return operationId;

  return withRecipeSession(
    c,
    "mutation",
    "PUT /pantry/items/:ingredientSlug mutation failed",
    async ({ db, session }) => {
      const ingredientSlugResult = pantryIngredientSlugSchema.safeParse(
        c.req.param("ingredientSlug"),
      );
      if (!ingredientSlugResult.success) {
        return c.json({ error: "Invalid ingredient slug" }, 400);
      }
      const body = await parseJsonBody(c, pantryItemBodySchema);
      if (!body.success) return body.response;

      const ingredientSlug = ingredientSlugResult.data;
      const pantry = await executeCollaborativePantryOperation(
        c,
        db,
        session.user.id,
        operationId,
        `set:${ingredientSlug}:${body.data.location}`,
        "pantry.item-set",
        async (tx, scope) => {
          const unknownSlug = await findUnknownPantryIngredient(tx, [
            ingredientSlug,
          ]);
          if (unknownSlug) throw new UnknownPantryIngredientError(unknownSlug);
          await tx
            .insert(schema.pantryItem)
            .values({
              userId: scope.type === "personal" ? scope.userId : null,
              organizationId:
                scope.type === "household" ? scope.householdId : null,
              ingredientSlug,
              location: body.data.location,
            })
            .onConflictDoUpdate({
              target:
                scope.type === "household"
                  ? [
                      schema.pantryItem.organizationId,
                      schema.pantryItem.ingredientSlug,
                    ]
                  : [
                      schema.pantryItem.userId,
                      schema.pantryItem.ingredientSlug,
                    ],
              set: {
                location: body.data.location,
                version: sql`${schema.pantryItem.version} + 1`,
                updatedAt: new Date(),
              },
            });
        },
      );

      return c.json(pantry);
    },
    { onError: (error) => pantryMutationErrorResponse(c, error) },
  );
});

registerRoute("delete", "/pantry/items/:ingredientSlug", async (c) => {
  const csrfFailure = validateCsrf(c);
  if (csrfFailure) return csrfFailure;
  const operationId = pantryOperationId(c);
  if (operationId instanceof Response) return operationId;

  return withRecipeSession(
    c,
    "mutation",
    "DELETE /pantry/items/:ingredientSlug mutation failed",
    async ({ db, session }) => {
      const ingredientSlugResult = pantryIngredientSlugSchema.safeParse(
        c.req.param("ingredientSlug"),
      );
      if (!ingredientSlugResult.success) {
        return c.json({ error: "Invalid ingredient slug" }, 400);
      }

      const pantry = await executeCollaborativePantryOperation(
        c,
        db,
        session.user.id,
        operationId,
        `remove:${ingredientSlugResult.data}`,
        "pantry.item-removed",
        async (tx, scope) => {
          await tx
            .delete(schema.pantryItem)
            .where(
              and(
                pantryScopeFilter(scope),
                eq(
                  schema.pantryItem.ingredientSlug,
                  ingredientSlugResult.data,
                ),
              ),
            );
        },
      );

      return c.json(pantry);
    },
    { onError: (error) => pantryMutationErrorResponse(c, error) },
  );
});

registerRoute("get", "/households", async (c) => {
  return withRecipeSession(
    c,
    "query",
    "GET /households query failed",
    async ({ db, session }) => {
      const households = await db
        .select({
          id: schema.organization.id,
          name: schema.organization.name,
          slug: schema.organization.slug,
          logo: schema.organization.logo,
          createdAt: schema.organization.createdAt,
          updatedAt: schema.organization.updatedAt,
          memberId: schema.member.id,
          role: schema.member.role,
        })
        .from(schema.member)
        .innerJoin(
          schema.organization,
          eq(schema.member.organizationId, schema.organization.id),
        )
        .where(eq(schema.member.userId, session.user.id));

      return c.json(
        households.map(({ memberId, role, ...household }) => ({
          ...household,
          membership: { id: memberId, role },
        })),
      );
    },
  );
});

registerRoute("get", "/households/invitations", async (c) => {
  return withRecipeSession(
    c,
    "query",
    "GET /households/invitations failed",
    async ({ db, session }) => {
      const verifiedEmails = await verifiedEmailsForUser(db, session.user);
      if (verifiedEmails.length === 0) return c.json([]);

      const invitations = await db
        .select({
          invitation: schema.invitation,
          household: {
            id: schema.organization.id,
            name: schema.organization.name,
          },
        })
        .from(schema.invitation)
        .innerJoin(
          schema.organization,
          eq(schema.invitation.organizationId, schema.organization.id),
        )
        .where(
          and(
            inArray(schema.invitation.email, verifiedEmails),
            eq(schema.invitation.status, "pending"),
            gt(schema.invitation.expiresAt, new Date()),
          ),
        );

      return c.json(
        invitations.map(({ invitation, household }) => ({
          ...invitationResponse(invitation),
          household,
        })),
      );
    },
  );
});

registerRoute("post", "/households", async (c) => {
  const csrfFailure = validateCsrf(c);
  if (csrfFailure) return csrfFailure;

  return withRecipeSession(
    c,
    "mutation",
    "POST /households mutation failed",
    async ({ db, session }) => {
      const existingMembership = await findUserHouseholdMembership(
        db,
        session.user.id,
      );
      if (existingMembership) {
        return c.json({ error: "User already belongs to a household" }, 409);
      }

      const body = await parseJsonBody(c, createHouseholdBodySchema);
      if (!body.success) return body.response;

      const householdId = createId();
      const household = await db.transaction(async (tx) => {
        await lockUser(tx, session.user.id);
        if (await findUserHouseholdMembership(tx, session.user.id)) {
          throw new Error("User already belongs to a household");
        }

        const [createdHousehold] = await tx
          .insert(schema.organization)
          .values({
            id: householdId,
            name: body.data.name ?? `${session.user.name}'s household`,
            slug: householdSlug(),
          })
          .returning();
        if (!createdHousehold) throw new Error("Household insert failed");

        await tx.insert(schema.member).values({
          id: createId(),
          organizationId: householdId,
          userId: session.user.id,
          role: "owner",
        });

        await tx
          .update(schema.pantryItem)
          .set({
            userId: null,
            organizationId: householdId,
          })
          .where(eq(schema.pantryItem.userId, session.user.id));
        await clearPantryOperationsForScope(tx, {
          type: "personal",
          userId: session.user.id,
        });
        await tx
          .update(schema.pantryAggregate)
          .set({ userId: null, organizationId: householdId })
          .where(eq(schema.pantryAggregate.userId, session.user.id));

        return createdHousehold;
      });

      return c.json(householdResponse(household), 201);
    },
    {
      onError: (error) =>
        isUniqueViolation(error) ||
        (error instanceof Error &&
          error.message === "User already belongs to a household")
          ? c.json({ error: "User already belongs to a household" }, 409)
          : undefined,
    },
  );
});

registerRoute("patch", "/households/:householdId", async (c) => {
  const householdId = uuidParam(c, "householdId", "household ID");
  if (householdId instanceof Response) return householdId;
  const csrfFailure = validateCsrf(c);
  if (csrfFailure) return csrfFailure;

  return withRecipeSession(
    c,
    "mutation",
    "PATCH /households/:householdId failed",
    async ({ db, session }) => {
      const ownerFailure = await authorizeHouseholdOwnerResponse(
        c,
        db,
        householdId,
        session,
      );
      if (ownerFailure) return ownerFailure;

      const body = await parseJsonBody(c, updateHouseholdBodySchema);
      if (!body.success) return body.response;

      const [household] = await db
        .update(schema.organization)
        .set({ name: body.data.name })
        .where(eq(schema.organization.id, householdId))
        .returning();
      if (!household) return c.notFound();

      return c.json(householdResponse(household));
    },
  );
});

registerRoute("get", "/households/:householdId/members", async (c) => {
  const householdId = uuidParam(c, "householdId", "household ID");
  if (householdId instanceof Response) return householdId;
  return withRecipeSession(
    c,
    "query",
    "GET /households/:householdId/members query failed",
    async ({ db, session }) => {
      const memberFailure = await requireHouseholdMemberResponse(
        c,
        db,
        householdId,
        session,
      );
      if (memberFailure) return memberFailure;

      const members = await db
        .select({
          id: schema.member.id,
          organizationId: schema.member.organizationId,
          userId: schema.member.userId,
          role: schema.member.role,
          createdAt: schema.member.createdAt,
          user: {
            id: schema.user.id,
            email: schema.user.email,
            name: schema.user.name,
            image: schema.user.image,
          },
        })
        .from(schema.member)
        .innerJoin(schema.user, eq(schema.member.userId, schema.user.id))
        .where(eq(schema.member.organizationId, householdId));

      return c.json(members.map(memberResponse));
    },
  );
});

registerRoute("get", "/households/:householdId/invitations", async (c) => {
  const householdId = uuidParam(c, "householdId", "household ID");
  if (householdId instanceof Response) return householdId;
  return withRecipeSession(
    c,
    "query",
    "GET /households/:householdId/invitations failed",
    async ({ db, session }) => {
      const ownerFailure = await authorizeHouseholdOwnerResponse(
        c,
        db,
        householdId,
        session,
      );
      if (ownerFailure) return ownerFailure;

      const invitations = await db
        .select()
        .from(schema.invitation)
        .where(
          and(
            eq(schema.invitation.organizationId, householdId),
            eq(schema.invitation.status, "pending"),
            gt(schema.invitation.expiresAt, new Date()),
          ),
        );

      return c.json(invitations.map(invitationResponse));
    },
  );
});

registerRoute("post", "/households/:householdId/invitations", async (c) => {
  const householdId = uuidParam(c, "householdId", "household ID");
  if (householdId instanceof Response) return householdId;
  const csrfFailure = validateCsrf(c);
  if (csrfFailure) return csrfFailure;

  return withRecipeSession(
    c,
    "mutation",
    "POST /households/:householdId/invitations failed",
    async ({ db, session }) => {
      const ownerFailure = await authorizeHouseholdOwnerResponse(
        c,
        db,
        householdId,
        session,
      );
      if (ownerFailure) return ownerFailure;

      const inviteLimit = await enforceRateLimit(
        db,
        `household-invite:${session.user.id}`,
        HOUSEHOLD_INVITE_RATE_LIMIT,
      );
      if (!inviteLimit.allowed) {
        return rateLimitedResponse(c, inviteLimit.retryAfter);
      }

      const body = await parseJsonBody(c, inviteHouseholdMemberBodySchema);
      if (!body.success) return body.response;

      const email = normalizeEmail(body.data.email);

      const [existingInvitation] = await db
        .select()
        .from(schema.invitation)
        .where(
          and(
            eq(schema.invitation.organizationId, householdId),
            eq(schema.invitation.email, email),
            eq(schema.invitation.status, "pending"),
            gt(schema.invitation.expiresAt, new Date()),
          ),
        )
        .limit(1);
      if (existingInvitation) {
        return c.json(
          { error: "A pending invitation already exists for this email" },
          409,
        );
      }

      const [inviteeUserId, household] = await Promise.all([
        verifiedEmailOwnerId(db, email),
        findHouseholdById(db, householdId),
      ]);
      const invitation = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(schema.invitation)
          .values({
            id: createId(),
            organizationId: householdId,
            email,
            role: "member",
            status: "pending",
            expiresAt: new Date(Date.now() + INVITATION_EXPIRY_MS),
            inviterId: session.user.id,
          })
          .returning();
        if (!created) throw new Error("Invitation insert failed");
        if (inviteeUserId && household) {
          await createHouseholdNotification(tx, {
            recipientUserIds: [inviteeUserId],
            kind: "household_invited",
            household,
            actor: {
              id: session.user.id,
              name: session.user.name,
            },
            invitationId: created.id,
          });
        }
        return created;
      });
      return c.json(invitationResponse(invitation), 201);
    },
  );
});

registerRoute("post", "/households/invitations/:invitationId/accept", async (c) => {
  const invitationId = uuidParam(c, "invitationId", "invitation ID");
  if (invitationId instanceof Response) return invitationId;
  const csrfFailure = validateCsrf(c);
  if (csrfFailure) return csrfFailure;

  return withRecipeSession(
    c,
    "mutation",
    "POST /households/invitations/:invitationId/accept failed",
    async ({ db, session }) => {
      const result = await performInvitationAction(
        db,
        session.user,
        invitationId,
        "accept",
      );
      return c.json({
        invitation: invitationResponse(result.invitation),
        membershipCreated: result.membershipCreated,
      });
    },
    { onError: (error) => invitationActionFailure(c, error) },
  );
});

registerRoute("post", "/households/invitations/:invitationId/decline", async (c) => {
  const invitationId = uuidParam(c, "invitationId", "invitation ID");
  if (invitationId instanceof Response) return invitationId;
  const csrfFailure = validateCsrf(c);
  if (csrfFailure) return csrfFailure;

  return withRecipeSession(
    c,
    "mutation",
    "POST /households/invitations/:invitationId/decline failed",
    async ({ db, session }) => {
      const result = await performInvitationAction(
        db,
        session.user,
        invitationId,
        "decline",
      );
      return c.json(invitationResponse(result.invitation));
    },
    { onError: (error) => invitationActionFailure(c, error) },
  );
});

registerRoute(
  "delete",
  "/households/:householdId/invitations/:invitationId",
  async (c) => {
    const householdId = uuidParam(c, "householdId", "household ID");
    if (householdId instanceof Response) return householdId;
    const invitationId = uuidParam(c, "invitationId", "invitation ID");
    if (invitationId instanceof Response) return invitationId;
    const csrfFailure = validateCsrf(c);
    if (csrfFailure) return csrfFailure;

    return withRecipeSession(
      c,
      "mutation",
      "DELETE /households/:householdId/invitations/:invitationId failed",
      async ({ db, session }) => {
        const ownerFailure = await authorizeHouseholdOwnerResponse(
          c,
          db,
          householdId,
          session,
        );
        if (ownerFailure) return ownerFailure;

        const [invitation] = await db
          .select()
          .from(schema.invitation)
          .where(
            and(
              eq(schema.invitation.id, invitationId),
              eq(schema.invitation.organizationId, householdId),
            ),
          )
          .limit(1);
        if (!invitation) return c.notFound();
        if (invitation.status !== "pending") {
          return c.json({ error: "Invitation is not pending" }, 409);
        }

        const [revoked] = await db
          .update(schema.invitation)
          .set({ status: "canceled" })
          .where(
            and(
              eq(schema.invitation.id, invitationId),
              eq(schema.invitation.organizationId, householdId),
              eq(schema.invitation.status, "pending"),
            ),
          )
          .returning();
        if (!revoked) {
          return c.json({ error: "Invitation is not pending" }, 409);
        }
        return c.json(invitationResponse(revoked));
      },
    );
  },
);

registerRoute("delete", "/households/:householdId/members/:memberId", async (c) => {
  const householdId = uuidParam(c, "householdId", "household ID");
  if (householdId instanceof Response) return householdId;
  const memberId = uuidParam(c, "memberId", "member ID");
  if (memberId instanceof Response) return memberId;
  const csrfFailure = validateCsrf(c);
  if (csrfFailure) return csrfFailure;

  return withRecipeSession(
    c,
    "mutation",
    "DELETE /households/:householdId/members/:memberId failed",
    async ({ db, session }) => {
      const ownerFailure = await authorizeHouseholdOwnerResponse(
        c,
        db,
        householdId,
        session,
      );
      if (ownerFailure) return ownerFailure;

      const [member] = await db
        .select()
        .from(schema.member)
        .where(
          and(
            eq(schema.member.id, memberId),
            eq(schema.member.organizationId, householdId),
          ),
        )
        .limit(1);
      if (!member) return c.notFound();
      if (member.role === "owner") {
        return c.json({ error: "Household owner cannot be revoked" }, 400);
      }

      const household = await findHouseholdById(db, householdId);
      if (!household) return c.notFound();

      await db.transaction(async (tx) => {
        await lockUser(tx, member.userId);
        if (!(await lockHousehold(tx, householdId))) return;
        const currentMember = await findHouseholdMembership(
          tx,
          householdId,
          member.userId,
        );
        if (!currentMember || currentMember.role === "owner") return;

        await tx
          .update(schema.recipe)
          .set({ visibility: "private" })
          .where(
            and(
              eq(schema.recipe.visibility, "household"),
              eq(schema.recipe.userId, member.userId),
            ),
          );
        await createHouseholdNotification(tx, {
          recipientUserIds: [member.userId],
          kind: "household_removed",
          household,
          actor: {
            id: session.user.id,
            name: session.user.name,
          },
        });
        await tx
          .delete(schema.member)
          .where(eq(schema.member.id, currentMember.id));
      });
      return c.body(null, 204);
    },
  );
});

registerRoute("post", "/households/:householdId/leave", async (c) => {
  const householdId = uuidParam(c, "householdId", "household ID");
  if (householdId instanceof Response) return householdId;
  const csrfFailure = validateCsrf(c);
  if (csrfFailure) return csrfFailure;

  return withRecipeSession(
    c,
    "mutation",
    "POST /households/:householdId/leave failed",
    async ({ db, session }) => {
      const household = await findHouseholdById(db, householdId);
      if (!household) return c.notFound();

      const member = await findHouseholdMembership(
        db,
        householdId,
        session.user.id,
      );
      if (!member) return authorizationResponse(c, forbidden());
      if (member.role === "owner") {
        return c.json({ error: "Household owner cannot leave" }, 400);
      }

      const owner = await findHouseholdOwner(db, householdId);

      await db.transaction(async (tx) => {
        await lockUser(tx, session.user.id);
        if (!(await lockHousehold(tx, householdId))) return;
        const currentMember = await findHouseholdMembership(
          tx,
          householdId,
          session.user.id,
        );
        if (!currentMember || currentMember.role === "owner") return;

        await tx
          .update(schema.recipe)
          .set({ visibility: "private" })
          .where(
            and(
              eq(schema.recipe.visibility, "household"),
              eq(schema.recipe.userId, session.user.id),
            ),
          );
        if (owner) {
          await createHouseholdNotification(tx, {
            recipientUserIds: [owner.userId],
            kind: "household_member_left",
            household,
            actor: {
              id: session.user.id,
              name: session.user.name,
            },
          });
        }
        await tx
          .delete(schema.member)
          .where(eq(schema.member.id, currentMember.id));
      });
      return c.body(null, 204);
    },
  );
});

registerRoute("delete", "/households/:householdId", async (c) => {
  const householdId = uuidParam(c, "householdId", "household ID");
  if (householdId instanceof Response) return householdId;
  const csrfFailure = validateCsrf(c);
  if (csrfFailure) return csrfFailure;
  return withRecipeSession(
    c,
    "mutation",
    "DELETE /households/:householdId failed",
    async ({ db, session }) => {
      const ownerFailure = await authorizeHouseholdOwnerResponse(
        c,
        db,
        householdId,
        session,
      );
      if (ownerFailure) return ownerFailure;
      const household = await findHouseholdById(db, householdId);
      if (!household) return c.notFound();

      await db.transaction(async (tx) => {
        // Match pantry mutation lock ordering so deleting a household cannot
        // race an owner pantry write while its stock changes ownership.
        await lockUser(tx, session.user.id);
        const [lockedHousehold] = await tx
          .select({ id: schema.organization.id })
          .from(schema.organization)
          .where(eq(schema.organization.id, householdId))
          .for("update")
          .limit(1);
        if (!lockedHousehold) throw new Error("Household no longer exists");
        const memberIds = await findHouseholdMemberUserIds(tx, householdId);

        await createHouseholdNotification(tx, {
          recipientUserIds: memberIds.filter(
            (userId) => userId !== session.user.id,
          ),
          kind: "household_deleted",
          household,
          actor: {
            id: session.user.id,
            name: session.user.name,
          },
        });
        await tx
          .update(schema.recipe)
          .set({ visibility: "private" })
          .where(
            and(
              eq(schema.recipe.visibility, "household"),
              inArray(schema.recipe.userId, memberIds),
            ),
          );
        const householdPantryItems = await tx
          .select({ ingredientSlug: schema.pantryItem.ingredientSlug })
          .from(schema.pantryItem)
          .where(eq(schema.pantryItem.organizationId, householdId));
        const householdIngredientSlugs = householdPantryItems.map(
          ({ ingredientSlug }) => ingredientSlug,
        );
        if (householdIngredientSlugs.length > 0) {
          // Household stock is authoritative. Remove any defensive/stale
          // personal duplicates before carrying the household pantry forward.
          await tx
            .delete(schema.pantryItem)
            .where(
              and(
                eq(schema.pantryItem.userId, session.user.id),
                inArray(
                  schema.pantryItem.ingredientSlug,
                  householdIngredientSlugs,
                ),
              ),
            );
        }
        await tx
          .update(schema.pantryItem)
          .set({
            userId: session.user.id,
            organizationId: null,
          })
          .where(eq(schema.pantryItem.organizationId, householdId));
        await clearPantryOperationsForScope(tx, {
          type: "household",
          householdId,
          householdName: household.name,
        });
        await tx
          .delete(schema.pantryAggregate)
          .where(eq(schema.pantryAggregate.userId, session.user.id));
        await tx
          .update(schema.pantryAggregate)
          .set({ userId: session.user.id, organizationId: null })
          .where(eq(schema.pantryAggregate.organizationId, householdId));
        await tx
          .update(schema.shoppingList)
          .set({
            status: "archived",
            closedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.shoppingList.userId, session.user.id),
              eq(schema.shoppingList.status, "active"),
            ),
          );
        await tx
          .update(schema.shoppingList)
          .set({ userId: session.user.id, organizationId: null })
          .where(eq(schema.shoppingList.organizationId, householdId));
        await tx
          .delete(schema.organization)
          .where(eq(schema.organization.id, householdId));
      });
      return c.body(null, 204);
    },
  );
});

async function countUnreadNotifications(db: Db, userId: string) {
  const [unread] = await db
    .select({ value: count() })
    .from(schema.notificationDelivery)
    .where(
      and(
        eq(schema.notificationDelivery.recipientUserId, userId),
        isNull(schema.notificationDelivery.readAt),
        isNull(schema.notificationDelivery.dismissedAt),
      ),
    );
  return unread?.value ?? 0;
}

registerRoute("get", "/notifications/unread-count", async (c) => {
  return withRecipeSession(
    c,
    "query",
    "GET /notifications/unread-count failed",
    async ({ db, session }) => {
      c.header("Cache-Control", "private, no-store");
      return c.json({
        unreadCount: await countUnreadNotifications(db, session.user.id),
      });
    },
  );
});

registerRoute("get", "/notifications", async (c) => {
  const offset = Number(c.req.query("offset") ?? "0");
  if (!Number.isSafeInteger(offset) || offset < 0) {
    return c.json({ error: "Invalid notification offset" }, 400);
  }
  return withRecipeSession(
    c,
    "query",
    "GET /notifications failed",
    async ({ db, session }) => {
      const [deliveries, unreadCount] = await Promise.all([
        db
          .select(notificationBaseSelection)
          .from(schema.notificationDelivery)
          .innerJoin(
            schema.notificationEvent,
            eq(schema.notificationDelivery.eventId, schema.notificationEvent.id),
          )
          .where(
            and(
              eq(
                schema.notificationDelivery.recipientUserId,
                session.user.id,
              ),
              isNull(schema.notificationDelivery.dismissedAt),
            ),
          )
          .orderBy(
            desc(schema.notificationEvent.occurredAt),
            desc(schema.notificationDelivery.id),
          )
          .limit(NOTIFICATION_PAGE_SIZE + 1)
          .offset(offset),
        countUnreadNotifications(db, session.user.id),
      ]);
      const hasMore = deliveries.length > NOTIFICATION_PAGE_SIZE;
      const items = await hydrateNotifications(
        db,
        session.user.id,
        deliveries.slice(0, NOTIFICATION_PAGE_SIZE),
        c.env.BETTER_AUTH_SECRET,
      );
      return c.json(
        {
          items,
          nextOffset: hasMore ? offset + NOTIFICATION_PAGE_SIZE : null,
          unreadCount,
        },
      );
    },
  );
});

async function mutateAllNotifications(
  c: Context<AppEnv>,
  action: "read" | "clear",
): Promise<Response> {
  const csrfFailure = validateCsrf(c);
  if (csrfFailure) return csrfFailure;
  return withRecipeSession(
    c,
    "mutation",
    `POST /notifications/${action}-all failed`,
    async ({ db, session }) => {
      const mutationTime = new Date();
      await db
        .update(schema.notificationDelivery)
        .set(
          action === "clear"
            ? { readAt: mutationTime, dismissedAt: mutationTime }
            : { readAt: mutationTime },
        )
        .where(
          and(
            eq(
              schema.notificationDelivery.recipientUserId,
              session.user.id,
            ),
            isNull(
              action === "clear"
                ? schema.notificationDelivery.dismissedAt
                : schema.notificationDelivery.readAt,
            ),
          ),
        );
      return c.body(null, 204);
    },
  );
}

registerRoute("post", "/notifications/read-all", (c) => mutateAllNotifications(c, "read"));
registerRoute("post", "/notifications/clear-all", (c) => mutateAllNotifications(c, "clear"));

registerRoute("post", "/notifications/:notificationId/actions/:actionKey", async (c) => {
  const csrfFailure = validateCsrf(c);
  if (csrfFailure) return csrfFailure;
  const action = c.req.param("actionKey");
  if (!action) return c.json({ error: "Unknown notification action" }, 400);
  const notificationId = uuidParam(c, "notificationId", "notification ID");
  if (notificationId instanceof Response) return notificationId;
  return withRecipeSession(
    c,
    "mutation",
    "POST /notifications/:notificationId/actions/:actionKey failed",
    async ({ db, session }) => {
      const [target] = await db
        .select({
          eventId: schema.notificationEvent.id,
          kind: schema.notificationEvent.kind,
        })
        .from(schema.notificationDelivery)
        .innerJoin(
          schema.notificationEvent,
          eq(schema.notificationDelivery.eventId, schema.notificationEvent.id),
        )
        .where(
          and(
            eq(schema.notificationDelivery.id, notificationId),
            eq(
              schema.notificationDelivery.recipientUserId,
              session.user.id,
            ),
            isNull(schema.notificationDelivery.dismissedAt),
          ),
        )
        .limit(1);
      if (!target) return c.notFound();
      await dispatchNotificationAction(
        db,
        session.user,
        { id: target.eventId, kind: target.kind },
        action,
      );
      const [updated] = await db
        .select(notificationBaseSelection)
        .from(schema.notificationDelivery)
        .innerJoin(
          schema.notificationEvent,
          eq(schema.notificationDelivery.eventId, schema.notificationEvent.id),
        )
        .where(
          and(
            eq(schema.notificationDelivery.id, notificationId),
            eq(
              schema.notificationDelivery.recipientUserId,
              session.user.id,
            ),
          ),
        )
        .limit(1);
      if (!updated) return c.notFound();
      const [item] = await hydrateNotifications(
        db,
        session.user.id,
        [updated],
        c.env.BETTER_AUTH_SECRET,
      );
      return c.json({ item });
    },
    { onError: (error) => invitationActionFailure(c, error) },
  );
});

registerRoute("patch", "/notifications/:notificationId", async (c) => {
  const csrfFailure = validateCsrf(c);
  if (csrfFailure) return csrfFailure;
  const notificationId = uuidParam(c, "notificationId", "notification ID");
  if (notificationId instanceof Response) return notificationId;
  return withRecipeSession(
    c,
    "mutation",
    "PATCH /notifications/:notificationId failed",
    async ({ db, session }) => {
      const body = await parseJsonBody(
        c,
        z.object({ read: z.boolean().optional(), dismissed: z.boolean().optional() }).strict(),
      );
      if (!body.success) return body.response;
      const mutationTime = new Date();
      await db
        .update(schema.notificationDelivery)
        .set({
          ...(body.data.read !== undefined
            ? { readAt: body.data.read ? mutationTime : null }
            : {}),
          ...(body.data.dismissed ? { readAt: mutationTime } : {}),
          ...(body.data.dismissed !== undefined
            ? { dismissedAt: body.data.dismissed ? mutationTime : null }
            : {}),
        })
        .where(
          and(
            eq(schema.notificationDelivery.id, notificationId),
            eq(
              schema.notificationDelivery.recipientUserId,
              session.user.id,
            ),
          ),
        );
      return c.body(null, 204);
    },
  );
});

registerRoute("get", "/recipes", async (c) => {
  const scope = c.req.query("scope");
  if (scope && scope !== "owned") {
    return c.json({ error: "Invalid recipe scope" }, 400);
  }
  const limitValue = c.req.query("limit");
  const cursorValue = c.req.query("cursor");
  const limit = recipeListLimitSchema.safeParse(limitValue);
  const cursor = decodeFeedCursor(cursorValue);
  if (!limit.success || (cursorValue && !cursor)) {
    return c.json({ error: "Invalid recipe query" }, 400);
  }
  // Requests that opt into pagination get an { items, nextCursor } envelope;
  // bare requests keep the legacy array shape, bounded to the default limit.
  const paginated = limitValue !== undefined || cursorValue !== undefined;

  return withDatabase(
    c,
    "query",
    "GET /recipes query failed",
    async (db) => {
      const queryResult = await withRecipeApiSpan(
        c,
        "recipes.list.query",
        async () => {
          let visibilityFilter: SQL | undefined;
          let authenticated = false;
          if (scope === "owned") {
            const session = await requireRecipeSession(c, db);
            if (!session.success) return session.response;
            authenticated = true;
            visibilityFilter = eq(
              schema.recipe.userId,
              session.session.user.id,
            );
          } else {
            const session = await loadOptionalRecipeSession(c, db);
            authenticated = Boolean(session);
            visibilityFilter = await readableRecipeFilter(db, session?.user.id);
          }
          const page = await listRecipesPage(
            db,
            visibilityFilter,
            cursor,
            limit.data,
          );
          return { page, authenticated };
        },
        { "app.recipe.scope": scope ?? "readable" },
      );
      if (queryResult instanceof Response) return queryResult;
      const { page } = queryResult;
      const items = page.recipes.map(recipeResponse);
      setRecipeReadCacheHeaders(
        c,
        !queryResult.authenticated && !hasSessionSignal(c),
      );
      return withRecipeApiSpan(c, "http.response.serialize", async () =>
        c.json(paginated ? { items, nextCursor: page.nextCursor } : items),
      );
    },
  );
});

registerRoute("get", "/recipes/discover/feed", async (c) => {
  const scope = feedScopeSchema.safeParse(c.req.query("scope") ?? "public");
  const limit = feedLimitSchema.safeParse(c.req.query("limit"));
  const cursorValue = c.req.query("cursor");
  const cursor = decodeFeedCursor(cursorValue);
  if (!scope.success || !limit.success || (cursorValue && !cursor)) {
    return c.json({ error: "Invalid feed query" }, 400);
  }

  return withDatabase(
    c,
    "query",
    "GET /recipes/discover/feed query failed",
    async (db) => {
      let visibilityFilter: SQL = eq(schema.recipe.visibility, "public");
      if (scope.data !== "public") {
        const session = await requireRecipeSession(c, db);
        if (!session.success) return session.response;
        const followingFilters: SQL[] = [
          and(
            inArray(schema.recipe.visibility, ["public", "household"]),
            exists(
              db
                .select({ id: feedRecipeOwnerMembership.id })
                .from(feedRecipeOwnerMembership)
                .innerJoin(
                  feedViewerMembership,
                  eq(
                    feedRecipeOwnerMembership.organizationId,
                    feedViewerMembership.organizationId,
                  ),
                )
                .where(
                  and(
                    eq(
                      feedRecipeOwnerMembership.userId,
                      schema.recipe.userId,
                    ),
                    eq(
                      feedViewerMembership.userId,
                      session.session.user.id,
                    ),
                  ),
                ),
            ),
          )!,
          and(
            eq(schema.recipe.visibility, "public"),
            exists(
              db
                .select({ id: schema.userFollow.followedUserId })
                .from(schema.userFollow)
                .where(
                  and(
                    eq(
                      schema.userFollow.followerUserId,
                      session.session.user.id,
                    ),
                    eq(
                      schema.userFollow.followedUserId,
                      schema.recipe.userId,
                    ),
                  ),
                ),
            ),
          )!,
        ];
        visibilityFilter = or(...followingFilters)!;
      }

      const cursorFilter = recipeFeedCursorFilter(cursor);
      const rows = await db
        .select({
          recipe: schema.recipe,
          cursorCreatedAt: recipeFeedCursorTimestamp(),
          author: {
            id: schema.user.id,
            name: schema.user.name,
            image: schema.user.image,
          },
        })
        .from(schema.recipe)
        .innerJoin(schema.user, eq(schema.recipe.userId, schema.user.id))
        .where(cursorFilter ? and(visibilityFilter, cursorFilter) : visibilityFilter)
        .orderBy(desc(schema.recipe.createdAt), desc(schema.recipe.id))
        .limit(limit.data + 1);

      const page = paginateRecipeFeed(rows, limit.data);
      setRecipeReadCacheHeaders(
        c,
        scope.data === "public" && !hasSessionSignal(c),
      );
      return c.json({
        items: page.items.map(({ recipe, author }) => ({
          type: "recipe_added" as const,
          recipe: recipeResponse(recipe),
          author,
          createdAt: recipe.createdAt,
        })),
        nextCursor: page.nextCursor,
      });
    },
  );
});

async function cookConnections(db: Db, cookId: string) {
  const followers = await db
    .select({
      id: schema.user.id,
      name: schema.user.name,
      image: schema.user.image,
      totalCount: sql<number>`count(*) over()`.mapWith(Number),
    })
    .from(schema.userFollow)
    .innerJoin(
      schema.user,
      eq(schema.userFollow.followerUserId, schema.user.id),
    )
    .where(eq(schema.userFollow.followedUserId, cookId))
    .orderBy(desc(schema.userFollow.createdAt))
    .limit(PUBLIC_COOK_CONNECTION_LIMIT);
  const following = await db
    .select({
      id: schema.user.id,
      name: schema.user.name,
      image: schema.user.image,
      totalCount: sql<number>`count(*) over()`.mapWith(Number),
    })
    .from(schema.userFollow)
    .innerJoin(
      schema.user,
      eq(schema.userFollow.followedUserId, schema.user.id),
    )
    .where(eq(schema.userFollow.followerUserId, cookId))
    .orderBy(desc(schema.userFollow.createdAt))
    .limit(PUBLIC_COOK_CONNECTION_LIMIT);

  return {
    followersCount: followers[0]?.totalCount ?? 0,
    followingCount: following[0]?.totalCount ?? 0,
    followers: followers.map(({ totalCount: _, ...cook }) => cook),
    following: following.map(({ totalCount: _, ...cook }) => cook),
  };
}

registerRoute("get", "/recipes/cooks", async (c) => {
  const cookValue = c.req.query("cook");
  const cookId =
    cookValue === undefined ? null : publicCookIdSchema.safeParse(cookValue);
  if (cookId && !cookId.success) {
    return c.json({ error: "Invalid cook query" }, 400);
  }

  return withDatabase(
    c,
    "query",
    "GET /recipes/cooks query failed",
    async (db) => {
      if (cookId?.success) {
        const rows = await db
          .select({
            recipe: schema.recipe,
            author: {
              id: schema.user.id,
              name: schema.user.name,
              image: schema.user.image,
            },
          })
          .from(schema.recipe)
          .innerJoin(schema.user, eq(schema.recipe.userId, schema.user.id))
          .where(
            and(
              eq(schema.recipe.visibility, "public"),
              eq(schema.user.id, cookId.data),
            ),
          )
          .orderBy(desc(schema.recipe.createdAt), desc(schema.recipe.id))
          .limit(30);
        const first = rows[0];
        if (!first) {
          setRecipeReadCacheHeaders(c, !hasSessionSignal(c));
          return c.json({ cook: null });
        }
        const connections = await cookConnections(db, cookId.data);
        setRecipeReadCacheHeaders(c, !hasSessionSignal(c));
        return c.json({
          cook: {
            ...first.author,
            ...connections,
            activity: rows.map(({ recipe }) => ({
              type: "recipe_added" as const,
              recipe: recipeResponse(recipe),
              createdAt: recipe.createdAt,
            })),
          },
        });
      }

      const latestActivityAt = sql<string>`max(${schema.recipe.createdAt})`;
      const latestRecipeTitle =
        sql<string>`(array_agg(${schema.recipe.title} order by ${schema.recipe.createdAt} desc, ${schema.recipe.id} desc))[1]`;
      const cooks = await db
        .select({
          id: schema.user.id,
          name: schema.user.name,
          image: schema.user.image,
          activityCount: count(),
          latestRecipeTitle,
        })
        .from(schema.recipe)
        .innerJoin(schema.user, eq(schema.recipe.userId, schema.user.id))
        .where(eq(schema.recipe.visibility, "public"))
        .groupBy(schema.user.id, schema.user.name, schema.user.image)
        .orderBy(desc(latestActivityAt));
      setRecipeReadCacheHeaders(c, !hasSessionSignal(c));
      return c.json({ cooks });
    },
  );
});

registerRoute("get", "/recipes/cooks/me/connections", async (c) => {
  return withRecipeSession(
    c,
    "query",
    "GET /recipes/cooks/me/connections failed",
    async ({ db, session }) =>
      c.json(await cookConnections(db, session.user.id)),
  );
});

registerRoute("get", "/recipes/cooks/:cookId/follow", async (c) => {
  const cookId = publicCookIdSchema.safeParse(c.req.param("cookId"));
  if (!cookId.success) return c.json({ error: "Invalid cook ID" }, 400);

  return withRecipeSession(
    c,
    "query",
    "GET /recipes/cooks/:cookId/follow failed",
    async ({ db, session }) => {
      if (cookId.data === session.user.id) {
        return c.json({ following: false, canFollow: false });
      }
      const [cook] = await db
        .select({ id: schema.user.id })
        .from(schema.user)
        .where(eq(schema.user.id, cookId.data))
        .limit(1);
      if (!cook) return c.notFound();
      const [follow] = await db
        .select({ followedUserId: schema.userFollow.followedUserId })
        .from(schema.userFollow)
        .where(
          and(
            eq(schema.userFollow.followerUserId, session.user.id),
            eq(schema.userFollow.followedUserId, cookId.data),
          ),
        )
        .limit(1);
      return c.json({ following: Boolean(follow), canFollow: true });
    },
  );
});

registerRoute("put", "/recipes/cooks/:cookId/follow", async (c) => {
  const csrfFailure = validateCsrf(c);
  if (csrfFailure) return csrfFailure;
  const cookId = publicCookIdSchema.safeParse(c.req.param("cookId"));
  if (!cookId.success) return c.json({ error: "Invalid cook ID" }, 400);

  return withRecipeSession(
    c,
    "mutation",
    "PUT /recipes/cooks/:cookId/follow failed",
    async ({ db, session }) => {
      if (cookId.data === session.user.id) {
        return c.json({ error: "You cannot follow yourself" }, 400);
      }
      const [cook] = await db
        .select({ id: schema.user.id })
        .from(schema.user)
        .where(eq(schema.user.id, cookId.data))
        .limit(1);
      if (!cook) return c.notFound();
      await db
        .insert(schema.userFollow)
        .values({
          followerUserId: session.user.id,
          followedUserId: cookId.data,
        })
        .onConflictDoNothing();
      return c.json({ following: true, canFollow: true });
    },
  );
});

registerRoute("delete", "/recipes/cooks/:cookId/follow", async (c) => {
  const csrfFailure = validateCsrf(c);
  if (csrfFailure) return csrfFailure;
  const cookId = publicCookIdSchema.safeParse(c.req.param("cookId"));
  if (!cookId.success) return c.json({ error: "Invalid cook ID" }, 400);

  return withRecipeSession(
    c,
    "mutation",
    "DELETE /recipes/cooks/:cookId/follow failed",
    async ({ db, session }) => {
      if (cookId.data === session.user.id) {
        return c.json({ error: "You cannot follow yourself" }, 400);
      }
      await db
        .delete(schema.userFollow)
        .where(
          and(
            eq(schema.userFollow.followerUserId, session.user.id),
            eq(schema.userFollow.followedUserId, cookId.data),
          ),
        );
      return c.json({ following: false, canFollow: true });
    },
  );
});

registerRoute("post", "/recipe-drafts/url", async (c) => {
  const csrfFailure = validateCsrf(c);
  if (csrfFailure) return csrfFailure;

  return withRecipeSession(
    c,
    "mutation",
    "POST /recipe-drafts/url failed",
    async ({ db, session }) => {
      const body = await parseJsonBody(c, importRecipeUrlBodySchema);
      if (!body.success) return body.response;

      const importLimit = await enforceRateLimit(
        db,
        `recipe-url-import:${session.user.id}`,
        RECIPE_URL_IMPORT_RATE_LIMIT,
      );
      if (!importLimit.allowed) {
        return rateLimitedResponse(c, importLimit.retryAfter);
      }

      const page = await fetchRecipePage(body.data.url);
      const recipe = await parseSchemaOrgRecipeHtml(page.html, page.url);
      if (!recipe) {
        return c.json(
          {
            error:
              "No complete schema.org Recipe was found on that page. It must include a name, ingredients, and instructions.",
          },
          422,
        );
      }
      if (recipe.source.length > 10_000) {
        return c.json(
          {
            error:
              "That recipe is too long to import. The Cooklang draft exceeds 10,000 characters.",
          },
          422,
        );
      }
      return c.json({ ...recipe, url: page.url });
    },
    {
      onError: (error) =>
        error instanceof RecipeUrlImportError
          ? c.json({ error: error.message }, error.status)
          : undefined,
    },
  );
});

registerRoute("post", "/recipe-drafts/file", async (c) => {
  const csrfFailure = validateCsrf(c);
  if (csrfFailure) return csrfFailure;

  return withRecipeSession(
    c,
    "mutation",
    "POST /recipe-drafts/file failed",
    async ({ db, session }) => {
      const body = await parseJsonBody(c, importRecipeFileBodySchema);
      if (!body.success) return body.response;

      const importLimit = await enforceRateLimit(
        db,
        `recipe-file-import:${session.user.id}`,
        RECIPE_FILE_IMPORT_RATE_LIMIT,
      );
      if (!importLimit.allowed) {
        return rateLimitedResponse(c, importLimit.retryAfter);
      }

      const recipe = await parseRecipeFile(
        body.data.filename,
        body.data.content,
      );
      if (!recipe) {
        return c.json(
          {
            error:
              "No complete recipe was found in that file. Cooklang files need ingredients and instructions; schema.org files need a Recipe with a name, ingredients, and instructions.",
          },
          422,
        );
      }
      if (recipe.source.length > 10_000) {
        return c.json(
          {
            error:
              "That recipe is too long to import. The Cooklang draft exceeds 10,000 characters.",
          },
          422,
        );
      }
      return c.json(recipe);
    },
  );
});

registerRoute("get", "/recipes/:slug", async (c) => {
  const slug = parseRecipeSlug(c);
  if (!slug.success) return slug.response;

  return withDatabase(
    c,
    "query",
    "GET /recipes/:slug query failed",
    async (db) => {
      const queryResult = await withRecipeApiSpan(
        c,
        "recipes.detail.query",
        async () => {
          const [session, recipe] = await Promise.all([
            loadOptionalRecipeSession(c, db),
            findRecipeBySlug(db, slug.slug),
          ]);
          if (!recipe) return c.notFound();

          if (recipe.visibility !== "public") {
            if (!session) return c.notFound();
            const household = {
              userSharesHouseholdWithOwner: await usersShareHousehold(
                db,
                recipe.userId,
                session.user.id,
              ),
            };
            const decision = authorizeRecipeRead(
              session.user,
              recipe,
              household,
            );
            if (!decision.allowed) return c.notFound();
          }

          return { recipe, session };
        },
      );
      if (queryResult instanceof Response) return queryResult;
      setRecipeReadCacheHeaders(
        c,
        queryResult.recipe.visibility === "public" &&
          !queryResult.session &&
          !hasSessionSignal(c),
      );
      return withRecipeApiSpan(c, "http.response.serialize", async () =>
        c.json({
          ...recipeResponse(queryResult.recipe),
          owned: queryResult.session?.user.id === queryResult.recipe.userId,
        }),
      );
    },
  );
});

async function findRecommendableRecipe(
  c: Context<AppEnv>,
  db: Db,
  session: AuthenticatedSession,
  slug: string,
  recipientUserId: string,
): Promise<Recipe | Response> {
  const recipe = await findRecipeBySlug(db, slug);
  if (!recipe) return c.notFound();
  if (recipe.visibility === "private") {
    return c.json(
      { error: "Only public or household recipes can be recommended" },
      409,
    );
  }
  if (recipe.visibility === "household") {
    const decision = authorizeRecipeRead(session.user, recipe, {
      userSharesHouseholdWithOwner: await usersShareHousehold(
        db,
        recipe.userId,
        session.user.id,
      ),
    });
    if (!decision.allowed) return c.notFound();
  }
  if (recipe.userId === recipientUserId) {
    return c.json({ error: "That person already owns this recipe" }, 409);
  }
  return recipe;
}

async function validateRecommendationRecipient(
  c: Context<AppEnv>,
  db: Db,
  senderUserId: string,
  recipientUserId: string,
): Promise<Response | undefined> {
  const senderMembership = await findUserHouseholdMembership(db, senderUserId);
  if (!senderMembership) {
    return c.json(
      { error: "Join a household before recommending recipes" },
      409,
    );
  }
  const recipientMembership = await findHouseholdMembership(
    db,
    senderMembership.organizationId,
    recipientUserId,
  );
  if (!recipientMembership) {
    return c.json(
      { error: "Recipes can only be recommended to household members" },
      403,
    );
  }
}

async function recommendRecipe(
  c: Context<AppEnv>,
  db: Db,
  session: AuthenticatedSession,
  slug: string,
) {
  const body = await parseJsonBody(c, recommendRecipeBodySchema);
  if (!body.success) return body.response;
  if (body.data.recipientUserId === session.user.id) {
    return c.json({ error: "You cannot recommend a recipe to yourself" }, 400);
  }

  const recipe = await findRecommendableRecipe(
    c,
    db,
    session,
    slug,
    body.data.recipientUserId,
  );
  if (recipe instanceof Response) return recipe;

  const recipientFailure = await validateRecommendationRecipient(
    c,
    db,
    session.user.id,
    body.data.recipientUserId,
  );
  if (recipientFailure) return recipientFailure;

  const recommendationLimit = await enforceRateLimit(
    db,
    `recipe-recommendation:${session.user.id}`,
    RECIPE_RECOMMENDATION_RATE_LIMIT,
  );
  if (!recommendationLimit.allowed) {
    return rateLimitedResponse(c, recommendationLimit.retryAfter);
  }

  await db.transaction(async (tx) => {
    await createRecipeRecommendationNotification(tx, {
      recipientUserId: body.data.recipientUserId,
      recipe,
      actor: { id: session.user.id, name: session.user.name },
    });
  });
  return c.json({ recommended: true }, 201);
}

registerRoute("post", "/recipes/:slug/recommendations", async (c) => {
  const csrfFailure = validateCsrf(c);
  if (csrfFailure) return csrfFailure;
  const slug = parseRecipeSlug(c);
  if (!slug.success) return slug.response;

  return withRecipeSession(
    c,
    "mutation",
    "POST /recipes/:slug/recommendations failed",
    ({ db, session }) => recommendRecipe(c, db, session, slug.slug),
  );
});

registerRoute("post", "/recipes", async (c) => {
  const csrfFailure = validateCsrf(c);
  if (csrfFailure) return csrfFailure;

  return withRecipeSession(
    c,
    "mutation",
    "POST /recipes mutation failed",
    async ({ db, session }) => {
      const body = await parseJsonBody(c, createRecipeBodySchema);
      if (!body.success) return body.response;

      if (body.data.visibility === "household") {
        const membership = await findUserHouseholdMembership(
          db,
          session.user.id,
        );
        if (!membership) return authorizationResponse(c, forbidden());
      }

      const [recipe] = await db
        .insert(schema.recipe)
        .values({
          ...body.data,
          userId: session.user.id,
        })
        .returning();

      if (!recipe) return c.json({ error: "Database mutation failed" }, 502);

      return c.json(recipeResponse(recipe), 201);
    },
    {
      onError: (error) =>
        isUniqueViolation(error)
          ? c.json(
              {
                error:
                  "A recipe with this name already exists. Choose a different name.",
              },
              409,
            )
          : undefined,
    },
  );
});

registerRoute("patch", "/recipes/:slug", async (c) => {
  const slug = parseRecipeSlug(c);
  if (!slug.success) return slug.response;

  const csrfFailure = validateCsrf(c);
  if (csrfFailure) return csrfFailure;

  return withRecipeSession(
    c,
    "mutation",
    "PATCH /recipes/:slug mutation failed",
    async ({ db, session }) => {
      const recipe = await findOwnedRecipeBySlug(
        db,
        slug.slug,
        session.user.id,
      );
      if (!recipe) return c.notFound();

      const body = await parseJsonBody(c, updateRecipeBodySchema);
      if (!body.success) return body.response;

      if (body.data.visibility === "household") {
        const membership = await findUserHouseholdMembership(
          db,
          session.user.id,
        );
        if (!membership) return authorizationResponse(c, forbidden());
      }

      const updates = {
        ...body.data,
      };

      const [updatedRecipe] = await db
        .update(schema.recipe)
        .set(updates)
        .where(
          and(
            eq(schema.recipe.id, recipe.id),
            eq(schema.recipe.userId, session.user.id),
          ),
        )
        .returning();

      if (!updatedRecipe) return c.notFound();

      return c.json(recipeResponse(updatedRecipe));
    },
  );
});

registerRoute("post", "/recipes/:slug/household-share", async (c) => {
  const slug = parseRecipeSlug(c);
  if (!slug.success) return slug.response;

  const csrfFailure = validateCsrf(c);
  if (csrfFailure) return csrfFailure;

  return withRecipeSession(
    c,
    "mutation",
    "POST /recipes/:slug/household-share failed",
    async ({ db, session }) => {
      const recipe = await findOwnedRecipeBySlug(
        db,
        slug.slug,
        session.user.id,
      );
      if (!recipe) return c.notFound();

      const membership = await findUserHouseholdMembership(
        db,
        session.user.id,
      );
      if (!membership) return authorizationResponse(c, forbidden());

      const [updatedRecipe] = await db
        .update(schema.recipe)
        .set({
          visibility: "household",
        })
        .where(
          and(
            eq(schema.recipe.id, recipe.id),
            eq(schema.recipe.userId, session.user.id),
          ),
        )
        .returning();

      if (!updatedRecipe) return c.notFound();
      return c.json(recipeResponse(updatedRecipe));
    },
  );
});

registerRoute("delete", "/recipes/:slug/household-share", async (c) => {
  const slug = parseRecipeSlug(c);
  if (!slug.success) return slug.response;

  const csrfFailure = validateCsrf(c);
  if (csrfFailure) return csrfFailure;

  return withRecipeSession(
    c,
    "mutation",
    "DELETE /recipes/:slug/household-share failed",
    async ({ db, session }) => {
      const recipe = await findOwnedRecipeBySlug(
        db,
        slug.slug,
        session.user.id,
      );
      if (!recipe) return c.notFound();

      const ownerDecision = authorizeOwnerOnly(session.user, recipe);
      if (!ownerDecision.allowed) {
        return authorizationResponse(c, ownerDecision);
      }

      const [updatedRecipe] = await db
        .update(schema.recipe)
        .set({
          visibility: "private",
        })
        .where(
          and(
            eq(schema.recipe.id, recipe.id),
            eq(schema.recipe.userId, session.user.id),
          ),
        )
        .returning();

      if (!updatedRecipe) return c.notFound();
      return c.json(recipeResponse(updatedRecipe));
    },
  );
});

registerRoute("delete", "/recipes/:slug", async (c) => {
  const slug = parseRecipeSlug(c);
  if (!slug.success) return slug.response;

  const csrfFailure = validateCsrf(c);
  if (csrfFailure) return csrfFailure;

  return withRecipeSession(
    c,
    "mutation",
    "DELETE /recipes/:slug mutation failed",
    async ({ db, session }) => {
      const recipe = await findOwnedRecipeBySlug(
        db,
        slug.slug,
        session.user.id,
      );
      if (!recipe) return c.notFound();

      const [deletedRecipe] = await db
        .delete(schema.recipe)
        .where(
          and(
            eq(schema.recipe.id, recipe.id),
            eq(schema.recipe.userId, session.user.id),
          ),
        )
        .returning({ id: schema.recipe.id });
      if (!deletedRecipe) return c.notFound();

      return c.body(null, 204);
    },
  );
});

// This API owns recipe photo import auth, quotas, job creation,
// and status reads; the recipe-ingest Workflow owns the parsing chain.

const RECIPE_IMPORT_MAX_IMAGES = 6;
const RECIPE_IMPORT_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const RECIPE_IMPORT_MAX_ACTIVE_JOBS = 2;
const RECIPE_IMPORT_DAILY_JOB_LIMIT = 10;
const RECIPE_IMPORT_MAX_TOTAL_BYTES = 30 * 1024 * 1024;
const RECIPE_IMPORT_IMAGE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const recipeImportIdSchema = z.string().uuid();

function importJobResponse(job: RecipeImportJob) {
  return {
    id: job.id,
    status: job.status,
    currentStage: job.currentStage,
    progressLabel: job.progressLabel,
    imageCount: job.imageCount,
    error: job.errorMessage
      ? { type: job.errorType, message: job.errorMessage }
      : undefined,
    createdAt: job.createdAt,
    finishedAt: job.finishedAt,
  };
}

async function parseImportImages(
  c: Context<AppEnv>,
  form: FormData,
): Promise<
  | { success: true; images: { file: File; extension: string }[] }
  | { success: false; response: Response }
> {
  // workers-types declares FormData entries as string, but the runtime
  // returns File objects for file uploads — widen and narrow via instanceof.
  const entries: unknown[] = form.getAll("images");
  if (entries.length === 0) {
    return {
      success: false,
      response: c.json({ error: "At least one image is required" }, 400),
    };
  }
  if (entries.length > RECIPE_IMPORT_MAX_IMAGES) {
    return {
      success: false,
      response: c.json(
        { error: `At most ${RECIPE_IMPORT_MAX_IMAGES} images are allowed` },
        400,
      ),
    };
  }

  const images: { file: File; extension: string }[] = [];
  let totalBytes = 0;
  for (const entry of entries) {
    if (!(entry instanceof File)) {
      return {
        success: false,
        response: c.json({ error: "images must be file uploads" }, 400),
      };
    }
    const extension = RECIPE_IMPORT_IMAGE_EXTENSIONS[entry.type];
    if (!extension) {
      return {
        success: false,
        response: c.json(
          { error: "Images must be JPEG, PNG, or WebP" },
          415,
        ),
      };
    }
    if (entry.size === 0) {
      return {
        success: false,
        response: c.json({ error: "Images must not be empty" }, 400),
      };
    }
    if (entry.size > RECIPE_IMPORT_MAX_IMAGE_BYTES) {
      return {
        success: false,
        response: c.json(
          { error: "Each image must be 10MB or smaller" },
          413,
        ),
      };
    }
    totalBytes += entry.size;
    if (totalBytes > RECIPE_IMPORT_MAX_TOTAL_BYTES) {
      return {
        success: false,
        response: c.json(
          { error: "Images must total 30MB or less" },
          413,
        ),
      };
    }
    if (!(await hasExpectedImageSignature(entry, entry.type))) {
      return {
        success: false,
        response: c.json(
          { error: "Image contents do not match the declared file type" },
          415,
        ),
      };
    }
    images.push({ file: entry, extension });
  }
  return { success: true, images };
}

function recipeImportQuotaError(reason: "active" | "daily") {
  return reason === "active"
    ? "Too many imports in progress"
    : "Daily import limit reached";
}

registerRoute("post", "/recipe-imports", async (c) => {
  const csrfFailure = validateCsrf(c);
  if (csrfFailure) return csrfFailure;

  const artifacts = c.env.ARTIFACTS;
  const workflow = c.env.RECIPE_INGEST_WORKFLOW;
  if (!artifacts || !workflow) {
    return c.json({ error: "Recipe import is not configured" }, 503);
  }

  return withRecipeSession(
    c,
    "mutation",
    "POST /recipe-imports mutation failed",
    async ({ db, session }) => {
      const userId = session.user.id;

      const importLimit = await enforceRateLimit(
        db,
        `recipe-photo-import:${userId}`,
        RECIPE_PHOTO_IMPORT_RATE_LIMIT,
      );
      if (!importLimit.allowed) {
        return rateLimitedResponse(c, importLimit.retryAfter);
      }

      const form = await c.req.formData().catch(() => undefined);
      if (!form) {
        return c.json(
          { error: "Request body must be multipart/form-data" },
          415,
        );
      }
      const parsed = await parseImportImages(c, form);
      if (!parsed.success) return parsed.response;
      const { images } = parsed;

      const dayStart = new Date();
      dayStart.setUTCHours(0, 0, 0, 0);

      type QuotaOutcome =
        | { ok: true; job: RecipeImportJob }
        | { ok: false; reason: "active" | "daily" };

      const outcome = await db.transaction(async (tx): Promise<QuotaOutcome> => {
        // Serialize per-user job creation so concurrent uploads cannot slip past the limits.
        await tx
          .select({ id: schema.user.id })
          .from(schema.user)
          .where(eq(schema.user.id, userId))
          .for("update");

        const [active] = await tx
          .select({ value: count() })
          .from(schema.recipeImportJob)
          .where(
            and(
              eq(schema.recipeImportJob.userId, userId),
              inArray(schema.recipeImportJob.status, ["queued", "running"]),
            ),
          );
        if ((active?.value ?? 0) >= RECIPE_IMPORT_MAX_ACTIVE_JOBS) {
          return { ok: false, reason: "active" };
        }

        const [today] = await tx
          .select({ value: count() })
          .from(schema.recipeImportJob)
          .where(
            and(
              eq(schema.recipeImportJob.userId, userId),
              gte(schema.recipeImportJob.createdAt, dayStart),
            ),
          );
        if ((today?.value ?? 0) >= RECIPE_IMPORT_DAILY_JOB_LIMIT) {
          return { ok: false, reason: "daily" };
        }

        const [job] = await tx
          .insert(schema.recipeImportJob)
          .values({ userId, imageCount: images.length })
          .returning();
        if (!job) throw new Error("Recipe import job insert returned no row");
        return { ok: true, job };
      });

      if (!outcome.ok) {
        return c.json(
          {
            error: recipeImportQuotaError(outcome.reason),
          },
          429,
        );
      }
      const job = outcome.job;

      try {
        await Promise.all(
          images.map(({ file, extension }, index) =>
            artifacts.put(sourceImageKey(job.id, index, extension), file, {
              httpMetadata: { contentType: file.type },
            }),
          ),
        );
        await withPostHogSpan(
          {
            env: c.env,
            serviceName: "recipe-api",
            spanName: "workflow.start recipe-ingest",
            traceCarrier: traceCarrierFromHeaders(c.req.raw.headers),
            attributes: { "recipe.import.job_id": job.id },
            waitUntil: c.executionCtx,
          },
          async (span) => {
            const traceContext = traceCarrierFromSpan(span);
            await workflow.create({
              id: job.id,
              params: {
                jobId: job.id,
                ...(traceContext ? { traceContext } : {}),
              },
            });
          },
        );
      } catch (error) {
        console.error("POST /recipe-imports failed to start workflow", error);
        // Best-effort cleanup so partially uploaded images don't accumulate.
        try {
          const uploaded = await artifacts.list({
            prefix: importJobPrefix(job.id),
          });
          await Promise.all(
            uploaded.objects.map((object) => artifacts.delete(object.key)),
          );
        } catch (cleanupError) {
          console.error(
            `Failed to clean up R2 objects for import ${job.id}`,
            cleanupError,
          );
        }
        await db
          .update(schema.recipeImportJob)
          .set({
            status: "failed",
            progressLabel: "Import failed",
            errorType: "StartError",
            errorMessage: "Failed to start the import",
            finishedAt: new Date(),
          })
          .where(eq(schema.recipeImportJob.id, job.id));
        return c.json({ error: "Failed to start the import" }, 502);
      }

      return c.json(importJobResponse(job), 202);
    },
  );
});

registerRoute("get", "/recipe-imports", async (c) => {
  return withRecipeSession(
    c,
    "lookup",
    "GET /recipe-imports lookup failed",
    async ({ db, session }) => {
      const jobs = await db
        .select()
        .from(schema.recipeImportJob)
        .where(eq(schema.recipeImportJob.userId, session.user.id))
        .orderBy(desc(schema.recipeImportJob.createdAt))
        .limit(20);

      return c.json({ imports: jobs.map(importJobResponse) });
    },
  );
});

registerRoute("get", "/recipe-imports/:jobId", async (c) => {
  const jobId = recipeImportIdSchema.safeParse(c.req.param("jobId"));
  if (!jobId.success) return c.json({ error: "Import not found" }, 404);

  return withRecipeSession(
    c,
    "lookup",
    "GET /recipe-imports/:jobId lookup failed",
    async ({ db, session }) => {
      const [job] = await db
        .select()
        .from(schema.recipeImportJob)
        .where(eq(schema.recipeImportJob.id, jobId.data))
        .limit(1);
      if (!job || job.userId !== session.user.id) {
        return c.json({ error: "Import not found" }, 404);
      }

      const artifacts = await db
        .select({
          stage: schema.recipeImportArtifact.stage,
          kind: schema.recipeImportArtifact.kind,
          r2Key: schema.recipeImportArtifact.r2Key,
          checksum: schema.recipeImportArtifact.checksum,
          schemaVersion: schema.recipeImportArtifact.schemaVersion,
          model: schema.recipeImportArtifact.model,
          provider: schema.recipeImportArtifact.provider,
          createdAt: schema.recipeImportArtifact.createdAt,
        })
        .from(schema.recipeImportArtifact)
        .where(eq(schema.recipeImportArtifact.jobId, job.id))
        .orderBy(schema.recipeImportArtifact.createdAt);

      const draft =
        job.status === "succeeded"
          ? (
              await db
                .select({ preview: schema.recipeImportArtifact.preview })
                .from(schema.recipeImportArtifact)
                .where(
                  and(
                    eq(schema.recipeImportArtifact.jobId, job.id),
                    eq(schema.recipeImportArtifact.stage, "finalize"),
                    eq(schema.recipeImportArtifact.kind, "draft"),
                  ),
                )
                .limit(1)
            )[0]?.preview
          : undefined;

      return c.json({ ...importJobResponse(job), artifacts, draft });
    },
  );
});

export { HouseholdRealtimeRoom } from "./realtime-room";
export { app };

// Idle rate-limit keys and pantry idempotency receipts do not need permanent
// storage. The daily sweep retains both for at least the longest retry window.
const OPERATIONAL_ROW_RETENTION_MS = 24 * 60 * 60 * 1000;

async function cleanupOperationalRows(env: Bindings): Promise<void> {
  const connectionString = databaseConnection(env);
  if (!connectionString) return;

  const { db, client } = createDb(connectionString);
  try {
    const cutoff = new Date(Date.now() - OPERATIONAL_ROW_RETENTION_MS);
    await db
      .delete(schema.appRateLimit)
      .where(lt(schema.appRateLimit.windowStart, cutoff));
    await db
      .delete(schema.pantryOperation)
      .where(lt(schema.pantryOperation.createdAt, cutoff));
    await db
      .delete(schema.authSecondaryStorage)
      .where(lt(schema.authSecondaryStorage.expiresAt, new Date()));
  } catch (e) {
    console.error("Operational row cleanup failed", e);
  } finally {
    await closeDbClient(client);
  }
}

export default {
  fetch: (request, env, ctx) =>
    withPostHogRequest(
      {
        env,
        serviceName: "recipe-api",
        spanName: `${request.method} ${new URL(request.url).pathname}`,
        request,
        waitUntil: ctx,
      },
      async (span) => {
        const headers = injectTraceContext(
          new Headers(request.headers),
          traceCarrierFromSpan(span),
        );
        return app.fetch(new Request(request, { headers }), env, ctx);
      },
    ),
  scheduled: (_event, env, ctx) => {
    ctx.waitUntil(cleanupOperationalRows(env));
  },
} satisfies ExportedHandler<Bindings>;
