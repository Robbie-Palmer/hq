// Authenticated preview smoke test that runs inside the protected GitHub
// environment. It creates a Better Auth session directly against the isolated
// preview database, then exercises the deployed Worker without bypassing
// Cloudflare Access on the Pages UI.
import { z } from "zod";
import { previewScenarios } from "../src/preview-scenarios";
import {
  previewApiOriginSchema,
  previewApiRequestURL,
} from "./preview-api-url";
import { createPreviewSessionCookie } from "./preview-session";

const smokeEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_URL: z
    .httpUrl()
    .refine((value) => new URL(value).protocol === "https:"),
  BETTER_AUTH_SECRET: z.string().min(1),
  PREVIEW_API_URL: previewApiOriginSchema,
  PREVIEW_AUTH_PASSWORD: z.string().min(1),
});

type RecipeBoxProfile = {
  completed: boolean;
  recipeSlugs: string[];
  staticRecipeSlugs: string[];
};

type DietProfile = {
  presetDietKeys: string[];
  excludedIngredientSlugs: string[];
  excludedGroupKeys: string[];
  recipeMatchMode: "hide" | "warn";
};

type DietOptions = {
  groups: Array<{
    key: string;
    broaderGroupKeys: string[];
    ingredientSlugs: string[];
  }>;
};

type HouseholdSummary = {
  id: string;
  name: string;
  membership: { id: string; role: string };
};

type HouseholdMember = {
  id: string;
  userId: string;
  role: string;
};

type FollowStatus = {
  following: boolean;
  canFollow: boolean;
};

type CookConnection = {
  id: string;
  name: string;
};

type PublicCookProfile = {
  id: string;
  followersCount: number;
  followingCount: number;
  followers: CookConnection[];
  following: CookConnection[];
};

type CookConnections = Omit<PublicCookProfile, "id">;

type DiscoverFeed = {
  items: Array<{ recipe: { slug: string }; author: { id: string } }>;
};

type ShoppingList = {
  id: string;
  scope: { type: "personal" | "household" };
  snapshot: {
    plan: Array<{
      id: string;
      kind: string;
      status: string;
      date?: string;
      recipeSlug?: string;
      sourceMealId?: string;
    }>;
  };
};

const env = smokeEnvSchema.parse(process.env);
const apiURL = env.PREVIEW_API_URL;
const READY_TIMEOUT_MS = 120_000;
const REQUEST_TIMEOUT_MS = 15_000;
const RETRY_DELAY_MS = 2_000;

async function fetchWhenReady(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const requestURL = previewApiRequestURL(apiURL, path);
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(requestURL, {
        ...init,
        signal: AbortSignal.timeout(
          Math.min(REQUEST_TIMEOUT_MS, Math.max(1, deadline - Date.now())),
        ),
      });
      // Wrangler can report success before every request reaches the new Worker
      // version. The previous version can lack a new route (404) or point at the
      // just-deleted Neon branch (5xx).
      if (response.status !== 404 && response.status < 500) return response;
      lastError = new Error(`GET ${path} returned ${response.status}`);
      await response.body?.cancel();
    } catch (error) {
      lastError = error;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(RETRY_DELAY_MS, remaining)),
    );
  }
  throw new Error(`GET ${path} did not become ready within 120 seconds`, {
    cause: lastError,
  });
}

async function expectJson<T>(
  path: string,
  cookie: string,
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("cookie", cookie);
  const response = await fetchWhenReady(path, { ...init, headers });
  if (response.ok) return response.json() as Promise<T>;
  throw new Error(
    `${init?.method ?? "GET"} ${path} returned ${response.status}: ${await response.text()}`,
  );
}

async function expectAuthenticationRequired(path: string): Promise<void> {
  const response = await fetchWhenReady(path);
  if (response.status !== 401) {
    throw new Error(
      `Unauthenticated GET ${path} returned ${response.status}, expected 401: ${await response.text()}`,
    );
  }
}

async function createSessionCookie(
  email: string = previewScenarios[0].email,
): Promise<string> {
  return createPreviewSessionCookie(env, email);
}

function assertStringArray(
  value: unknown,
  name: string,
): asserts value is string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new TypeError(`${name} must be an array of strings`);
  }
}

await expectAuthenticationRequired("/api/profile/recipe-box");
await expectAuthenticationRequired("/recipes/discover/feed?scope=following");
await expectAuthenticationRequired("/recipes/cooks/me/connections");

const cookie = await createSessionCookie();
const recipeBox = await expectJson<RecipeBoxProfile>(
  "/api/profile/recipe-box",
  cookie,
);
if (typeof recipeBox.completed !== "boolean") {
  throw new TypeError("Recipe-box completion state must be boolean");
}
assertStringArray(recipeBox.recipeSlugs, "recipeSlugs");
assertStringArray(recipeBox.staticRecipeSlugs, "staticRecipeSlugs");
if (
  recipeBox.completed ||
  recipeBox.recipeSlugs.length > 0 ||
  recipeBox.staticRecipeSlugs.length > 0
) {
  throw new Error("Empty-account recipe-box fixture did not match");
}

const dietProfile = await expectJson<DietProfile>("/api/profile/diet", cookie);
assertStringArray(dietProfile.presetDietKeys, "presetDietKeys");
assertStringArray(
  dietProfile.excludedIngredientSlugs,
  "excludedIngredientSlugs",
);
assertStringArray(dietProfile.excludedGroupKeys, "excludedGroupKeys");
if (
  dietProfile.recipeMatchMode !== "hide" &&
  dietProfile.recipeMatchMode !== "warn"
) {
  throw new TypeError("recipeMatchMode must be hide or warn");
}
if (
  dietProfile.presetDietKeys.length > 0 ||
  dietProfile.excludedIngredientSlugs.length > 0 ||
  dietProfile.excludedGroupKeys.length > 0 ||
  dietProfile.recipeMatchMode !== "hide"
) {
  throw new Error("Empty-account diet fixture did not match");
}

const dietOptions = await expectJson<DietOptions>(
  "/api/profile/diet/options",
  cookie,
);
const chickenGroup = dietOptions.groups.find(
  (group) => group.key === "chicken",
);
if (!chickenGroup) {
  throw new Error("Chicken ingredient group was missing");
}
if (
  chickenGroup.broaderGroupKeys.length !== 1 ||
  chickenGroup.broaderGroupKeys[0] !== "poultry" ||
  ![
    "chicken-breast",
    "chicken-thigh",
    "chicken-stock",
    "chicken-stock-pot",
  ].every((slug) => chickenGroup.ingredientSlugs.includes(slug))
) {
  throw new Error("Chicken ingredient-group hierarchy did not match");
}
const poultryGroup = dietOptions.groups.find(
  (group) => group.key === "poultry",
);
if (!poultryGroup) {
  throw new Error("Poultry ingredient group was missing");
}
if (
  ![
    "chicken-breast",
    "chicken-thigh",
    "chicken-stock",
    "chicken-stock-pot",
    "turkey-mince",
  ].every((slug) => poultryGroup.ingredientSlugs.includes(slug))
) {
  throw new Error("Poultry did not inherit the chicken group ingredients");
}
const stockGroup = dietOptions.groups.find((group) => group.key === "stock");
if (!stockGroup) {
  throw new Error("Stock ingredient group was missing");
}
if (
  !["chicken-stock", "chicken-stock-pot", "vegetable-stock"].every((slug) =>
    stockGroup.ingredientSlugs.includes(slug),
  )
) {
  throw new Error("Stock ingredient-group fixture did not match");
}

// Household owner scenario. The household routes accept only UUID-form
// `householdId`/`memberId`, so drive them end to end — resolve the household,
// then read its members — to confirm the seeded household is reachable through
// the API rather than merely present in the database.
const ownerCookie = await createSessionCookie("household-owner@preview.invalid");
const memberCookie = await createSessionCookie(
  "household-member@preview.invalid",
);
const households = await expectJson<HouseholdSummary[]>(
  "/households",
  ownerCookie,
);
const household = households[0];
if (households.length !== 1 || !household) {
  throw new Error(
    `Household owner should belong to exactly one household, saw ${households.length}`,
  );
}
if (!household.id || household.membership.role !== "owner") {
  throw new Error("Household owner fixture did not match");
}

// The ID must be a UUID — that is exactly what the household routes require —
// and validating it before building the request path keeps untrusted response
// data out of the URL.
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!uuidPattern.test(household.id)) {
  throw new Error(`Household ID is not a UUID: ${household.id}`);
}

const members = await expectJson<HouseholdMember[]>(
  `/households/${encodeURIComponent(household.id)}/members`,
  ownerCookie,
);
const memberRoles = members
  .map((member) => member.role)
  .sort((a, b) => a.localeCompare(b));
if (
  members.length !== 2 ||
  memberRoles[0] !== "member" ||
  memberRoles[1] !== "owner"
) {
  throw new Error(
    `Household should have one owner and one member, saw roles: ${memberRoles.join(", ")}`,
  );
}

const [ownerShoppingList, memberShoppingList] = await Promise.all([
  expectJson<ShoppingList>("/api/shopping-lists/current", ownerCookie),
  expectJson<ShoppingList>("/api/shopping-lists/current", memberCookie),
]);
const seededMealIds = new Set(
  ownerShoppingList.snapshot.plan.map(({ id }) => id),
);
if (
  ownerShoppingList.scope.type !== "household" ||
  memberShoppingList.scope.type !== "household" ||
  ownerShoppingList.id !== memberShoppingList.id ||
  ownerShoppingList.snapshot.plan.length !== 6 ||
  memberShoppingList.snapshot.plan.length !== 6 ||
  ![
    "preview-household-flatbread-idea",
    "preview-household-curry-dinner",
    "preview-household-curry-leftovers",
    "preview-household-decide-together",
    "preview-household-flatbread-dinner",
    "preview-household-dinner-out",
  ].every((id) => seededMealIds.has(id))
) {
  throw new Error("Shared household meal-plan fixture did not match");
}
const leftover = ownerShoppingList.snapshot.plan.find(
  ({ id }) => id === "preview-household-curry-leftovers",
);
if (leftover?.sourceMealId !== "preview-household-curry-dinner") {
  throw new Error("Household leftover did not reference its source meal");
}

// Cross-household social graph. The solo recipes cook and household owner are
// seeded as reciprocal follows, while only the owner's public recipe may cross
// the household boundary.
const recipesCookie = await createSessionCookie(
  "recipes-user@preview.invalid",
);
const cooks = await expectJson<{
  cooks: Array<{ id: string; name: string }>;
}>("/recipes/cooks", recipesCookie);
const recipesCook = cooks.cooks.find(
  (cook) => cook.name === "User with recipes",
);
const ownerCook = cooks.cooks.find((cook) => cook.name === "Household owner");
if (!recipesCook || !ownerCook) {
  throw new Error("Cross-household public cook fixtures were not available");
}
if (members.some((member) => member.userId === recipesCook.id)) {
  throw new Error("Solo recipes cook unexpectedly belongs to the household");
}

const ownerFollowsRecipes = await expectJson<FollowStatus>(
  `/recipes/cooks/${recipesCook.id}/follow`,
  ownerCookie,
);
const recipesFollowsOwner = await expectJson<FollowStatus>(
  `/recipes/cooks/${ownerCook.id}/follow`,
  recipesCookie,
);
if (!ownerFollowsRecipes.following || !recipesFollowsOwner.following) {
  throw new Error("Cross-household reciprocal follow fixture did not match");
}

const ownerProfile = await expectJson<{ cook: PublicCookProfile }>(
  `/recipes/cooks?cook=${ownerCook.id}`,
  recipesCookie,
);
const recipesProfile = await expectJson<{ cook: PublicCookProfile }>(
  `/recipes/cooks?cook=${recipesCook.id}`,
  ownerCookie,
);
if (
  !ownerProfile.cook.followers.some((cook) => cook.id === recipesCook.id) ||
  !ownerProfile.cook.following.some((cook) => cook.id === recipesCook.id) ||
  !recipesProfile.cook.followers.some((cook) => cook.id === ownerCook.id) ||
  !recipesProfile.cook.following.some((cook) => cook.id === ownerCook.id) ||
  ownerProfile.cook.followersCount < 1 ||
  ownerProfile.cook.followingCount < 1 ||
  recipesProfile.cook.followersCount < 1 ||
  recipesProfile.cook.followingCount < 1
) {
  throw new Error("Public cook profiles did not expose reciprocal follows");
}

const ownerConnections = await expectJson<CookConnections>(
  "/recipes/cooks/me/connections",
  ownerCookie,
);
const recipesConnections = await expectJson<CookConnections>(
  "/recipes/cooks/me/connections",
  recipesCookie,
);
if (
  !ownerConnections.followers.some((cook) => cook.id === recipesCook.id) ||
  !ownerConnections.following.some((cook) => cook.id === recipesCook.id) ||
  !recipesConnections.followers.some((cook) => cook.id === ownerCook.id) ||
  !recipesConnections.following.some((cook) => cook.id === ownerCook.id)
) {
  throw new Error("Signed-in profiles did not expose reciprocal follows");
}

const recipesFollowingFeed = await expectJson<DiscoverFeed>(
  "/recipes/discover/feed?scope=following",
  recipesCookie,
);
if (
  !recipesFollowingFeed.items.some(
    (item) =>
      item.author.id === ownerCook.id &&
      item.recipe.slug === "preview-public-household-flatbread",
  )
) {
  throw new Error("Solo cook feed did not include the followed owner's public recipe");
}
if (
  recipesFollowingFeed.items.some(
    (item) => item.recipe.slug === "preview-household-veggie-curry",
  )
) {
  throw new Error("Household-only recipe leaked to an outside follower");
}

const ownerFollowingFeed = await expectJson<DiscoverFeed>(
  "/recipes/discover/feed?scope=following",
  ownerCookie,
);
if (
  !ownerFollowingFeed.items.some(
    (item) =>
      item.author.id === recipesCook.id &&
      item.recipe.slug === "preview-public-tomato-toast",
  ) ||
  !ownerFollowingFeed.items.some(
    (item) => item.recipe.slug === "preview-household-veggie-curry",
  )
) {
  throw new Error(
    "Household owner feed did not combine followed public and household activity",
  );
}

// Keep mutation coverage independent from the seeded reciprocal relationship.
const emptyInitialFollow = await expectJson<FollowStatus>(
  `/recipes/cooks/${ownerCook.id}/follow`,
  cookie,
);
if (!emptyInitialFollow.canFollow || emptyInitialFollow.following) {
  throw new Error("Empty-account follow fixture did not start unfollowed");
}
const emptyFollowed = await expectJson<FollowStatus>(
  `/recipes/cooks/${ownerCook.id}/follow`,
  cookie,
  { method: "PUT", headers: { origin: env.BETTER_AUTH_URL } },
);
if (!emptyFollowed.following) {
  throw new Error("Empty account could not follow the household owner");
}
const emptyUnfollowed = await expectJson<FollowStatus>(
  `/recipes/cooks/${ownerCook.id}/follow`,
  cookie,
  { method: "DELETE", headers: { origin: env.BETTER_AUTH_URL } },
);
if (emptyUnfollowed.following) {
  throw new Error("Empty account could not clean up its preview follow");
}

console.log("Authenticated preview profile smoke test passed.");
