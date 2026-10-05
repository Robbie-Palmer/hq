import type { AgentSession } from "@better-auth/agent-auth";
import { and, eq } from "drizzle-orm";
import { strToU8, zipSync } from "fflate";
import { createDb, schema } from "recipe-db";
import { insertGeneratedDraft, readBatchDrafts } from "recipe-db/batch-drafts";
import { artifactKey, sourceImageKey } from "recipe-domain/import-storage";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { executeRecipeAgentCapability } from "../../src/agent-auth";
import { createAuth } from "../../src/auth";
import { beginBatchUndo, executeBatchUndo, previewBatchUndo } from "../../src/batch-undo";
import { betterAuthSessionCookie } from "../../src/better-auth-session-cookie";
import { undoCookLogMutation } from "../../src/cook-log/services/undo-cook-log-mutation";
import {
  cookingLogResponse,
  decodeCookingLogCursor,
} from "../../src/cooking-reads";
import { app, type Bindings } from "../../src/index";
import { listPantryMutationHistory } from "../../src/pantry/services/list-pantry-mutation-history";
import { previewPantryMutationUndo } from "../../src/pantry/services/preview-pantry-mutation-undo";
import { reconcilePantry } from "../../src/pantry/services/reconcile-pantry";
import { undoPantryMutation } from "../../src/pantry/services/undo-pantry-mutation";
import { syncCanonicalUserEmail } from "../../src/user-emails";

const databaseURL = process.env.DATABASE_URL;
if (!databaseURL) throw new Error("DATABASE_URL is required for integration tests");

const authOrigin = "http://localhost:3000";
const authSecret = "integration-test-secret-that-is-at-least-thirty-two-characters";
const password = "integration-password-123";

const baseEnv: Bindings = {
  DATABASE_URL: databaseURL,
  DEPLOYMENT_ENV: "preview",
  BETTER_AUTH_URL: authOrigin,
  BETTER_AUTH_SECRET: authSecret,
  PREVIEW_AUTH_PASSWORD: password,
  CF_ACCESS_TEAM_DOMAIN: "integration.cloudflareaccess.test",
  CF_ACCESS_AUD: "integration-audience",
};

const { db, client } = createDb(databaseURL);

type TestUser = {
  cookie: string;
  email: string;
  id: string;
};

function savedRecipeBody(slug: string, title: string): string {
  const source = "Mix the @salt{1%tsp} into the dish.";
  return JSON.stringify({
    version: 1,
    source,
    recipe: {
      slug,
      title,
      description: `${title} integration fixture.`,
      cookBody: source,
      date: "2026-07-17",
      cuisine: [],
      servings: 2,
      tags: [],
      cookware: [],
      ingredientGroups: [
        {
          items: [{ ingredient: "salt", amount: 1, unit: "tsp" }],
        },
      ],
      instructions: ["Mix the salt into the dish."],
    },
  });
}

async function createUser(name: string, email: string): Promise<TestUser> {
  const auth = createAuth(db, baseEnv, { allowPreviewSignUp: true });
  await auth.api.signUpEmail({
    body: { name, email, password },
  });

  const [createdUser] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.email, email))
    .limit(1);
  if (!createdUser) throw new Error(`Better Auth did not create ${email}`);

  await db
    .update(schema.user)
    .set({ emailVerified: true })
    .where(eq(schema.user.id, createdUser.id));
  await db
    .update(schema.userEmail)
    .set({ verified: true })
    .where(eq(schema.userEmail.userId, createdUser.id));

  const response = await auth.api.signInEmail({
    body: { email, password },
    asResponse: true,
  });
  if (!response.ok) {
    throw new Error(`Better Auth sign-in failed for ${email}: ${response.status}`);
  }

  const cookie = await betterAuthSessionCookie(response);

  return { cookie, email, id: createdUser.id };
}

function authenticatedRequest(
  user: TestUser,
  path: string,
  options: {
    body?: unknown;
    env?: Bindings;
    method?: "DELETE" | "GET" | "PATCH" | "POST" | "PUT";
    operationId?: string;
    executionCtx?: ExecutionContext;
  } = {},
) {
  const method = options.method ?? "GET";
  const headers = new Headers({ cookie: user.cookie });
  let body: string | undefined;
  if (options.body !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(options.body);
  }
  if (options.operationId) {
    headers.set("idempotency-key", options.operationId);
  }
  if (method !== "GET") headers.set("origin", authOrigin);

  return app.request(
    path,
    { method, headers, body },
    options.env ?? baseEnv,
    options.executionCtx,
  );
}

function delegatedAgentSession(user: TestUser): AgentSession {
  return {
    type: "delegated",
    agentId: "integration-agent",
    userId: user.id,
    agent: {
      id: "integration-agent",
      name: "Integration recipe helper",
      mode: "delegated",
      capabilityGrants: [],
      hostId: "integration-host",
      createdAt: new Date("2026-09-09T00:00:00.000Z"),
      activatedAt: new Date("2026-09-09T00:01:00.000Z"),
      metadata: null,
    },
    host: {
      id: "integration-host",
      userId: user.id,
      status: "active",
    },
    user: {
      id: user.id,
      name: "Integration cook",
      email: user.email,
    },
  };
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

beforeAll(async () => {
  const [migrationCount] = await client<{ count: number }[]>`
    select count(*)::integer as count
    from drizzle.__drizzle_migrations
  `;
  const [tableCount] = await client<{ count: number }[]>`
    select count(*)::integer as count
    from information_schema.tables
    where table_schema = 'public'
  `;
  const catalogRows = await client<
    { category: string | null; name: string; slug: string }[]
  >`
    select slug, name, category
    from ingredient
    where slug in (
      'almond-milk',
      'cajun-powder',
      'cajun-seasoning',
      'chilli-oil',
      'dried-bay-leaves',
      'dried-chives',
      'dried-dill',
      'dried-tarragon',
      'fajita-seasoning',
      'garlic-italian-seasoning',
      'ground-allspice',
      'ground-cinnamon',
      'ground-ginger',
      'ground-nutmeg',
      'ground-white-pepper',
      'harissa-seasoning',
      'maple-syrup',
      'medium-curry-powder',
      'mixed-spice',
      'salted-butter',
      'whole-cloves'
    )
    order by slug
  `;
  expect(migrationCount?.count).toBe(26);
  expect(tableCount?.count).toBe(55);
  expect(catalogRows).toEqual([
    { category: "dairy", name: "almond milk", slug: "almond-milk" },
    {
      category: "spice",
      name: "cajun seasoning",
      slug: "cajun-seasoning",
    },
    { category: "oil-fat", name: "chilli oil", slug: "chilli-oil" },
    {
      category: "herb",
      name: "dried bay leaves",
      slug: "dried-bay-leaves",
    },
    { category: "herb", name: "dried chives", slug: "dried-chives" },
    { category: "herb", name: "dried dill", slug: "dried-dill" },
    {
      category: "herb",
      name: "dried tarragon",
      slug: "dried-tarragon",
    },
    {
      category: "spice",
      name: "fajita seasoning",
      slug: "fajita-seasoning",
    },
    {
      category: "spice",
      name: "garlic Italian seasoning",
      slug: "garlic-italian-seasoning",
    },
    {
      category: "spice",
      name: "ground allspice",
      slug: "ground-allspice",
    },
    {
      category: "spice",
      name: "ground cinnamon",
      slug: "ground-cinnamon",
    },
    { category: "spice", name: "ground ginger", slug: "ground-ginger" },
    {
      category: "spice",
      name: "ground nutmeg",
      slug: "ground-nutmeg",
    },
    {
      category: "spice",
      name: "ground white pepper",
      slug: "ground-white-pepper",
    },
    {
      category: "spice",
      name: "harissa seasoning",
      slug: "harissa-seasoning",
    },
    { category: "condiment", name: "maple syrup", slug: "maple-syrup" },
    {
      category: "spice",
      name: "medium curry powder",
      slug: "medium-curry-powder",
    },
    { category: "spice", name: "mixed spice", slug: "mixed-spice" },
    { category: "dairy", name: "salted butter", slug: "salted-butter" },
    { category: "spice", name: "whole cloves", slug: "whole-cloves" },
  ]);
});

beforeEach(async () => {
  // Keep the migration journal and reference catalog installed by migrations.
  // These roots cover every mutable application table through CASCADE.
  await client.unsafe(`
    truncate table
      "user",
      "organization",
      "notification_event",
      "app_rate_limit",
      "verification",
      "agent_host",
      "agent_auth_audit_event",
      "auth_secondary_storage"
    restart identity cascade
  `);
});

afterAll(async () => {
  await client.end({ timeout: 5 });
});

describe("recipe API PostgreSQL integration", () => {
  it("updates the canonical email atomically", async () => {
    const cook = await createUser("Email Cook", "first@example.test");
    const otherCook = await createUser(
      "Other Email Cook",
      "claimed@example.test",
    );

    await syncCanonicalUserEmail(db, {
      id: cook.id,
      email: "replacement@example.test",
      emailVerified: true,
    });

    await expect(
      syncCanonicalUserEmail(db, {
        id: cook.id,
        email: otherCook.email,
        emailVerified: true,
      }),
    ).rejects.toThrow("Canonical email is already owned by another account");

    const emails = await db
      .select({
        email: schema.userEmail.email,
        isPrimary: schema.userEmail.isPrimary,
      })
      .from(schema.userEmail)
      .where(eq(schema.userEmail.userId, cook.id))
      .orderBy(schema.userEmail.email);
    expect(emails).toEqual([
      { email: "first@example.test", isPrimary: false },
      { email: "replacement@example.test", isPrimary: true },
    ]);
  });

  it("reserves each Agent Auth JTI once under concurrent requests", async () => {
    const auth = createAuth(db, baseEnv);
    const storage = auth.options.secondaryStorage;
    if (!storage) throw new Error("Secondary storage was not configured");

    const key = "agent-auth:jti:integration-agent:concurrent-jti";
    // get() atomically reserves a new JTI, so one caller sees it as unused and
    // every concurrent caller sees the reservation.
    const results = await Promise.all(
      Array.from({ length: 8 }, () => storage.get(key)),
    );

    expect(results.filter((result) => result === null)).toHaveLength(1);
    expect(results.filter((result) => result === "1")).toHaveLength(7);
  });

  it("allocates pantry revisions and item versions exactly once per operation", async () => {
    const cook = await createUser("Revision Cook", "revision@example.test");
    const firstOperationId = "0198f1f0-3333-7333-8333-333333333333";
    const secondOperationId = "0198f1f0-4444-7444-8444-444444444444";

    const first = await authenticatedRequest(cook, "/pantry/items/onion", {
      method: "PUT",
      body: { location: "cupboards" },
      operationId: firstOperationId,
    });
    expect(await json(first)).toMatchObject({
      operationId: firstOperationId,
      revision: "1",
      itemVersions: { onion: "1" },
    });

    const update = () =>
      authenticatedRequest(cook, "/pantry/items/onion", {
        method: "PUT",
        body: { location: "fresh" },
        operationId: secondOperationId,
      });
    const updated = await update();
    const duplicate = await update();
    expect(await json(duplicate)).toEqual(await json(updated));

    const snapshot = await authenticatedRequest(cook, "/pantry");
    expect(await json(snapshot)).toEqual({
      resourceId: cook.id,
      revision: "2",
      scope: { type: "personal" },
      stock: { onion: "fresh" },
      itemVersions: { onion: "2" },
    });
  });

  it("round-trips tenant-scoped authored terms across recipe settings", async () => {
    const cook = await createUser("Flexible Cook", "flexible@example.test");
    const otherCook = await createUser(
      "Other Flexible Cook",
      "other-flexible@example.test",
    );
    const householdResponse = await authenticatedRequest(cook, "/households", {
      method: "POST",
      body: { name: "Flexible Kitchen" },
    });
    expect(householdResponse.status).toBe(201);
    const household = await json<{ id: string }>(householdResponse);

    const pantryResponse = await authenticatedRequest(
      cook,
      `/pantry/items/${encodeURIComponent("Purple  Corn Meal")}`,
      { method: "PUT", body: { location: "cupboards" } },
    );
    expect(pantryResponse.status).toBe(200);
    expect(await json(pantryResponse)).toMatchObject({
      stock: { "purple corn meal": "cupboards" },
      unresolvedTerms: [
        expect.objectContaining({
          rawText: "Purple  Corn Meal",
          normalizedText: "purple corn meal",
          resolutionStatus: "unresolved",
        }),
      ],
    });

    const dietResponse = await authenticatedRequest(cook, "/api/profile/diet", {
      method: "PUT",
      body: {
        presetDietKeys: [],
        excludedIngredientSlugs: ["Tigernut Flour"],
        excludedGroupKeys: [],
        recipeMatchMode: "warn",
      },
    });
    expect(dietResponse.status).toBe(200);
    expect(await json(dietResponse)).toMatchObject({
      excludedIngredientSlugs: ["tigernut flour"],
      unresolvedTerms: [
        expect.objectContaining({
          rawText: "Tigernut Flour",
          normalizedText: "tigernut flour",
        }),
      ],
    });

    const equipmentResponse = await authenticatedRequest(
      cook,
      `/households/${household.id}/equipment/${encodeURIComponent("Clay Tagine")}`,
      { method: "PUT" },
    );
    expect(equipmentResponse.status).toBe(200);
    expect(await json(equipmentResponse)).toMatchObject({
      slug: "clay tagine",
      name: "Clay Tagine",
      unresolved: true,
    });

    const recipeBody = JSON.parse(
      savedRecipeBody("flexible-stew", "Flexible Stew"),
    ) as {
      recipe: {
        cookware: string[];
        ingredientGroups: Array<{ items: Array<{ ingredient: string }> }>;
      };
    };
    recipeBody.recipe.cookware = ["Stone Griddle"];
    const ingredient = recipeBody.recipe.ingredientGroups.at(0)?.items.at(0);
    if (!ingredient) throw new Error("Recipe fixture has no ingredient");
    ingredient.ingredient = "Sea Asparagus";
    const recipeResponse = await authenticatedRequest(cook, "/recipes", {
      method: "POST",
      body: {
        slug: "flexible-stew",
        title: "Flexible Stew",
        body: JSON.stringify(recipeBody),
        visibility: "private",
      },
    });
    expect(recipeResponse.status).toBe(201);

    const terms = await db
      .select()
      .from(schema.authoredTerm)
      .orderBy(schema.authoredTerm.rawText);
    expect(terms).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          organizationId: household.id,
          userId: null,
          kind: "ingredient",
          rawText: "Purple  Corn Meal",
          normalizedText: "purple corn meal",
          canonicalSlug: null,
          candidateMatches: [],
          frequency: 1,
          sourceContext: expect.objectContaining({ flow: "pantry" }),
          provenance: {
            kind: "user",
            actorUserId: cook.id,
          },
        }),
        expect.objectContaining({
          organizationId: household.id,
          kind: "equipment",
          rawText: "Clay Tagine",
          normalizedText: "clay tagine",
          canonicalSlug: null,
        }),
        expect.objectContaining({
          userId: cook.id,
          kind: "ingredient",
          rawText: "Sea Asparagus",
          normalizedText: "sea asparagus",
          sourceContext: expect.objectContaining({ flow: "recipe" }),
        }),
        expect.objectContaining({
          userId: cook.id,
          kind: "equipment",
          rawText: "Stone Griddle",
          normalizedText: "stone griddle",
          sourceContext: expect.objectContaining({ flow: "recipe" }),
        }),
        expect.objectContaining({
          userId: cook.id,
          kind: "ingredient",
          rawText: "Tigernut Flour",
          normalizedText: "tigernut flour",
          sourceContext: expect.objectContaining({ flow: "diet" }),
        }),
      ]),
    );
    expect(terms.some((term) => term.userId === otherCook.id)).toBe(false);

    const otherPantry = await authenticatedRequest(otherCook, "/pantry");
    expect(await json(otherPantry)).toMatchObject({ stock: {} });
    const otherDiet = await authenticatedRequest(otherCook, "/api/profile/diet");
    expect(await json(otherDiet)).not.toHaveProperty("unresolvedTerms");
  });

  it("records idempotent agent pantry mutations and compensates them", async () => {
    const cook = await createUser("Ledger Cook", "ledger@example.test");
    const mutation = {
      actor: {
        type: "agent" as const,
        userId: cook.id,
        agentId: "ledger-agent",
        agentName: "Pantry helper",
        hostId: "ledger-host",
        hostName: "Kitchen terminal",
      },
      capability: "pantry.reconcile" as const,
      reason: "Put away the grocery delivery",
      idempotencyKey: "0198f1f0-5555-7555-8555-555555555555",
      changes: [
        {
          ingredientSlug: "onion",
          expectedVersion: null,
          location: "fresh" as const,
        },
      ],
    };

    const applied = await reconcilePantry(db, mutation);
    const replayed = await reconcilePantry(db, mutation);
    expect(replayed).toMatchObject({
      changeSetId: applied.changeSetId,
      replayed: true,
    });
    expect(await listPantryMutationHistory(db, cook.id)).toMatchObject([
      {
        id: applied.changeSetId,
        agentName: "Pantry helper",
        hostName: "Kitchen terminal",
        reason: "Put away the grocery delivery",
        items: [
          {
            ingredientSlug: "onion",
            beforeValue: null,
            afterValue: { ingredientSlug: "onion", location: "fresh" },
            beforeVersion: null,
            afterVersion: "1",
          },
        ],
      },
    ]);
    await expect(
      previewPantryMutationUndo(db, cook.id, applied.changeSetId),
    ).resolves.toMatchObject({ canUndo: true, items: [{ status: "ready" }] });

    const undone = await undoPantryMutation(db, {
      userId: cook.id,
      changeSetId: applied.changeSetId,
      idempotencyKey: "0198f1f0-6666-7666-8666-666666666666",
    });
    expect(undone).toMatchObject({ applied: true, replayed: false });
    const pantry = await authenticatedRequest(cook, "/pantry");
    expect(await json(pantry)).toMatchObject({ stock: {}, revision: "2" });
  });

  it("refuses to undo across a later human pantry edit", async () => {
    const cook = await createUser(
      "Ledger Conflict Cook",
      "ledger-conflict@example.test",
    );
    const applied = await reconcilePantry(db, {
      actor: {
        type: "agent",
        userId: cook.id,
        agentId: "ledger-conflict-agent",
        agentName: "Pantry helper",
        hostId: "ledger-conflict-host",
      },
      capability: "pantry.reconcile",
      reason: "Record the cupboard stock",
      idempotencyKey: "0198f1f0-7777-7777-8777-777777777777",
      changes: [
        {
          ingredientSlug: "onion",
          expectedVersion: null,
          location: "cupboards",
        },
      ],
    });
    const humanEdit = await authenticatedRequest(cook, "/pantry/items/onion", {
      method: "PUT",
      body: { location: "fresh" },
    });
    expect(humanEdit.status).toBe(200);

    await expect(
      previewPantryMutationUndo(db, cook.id, applied.changeSetId),
    ).resolves.toMatchObject({ canUndo: false, items: [{ status: "conflict" }] });
    await expect(
      undoPantryMutation(db, {
        userId: cook.id,
        changeSetId: applied.changeSetId,
        idempotencyKey: "0198f1f0-8888-7888-8888-888888888888",
      }),
    ).resolves.toMatchObject({ applied: false });
    const pantry = await authenticatedRequest(cook, "/pantry");
    expect(await json(pantry)).toMatchObject({ stock: { onion: "fresh" } });
  });

  it("invalidates an agent addition after a human deletes it", async () => {
    const cook = await createUser(
      "Ledger Delete Cook",
      "ledger-delete@example.test",
    );
    const applied = await reconcilePantry(db, {
      actor: {
        type: "agent",
        userId: cook.id,
        agentId: "ledger-delete-agent",
        agentName: "Pantry helper",
        hostId: "ledger-delete-host",
      },
      capability: "pantry.reconcile",
      reason: "Record the fresh stock",
      idempotencyKey: "0198f1f0-9999-7999-8999-999999999999",
      changes: [
        {
          ingredientSlug: "onion",
          expectedVersion: null,
          location: "fresh",
        },
      ],
    });
    const humanDelete = await authenticatedRequest(
      cook,
      "/pantry/items/onion",
      { method: "DELETE" },
    );
    expect(humanDelete.status).toBe(200);

    await expect(
      previewPantryMutationUndo(db, cook.id, applied.changeSetId),
    ).resolves.toMatchObject({ canUndo: false, items: [{ status: "conflict" }] });
    await expect(
      undoPantryMutation(db, {
        userId: cook.id,
        changeSetId: applied.changeSetId,
        idempotencyKey: "0198f1f0-aaaa-7aaa-8aaa-aaaaaaaaaaaa",
      }),
    ).resolves.toMatchObject({ applied: false });
  });

  it("purges the mutation ledger when its actor deletes their account", async () => {
    const cook = await createUser(
      "Ledger Deletion Cook",
      "ledger-account-delete@example.test",
    );
    const applied = await reconcilePantry(db, {
      actor: {
        type: "agent",
        userId: cook.id,
        agentId: "account-delete-agent",
        agentName: "Pantry helper",
        hostId: "account-delete-host",
      },
      capability: "pantry.reconcile",
      reason: "Record stock before account deletion",
      idempotencyKey: "0198f1f0-bbbb-7bbb-8bbb-bbbbbbbbbbbb",
      changes: [
        {
          ingredientSlug: "onion",
          expectedVersion: null,
          location: "fresh",
        },
      ],
    });
    const undone = await undoPantryMutation(db, {
      userId: cook.id,
      changeSetId: applied.changeSetId,
      idempotencyKey: "0198f1f0-cccc-7ccc-8ccc-cccccccccccc",
    });
    if (!undone?.changeSetId) throw new Error("Mutation could not be undone");

    const deletion = await authenticatedRequest(cook, "/api/auth/delete-user", {
      method: "POST",
      body: { password },
    });
    expect(deletion.status).toBe(200);
    expect(
      await db
        .select()
        .from(schema.agentMutationChangeSet)
        .where(eq(schema.agentMutationChangeSet.actorUserId, cook.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.agentMutationChangeItem)
        .where(eq(schema.agentMutationChangeItem.changeSetId, applied.changeSetId)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.pantryItemAbsence)
        .where(eq(schema.pantryItemAbsence.changeSetId, undone.changeSetId)),
    ).toHaveLength(0);
  });

  it("resolves pantry ownership again when an agent reads it", async () => {
    const cook = await createUser(
      "Delegated Pantry Cook",
      "delegated-pantry@example.test",
    );
    const session = delegatedAgentSession(cook);
    const personalWrite = await authenticatedRequest(
      cook,
      "/pantry/items/onion",
      {
        method: "PUT",
        body: { location: "fresh" },
      },
    );
    expect(personalWrite.status).toBe(200);

    await expect(
      executeRecipeAgentCapability(db, "pantry.read", {}, session),
    ).resolves.toEqual({
      resourceId: cook.id,
      scope: "personal",
      revision: "1",
      stock: { onion: "fresh" },
      itemVersions: { onion: "1" },
    });

    const householdResponse = await authenticatedRequest(cook, "/households", {
      method: "POST",
      body: { name: "Delegated Pantry Household" },
    });
    expect(householdResponse.status).toBe(201);
    const household = await json<{ id: string }>(householdResponse);

    await expect(
      executeRecipeAgentCapability(db, "pantry.read", {}, session),
    ).resolves.toEqual({
      resourceId: household.id,
      scope: "household",
      revision: "1",
      stock: { onion: "fresh" },
      itemVersions: { onion: "1" },
    });
  });

  it("executes pantry reconciliation as a separately attributed capability", async () => {
    const cook = await createUser(
      "Delegated Pantry Writer",
      "delegated-pantry-writer@example.test",
    );
    const input = {
      idempotencyKey: "0199a770-5111-7111-8111-111111111111",
      reason: "Put away the onions",
      changes: [
        {
          ingredientSlug: "onion",
          expectedVersion: null,
          location: "fresh",
        },
      ],
    };
    const applied = await executeRecipeAgentCapability(
      db,
      "pantry.reconcile",
      input,
      delegatedAgentSession(cook),
    );
    expect(applied).toMatchObject({
      replayed: false,
      pantry: { resourceId: cook.id, scope: "personal" },
      undoPreview: { canUndo: true },
    });
    await expect(
      executeRecipeAgentCapability(
        db,
        "pantry.reconcile",
        input,
        delegatedAgentSession(cook),
      ),
    ).resolves.toMatchObject({ replayed: true });
  });

  it("appends cook events idempotently and compensates only safe rows", async () => {
    const cook = await createUser(
      "Delegated Cook Log Cook",
      "delegated-cook-log@example.test",
    );
    const session = delegatedAgentSession(cook);
    const firstSessionId = "0199a770-6111-7111-8111-111111111111";
    const secondSessionId = "0199a770-6222-7222-8222-222222222222";
    const input = {
      idempotencyKey: "0199a770-6333-7333-8333-333333333333",
      reason: "Record a shared dinner",
      events: [
        {
          sessionId: firstSessionId,
          recipeSlug: "tomato-soup",
          recipeTitle: "Tomato Soup",
          servings: 2,
          diners: ["Alex", "Sam"],
          cookedAt: "2026-09-27T18:30:00.000Z",
        },
        {
          sessionId: secondSessionId,
          recipeSlug: "lentil-soup",
          recipeTitle: "Lentil Soup",
          servings: 4,
          diners: ["Alex", "Sam", "Jo"],
          cookedAt: "2026-09-26T18:30:00.000Z",
        },
      ],
    };
    const applied = await executeRecipeAgentCapability(
      db,
      "cook_log.append",
      input,
      session,
    );
    if (!("changeSetId" in applied)) throw new Error("Cook log was not appended");
    expect(applied).toMatchObject({
      replayed: false,
      undoPreview: { canUndo: true },
    });
    await expect(
      executeRecipeAgentCapability(db, "cook_log.append", input, session),
    ).resolves.toMatchObject({
      changeSetId: applied.changeSetId,
      replayed: true,
    });

    await db
      .update(schema.cookingSession)
      .set({ recipeTitle: "Human correction", version: 2n })
      .where(eq(schema.cookingSession.id, secondSessionId));
    await expect(
      undoCookLogMutation(db, {
        userId: cook.id,
        changeSetId: applied.changeSetId,
        idempotencyKey: "0199a770-6444-7444-8444-444444444444",
      }),
    ).resolves.toMatchObject({ applied: false });
    await expect(
      undoCookLogMutation(db, {
        userId: cook.id,
        changeSetId: applied.changeSetId,
        idempotencyKey: "0199a770-6555-7555-8555-555555555555",
        sessionIds: [firstSessionId],
      }),
    ).resolves.toMatchObject({ applied: true, replayed: false });

    const remaining = await db
      .select()
      .from(schema.cookingSession)
      .where(eq(schema.cookingSession.userId, cook.id));
    expect(remaining).toMatchObject([
      { id: secondSessionId, recipeTitle: "Human correction", version: 2n },
    ]);
    const historyResponse = await authenticatedRequest(
      cook,
      "/api/profile/agent-mutations",
    );
    expect(historyResponse.status).toBe(200);
    await expect(json<{ items: unknown[] }>(historyResponse)).resolves.toMatchObject({
      items: [
        { targetType: "cook_log", compensatesChangeSetId: applied.changeSetId },
        { id: applied.changeSetId, capability: "cook_log.append" },
      ],
    });
  });

  it("limits recipe dataset inspection to recipes visible to the agent's user", async () => {
    const cook = await createUser(
      "Dataset Inspection Cook",
      "dataset-inspection@example.test",
    );
    const otherCook = await createUser(
      "Dataset Inspection Other Cook",
      "dataset-inspection-other@example.test",
    );
    await db.insert(schema.recipe).values([
      {
        slug: "dataset-owned-private",
        title: "Dataset Owned Private",
        body: savedRecipeBody(
          "dataset-owned-private",
          "Dataset Owned Private",
        ),
        userId: cook.id,
        visibility: "private",
      },
      {
        slug: "dataset-other-public",
        title: "Dataset Other Public",
        body: savedRecipeBody(
          "dataset-other-public",
          "Dataset Other Public",
        ),
        userId: otherCook.id,
        visibility: "public",
      },
      {
        slug: "dataset-other-private",
        title: "Dataset Other Private",
        body: savedRecipeBody(
          "dataset-other-private",
          "Dataset Other Private",
        ),
        userId: otherCook.id,
        visibility: "private",
      },
    ]);

    const result = await executeRecipeAgentCapability(
      db,
      "recipes.dataset.inspect",
      { sampleSize: 10, top: 5 },
      delegatedAgentSession(cook),
    );

    expect(result).toMatchObject({
      population: {
        visibleRecipes: 2,
        sampledRecipes: 2,
        truncated: false,
      },
      visibility: { public: 1, household: 0, private: 1 },
      sample: {
        parseQuality: { validPayloads: 2, invalidPayloads: 0 },
      },
    });
  });

  it("combines household and followed-cook activity in the following feed", async () => {
    const viewer = await createUser(
      "Following Viewer",
      "following-viewer@example.test",
    );
    const householdCook = await createUser(
      "Household Cook",
      "household-cook@example.test",
    );
    const followedCook = await createUser(
      "Followed Cook",
      "followed-cook@example.test",
    );
    const unfollowedCook = await createUser(
      "Unfollowed Cook",
      "unfollowed-cook@example.test",
    );
    const householdId = "integration-following-household";
    await db.insert(schema.organization).values({
      id: householdId,
      name: "Following household",
      slug: householdId,
    });
    await db.insert(schema.member).values([
      {
        id: "integration-following-viewer-member",
        organizationId: householdId,
        userId: viewer.id,
        role: "owner",
      },
      {
        id: "integration-following-cook-member",
        organizationId: householdId,
        userId: householdCook.id,
      },
    ]);
    await db.insert(schema.recipe).values([
      {
        slug: "integration-household-stew",
        title: "Integration Household Stew",
        userId: householdCook.id,
        visibility: "household",
        createdAt: new Date("2026-07-31T03:00:00.000Z"),
      },
      {
        slug: "integration-followed-soup",
        title: "Integration Followed Soup",
        userId: followedCook.id,
        visibility: "public",
        createdAt: new Date("2026-07-31T02:00:00.000Z"),
      },
      {
        slug: "integration-unfollowed-pasta",
        title: "Integration Unfollowed Pasta",
        userId: unfollowedCook.id,
        visibility: "public",
        createdAt: new Date("2026-07-31T01:00:00.000Z"),
      },
    ]);

    const followResponse = await authenticatedRequest(
      viewer,
      `/recipes/cooks/${followedCook.id}/follow`,
      { method: "PUT" },
    );
    expect(followResponse.status).toBe(200);
    expect(await json(followResponse)).toEqual({
      following: true,
      canFollow: true,
    });

    const reciprocalFollowResponse = await authenticatedRequest(
      followedCook,
      `/recipes/cooks/${viewer.id}/follow`,
      { method: "PUT" },
    );
    expect(reciprocalFollowResponse.status).toBe(200);

    const profileResponse = await app.request(
      `/recipes/cooks?cook=${followedCook.id}`,
      {},
      baseEnv,
    );
    expect(profileResponse.status).toBe(200);
    expect(await json(profileResponse)).toMatchObject({
      cook: {
        followersCount: 1,
        followingCount: 1,
        followers: [
          { id: viewer.id, name: "Following Viewer", image: null },
        ],
        following: [
          { id: viewer.id, name: "Following Viewer", image: null },
        ],
      },
    });

    const ownConnectionsResponse = await authenticatedRequest(
      viewer,
      "/recipes/cooks/me/connections",
    );
    expect(ownConnectionsResponse.status).toBe(200);
    expect(await json(ownConnectionsResponse)).toEqual({
      followersCount: 1,
      followingCount: 1,
      followers: [{ id: followedCook.id, name: "Followed Cook", image: null }],
      following: [{ id: followedCook.id, name: "Followed Cook", image: null }],
    });

    const feedResponse = await authenticatedRequest(
      viewer,
      "/recipes/discover/feed?scope=following",
    );
    expect(feedResponse.status).toBe(200);
    const feed = await json<{
      items: Array<{ author: { id: string }; recipe: { slug: string } }>;
    }>(feedResponse);
    expect(feed.items.map((item) => item.recipe.slug)).toEqual([
      "integration-household-stew",
      "integration-followed-soup",
    ]);
    expect(feed.items.map((item) => item.author.id)).toEqual([
      householdCook.id,
      followedCook.id,
    ]);
  });

  it("persists recipe CRUD and cascades a deleted user aggregate", async () => {
    const cook = await createUser("Recipe Cook", "recipe-cook@example.test");

    const boxResponse = await authenticatedRequest(cook, "/api/profile/recipe-box", {
      method: "PUT",
      body: { recipeSlugs: ["breakfast-flatbreads"] },
    });
    expect(boxResponse.status).toBe(200);

    const createResponse = await authenticatedRequest(cook, "/recipes", {
      method: "POST",
      body: {
        slug: "integration-stew",
        title: "Integration Stew",
        description: "Created through the real API and database.",
        body: savedRecipeBody("integration-stew", "Integration Stew"),
        visibility: "private",
      },
    });
    expect(createResponse.status).toBe(201);

    const getResponse = await authenticatedRequest(
      cook,
      "/recipes/integration-stew",
    );
    expect(getResponse.status).toBe(200);
    expect(await json<{ title: string }>(getResponse)).toMatchObject({
      title: "Integration Stew",
    });

    const patchResponse = await authenticatedRequest(
      cook,
      "/recipes/integration-stew",
      {
        method: "PATCH",
        body: { title: "Updated Integration Stew" },
      },
    );
    expect(patchResponse.status).toBe(200);
    expect(await json<{ title: string }>(patchResponse)).toMatchObject({
      title: "Updated Integration Stew",
    });

    const deleteResponse = await authenticatedRequest(
      cook,
      "/recipes/integration-stew",
      { method: "DELETE" },
    );
    expect(deleteResponse.status).toBe(204);

    const retainedResponse = await authenticatedRequest(cook, "/recipes", {
      method: "POST",
      body: {
        slug: "cascade-soup",
        title: "Cascade Soup",
        body: savedRecipeBody("cascade-soup", "Cascade Soup"),
        visibility: "private",
      },
    });
    expect(retainedResponse.status).toBe(201);

    const cookingSession = {
      sessionId: "2f64837b-3f3e-4c18-ae39-35df6808dc6c",
      recipeSlug: "cascade-soup",
      recipeTitle: "Cascade Soup",
      servings: 4,
    };
    const cookingStartedResponse = await authenticatedRequest(
      cook,
      "/api/profile/cooking-sessions",
      {
        method: "POST",
        body: { ...cookingSession, event: "started" },
      },
    );
    expect(cookingStartedResponse.status).toBe(201);

    const startedInsightsResponse = await authenticatedRequest(
      cook,
      "/api/profile/cooking-insights",
    );
    expect(startedInsightsResponse.status).toBe(200);
    expect(await startedInsightsResponse.json()).toMatchObject({
      cookModeStarts: 1,
      mealsCooked: 0,
      distinctRecipesCooked: 0,
      recent: [],
    });

    const cookingCompletedResponse = await authenticatedRequest(
      cook,
      "/api/profile/cooking-sessions",
      {
        method: "POST",
        body: { ...cookingSession, event: "completed" },
      },
    );
    expect(cookingCompletedResponse.status).toBe(200);

    const completedInsightsResponse = await authenticatedRequest(
      cook,
      "/api/profile/cooking-insights",
    );
    expect(completedInsightsResponse.status).toBe(200);
    expect(await completedInsightsResponse.json()).toMatchObject({
      cookModeStarts: 1,
      mealsCooked: 1,
      distinctRecipesCooked: 1,
      recent: [
        expect.objectContaining({
          recipeSlug: "cascade-soup",
          recipeTitle: "Cascade Soup",
          servings: 4,
        }),
      ],
    });

    await db.delete(schema.user).where(eq(schema.user.id, cook.id));

    expect(
      await db.select().from(schema.account).where(eq(schema.account.userId, cook.id)),
    ).toHaveLength(0);
    expect(
      await db.select().from(schema.session).where(eq(schema.session.userId, cook.id)),
    ).toHaveLength(0);
    expect(
      await db.select().from(schema.userEmail).where(eq(schema.userEmail.userId, cook.id)),
    ).toHaveLength(0);
    expect(
      await db.select().from(schema.recipe).where(eq(schema.recipe.userId, cook.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.userRecipeBox)
        .where(eq(schema.userRecipeBox.userId, cook.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.userRecipeBoxItem)
        .where(eq(schema.userRecipeBoxItem.userId, cook.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.cookingSession)
        .where(eq(schema.cookingSession.userId, cook.id)),
    ).toHaveLength(0);
  });

  it("scopes and paginates delegated cooking-log reads", async () => {
    const cook = await createUser("History Cook", "history-cook@example.test");
    const otherCook = await createUser(
      "Other History Cook",
      "other-history-cook@example.test",
    );
    await db.insert(schema.cookingSession).values([
      {
        id: "2f64837b-3f3e-4c18-ae39-35df6808dc61",
        userId: cook.id,
        recipeSlug: "older-soup",
        recipeTitle: "Older Soup",
        servings: 2,
        startedAt: new Date("2026-08-19T17:00:00.000Z"),
        completedAt: new Date("2026-08-19T18:00:00.000Z"),
      },
      {
        id: "2f64837b-3f3e-4c18-ae39-35df6808dc62",
        userId: cook.id,
        recipeSlug: "newer-stew",
        recipeTitle: "Newer Stew",
        servings: 4,
        startedAt: new Date("2026-08-20T17:00:00.000Z"),
        completedAt: new Date("2026-08-20T18:00:00.000Z"),
      },
      {
        id: "2f64837b-3f3e-4c18-ae39-35df6808dc63",
        userId: otherCook.id,
        recipeSlug: "private-pasta",
        recipeTitle: "Private Pasta",
        servings: 8,
        startedAt: new Date("2026-08-21T17:00:00.000Z"),
        completedAt: new Date("2026-08-21T18:00:00.000Z"),
      },
    ]);

    const range = {
      from: new Date("2026-08-01T00:00:00.000Z"),
      to: new Date("2026-08-31T23:59:59.999Z"),
      limit: 1,
    };
    const firstPage = await cookingLogResponse(db, cook.id, range);

    expect(firstPage.items).toMatchObject([
      {
        id: "2f64837b-3f3e-4c18-ae39-35df6808dc62",
        recipeSlug: "newer-stew",
      },
    ]);
    expect(firstPage.nextCursor).not.toBeNull();

    const secondPage = await cookingLogResponse(db, cook.id, {
      ...range,
      cursor: decodeCookingLogCursor(firstPage.nextCursor ?? undefined),
    });
    expect(secondPage).toMatchObject({
      items: [
        {
          id: "2f64837b-3f3e-4c18-ae39-35df6808dc61",
          recipeSlug: "older-soup",
        },
      ],
      nextCursor: null,
    });
  });

  it("delivers shared-list notifications only to the selected household member", async () => {
    const owner = await createUser("List Owner", "owner@example.test");
    const recipient = await createUser("List Recipient", "recipient@example.test");
    const householdId = "integration-shopping-household";
    await db.insert(schema.organization).values({
      id: householdId,
      name: "Shopping household",
      slug: householdId,
    });
    await db.insert(schema.member).values([
      {
        id: "shopping-owner",
        organizationId: householdId,
        userId: owner.id,
        role: "owner",
      },
      {
        id: "shopping-recipient",
        organizationId: householdId,
        userId: recipient.id,
      },
    ]);
    const response = await authenticatedRequest(
      owner,
      "/shopping-lists/current/shares",
      { method: "POST", body: { recipientUserId: recipient.id } },
    );
    expect(response.status).toBe(201);
    const notifications = await authenticatedRequest(recipient, "/notifications");
    expect(notifications.status).toBe(200);
    expect(await notifications.json()).toMatchObject({
      unreadCount: 1,
      items: [
        {
          kind: "shopping_list_shared",
          actor: { id: owner.id, name: "List Owner" },
          actions: [],
          detail: {
            type: "household",
            household: { id: householdId, name: "Shopping household" },
          },
        },
      ],
    });
    const ownerNotifications = await authenticatedRequest(owner, "/notifications");
    expect(await ownerNotifications.json()).toMatchObject({
      unreadCount: 0,
      items: [],
    });
  });

  it("persists household membership and preserves notification snapshots", async () => {
    const owner = await createUser("Household Owner", "owner@example.test");
    const invitee = await createUser("Household Member", "member@example.test");

    const ownerPantryResponse = await authenticatedRequest(owner, "/pantry", {
      method: "PUT",
      body: { stock: { onion: "fresh" } },
    });
    expect(ownerPantryResponse.status).toBe(200);

    const householdResponse = await authenticatedRequest(owner, "/households", {
      method: "POST",
      body: { name: "Integration Household" },
    });
    expect(householdResponse.status).toBe(201);
    const household = await json<{ id: string }>(householdResponse);

    const invitationResponse = await authenticatedRequest(
      owner,
      `/households/${household.id}/invitations`,
      { method: "POST", body: { email: invitee.email } },
    );
    expect(invitationResponse.status).toBe(201);
    const invitation = await json<{ id: string }>(invitationResponse);

    const [invitedEvent] = await db
      .select({ id: schema.notificationEvent.id })
      .from(schema.notificationEvent)
      .innerJoin(
        schema.notificationHouseholdInvitationEvent,
        eq(
          schema.notificationHouseholdInvitationEvent.eventId,
          schema.notificationEvent.id,
        ),
      )
      .where(
        and(
          eq(schema.notificationEvent.kind, "household_invited"),
          eq(
            schema.notificationHouseholdInvitationEvent.invitationId,
            invitation.id,
          ),
        ),
      )
      .limit(1);
    expect(invitedEvent).toBeDefined();

    const inviteePantryResponse = await authenticatedRequest(
      invitee,
      "/pantry",
      {
        method: "PUT",
        body: { stock: { salt: "cupboards" } },
      },
    );
    expect(inviteePantryResponse.status).toBe(200);

    const blockedAcceptResponse = await authenticatedRequest(
      invitee,
      `/households/invitations/${invitation.id}/accept`,
      { method: "POST" },
    );
    expect(blockedAcceptResponse.status).toBe(409);
    expect(await json<{ error: string }>(blockedAcceptResponse)).toEqual({
      error: "Pantry must be empty before joining a household",
    });

    const clearedPantryResponse = await authenticatedRequest(
      invitee,
      "/pantry",
      {
        method: "PUT",
        body: { stock: {} },
      },
    );
    expect(clearedPantryResponse.status).toBe(200);

    const acceptResponse = await authenticatedRequest(
      invitee,
      `/households/invitations/${invitation.id}/accept`,
      { method: "POST" },
    );
    expect(acceptResponse.status).toBe(200);
    expect(
      await json<{ membershipCreated: boolean }>(acceptResponse),
    ).toMatchObject({ membershipCreated: true });

    const sharedOperationId = "0198f1f0-2222-7222-8222-222222222222";
    const sharedPantryUpdate = await authenticatedRequest(
      invitee,
      "/pantry/items/salt",
      {
        method: "PUT",
        body: { location: "cupboards" },
        operationId: sharedOperationId,
      },
    );
    expect(sharedPantryUpdate.status).toBe(200);
    const duplicateSharedPantryUpdate = await authenticatedRequest(
      invitee,
      "/pantry/items/salt",
      {
        method: "PUT",
        body: { location: "cupboards" },
        operationId: sharedOperationId,
      },
    );
    expect(await json(duplicateSharedPantryUpdate)).toEqual(
      await json(sharedPantryUpdate),
    );
    const conflictingSharedPantryUpdate = await authenticatedRequest(
      invitee,
      "/pantry/items/salt",
      {
        method: "PUT",
        body: { location: "fresh" },
        operationId: sharedOperationId,
      },
    );
    expect(conflictingSharedPantryUpdate.status).toBe(409);

    const sharedPantry = await authenticatedRequest(owner, "/pantry");
    expect(await json(sharedPantry)).toEqual({
      resourceId: household.id,
      revision: "2",
      scope: {
        type: "household",
        household: {
          id: household.id,
          name: "Integration Household",
        },
      },
      stock: { onion: "fresh", salt: "cupboards" },
      itemVersions: { onion: "1", salt: "1" },
    });

    const clearSharedPantry = await authenticatedRequest(invitee, "/pantry", {
      method: "PUT",
      body: { stock: {} },
    });
    expect(clearSharedPantry.status).toBe(200);
    const concurrentAddition = await authenticatedRequest(
      owner,
      "/pantry/items/almond-milk",
      {
        method: "PUT",
        body: { location: "fridge" },
      },
    );
    expect(concurrentAddition.status).toBe(200);
    const restoredPantry = await authenticatedRequest(
      invitee,
      "/pantry",
      {
        method: "PATCH",
        body: {
          stock: {
            onion: "fresh",
            salt: "cupboards",
            "almond-milk": "cupboards",
          },
        },
      },
    );
    expect(restoredPantry.status).toBe(200);
    expect(await json(restoredPantry)).toEqual({
      resourceId: household.id,
      revision: "5",
      operationId: expect.any(String),
      scope: {
        type: "household",
        household: {
          id: household.id,
          name: "Integration Household",
        },
      },
      stock: {
        "almond-milk": "fridge",
        onion: "fresh",
        salt: "cupboards",
      },
      itemVersions: {
        "almond-milk": "1",
        onion: "1",
        salt: "1",
      },
    });

    const recipeResponse = await authenticatedRequest(invitee, "/recipes", {
      method: "POST",
      body: {
        slug: "shared-casserole",
        title: "Shared Casserole",
        body: savedRecipeBody("shared-casserole", "Shared Casserole"),
        visibility: "household",
      },
    });
    expect(recipeResponse.status).toBe(201);

    // Defensively simulate a stale personal duplicate. Household stock remains
    // authoritative when the owner carries it forward during deletion.
    await db.insert(schema.pantryItem).values({
      userId: owner.id,
      ingredientSlug: "onion",
      location: "cupboards",
    });

    const deleteResponse = await authenticatedRequest(
      owner,
      `/households/${household.id}`,
      { method: "DELETE" },
    );
    expect(deleteResponse.status).toBe(204);

    const inheritedPantry = await authenticatedRequest(owner, "/pantry");
    expect(await json(inheritedPantry)).toEqual({
      resourceId: owner.id,
      revision: "5",
      scope: { type: "personal" },
      stock: {
        "almond-milk": "fridge",
        onion: "fresh",
        salt: "cupboards",
      },
      itemVersions: {
        "almond-milk": "1",
        onion: "1",
        salt: "1",
      },
    });

    expect(
      await db
        .select()
        .from(schema.organization)
        .where(eq(schema.organization.id, household.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.member)
        .where(eq(schema.member.organizationId, household.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.invitation)
        .where(eq(schema.invitation.id, invitation.id)),
    ).toHaveLength(0);

    const [privateRecipe] = await db
      .select({ visibility: schema.recipe.visibility })
      .from(schema.recipe)
      .where(eq(schema.recipe.slug, "shared-casserole"));
    expect(privateRecipe?.visibility).toBe("private");

    if (!invitedEvent) throw new Error("Invitation event was not created");
    const [householdSnapshot] = await db
      .select()
      .from(schema.notificationHouseholdEvent)
      .where(eq(schema.notificationHouseholdEvent.eventId, invitedEvent.id));
    const [invitationSnapshot] = await db
      .select()
      .from(schema.notificationHouseholdInvitationEvent)
      .where(
        eq(schema.notificationHouseholdInvitationEvent.eventId, invitedEvent.id),
      );
    expect(householdSnapshot).toMatchObject({
      householdId: null,
      householdNameSnapshot: "Integration Household",
    });
    expect(invitationSnapshot?.invitationId).toBeNull();

    const retainedDeliveries = await db
      .select({ recipientUserId: schema.notificationDelivery.recipientUserId })
      .from(schema.notificationDelivery)
      .where(eq(schema.notificationDelivery.eventId, invitedEvent.id));
    expect(retainedDeliveries).toEqual([{ recipientUserId: invitee.id }]);

    const [deletedEvent] = await db
      .select({ id: schema.notificationEvent.id })
      .from(schema.notificationEvent)
      .innerJoin(
        schema.notificationDelivery,
        eq(schema.notificationDelivery.eventId, schema.notificationEvent.id),
      )
      .where(
        and(
          eq(schema.notificationEvent.kind, "household_deleted"),
          eq(schema.notificationDelivery.recipientUserId, invitee.id),
        ),
      )
      .limit(1);
    expect(deletedEvent).toBeDefined();
    if (!deletedEvent) throw new Error("Household deletion event was not created");

    const [deletedSnapshot] = await db
      .select()
      .from(schema.notificationHouseholdEvent)
      .where(eq(schema.notificationHouseholdEvent.eventId, deletedEvent.id));
    expect(deletedSnapshot).toMatchObject({
      householdId: null,
      householdNameSnapshot: "Integration Household",
    });

    await db
      .delete(schema.notificationEvent)
      .where(eq(schema.notificationEvent.id, invitedEvent.id));
    expect(
      await db
        .select()
        .from(schema.notificationDelivery)
        .where(eq(schema.notificationDelivery.eventId, invitedEvent.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.notificationHouseholdEvent)
        .where(eq(schema.notificationHouseholdEvent.eventId, invitedEvent.id)),
    ).toHaveLength(0);
  });

  it("recommends a readable recipe and adds it to the recipient recipe box", async () => {
    const owner = await createUser("Recommendation Owner", "rec-owner@example.test");
    const member = await createUser("Recommendation Member", "rec-member@example.test");

    const householdResponse = await authenticatedRequest(owner, "/households", {
      method: "POST",
      body: { name: "Recommendation Household" },
    });
    const household = await json<{ id: string }>(householdResponse);
    const invitationResponse = await authenticatedRequest(
      owner,
      `/households/${household.id}/invitations`,
      { method: "POST", body: { email: member.email } },
    );
    const invitation = await json<{ id: string }>(invitationResponse);
    expect(
      (
        await authenticatedRequest(
          member,
          `/households/invitations/${invitation.id}/accept`,
          { method: "POST" },
        )
      ).status,
    ).toBe(200);

    expect(
      (
        await authenticatedRequest(owner, "/recipes", {
          method: "POST",
          body: {
            slug: "recommended-stew",
            title: "Recommended Stew",
            body: savedRecipeBody("recommended-stew", "Recommended Stew"),
            visibility: "household",
          },
        })
      ).status,
    ).toBe(201);
    const recommendationResponse = await authenticatedRequest(
      owner,
      "/recipes/recommended-stew/recommendations",
      { method: "POST", body: { recipientUserId: member.id } },
    );
    expect(recommendationResponse.status).toBe(201);

    const notificationsResponse = await authenticatedRequest(
      member,
      "/notifications",
    );
    const notifications = await json<{
      items: Array<{
        actions: string[];
        detail: {
          recipe: { slug: string; title: string };
          saved: boolean;
          type: string;
        };
        id: string;
        kind: string;
      }>;
    }>(notificationsResponse);
    const recommendation = notifications.items.find(
      ({ kind }) => kind === "recipe_recommended",
    );
    expect(recommendation).toMatchObject({
      actions: ["add_to_recipe_box"],
      detail: {
        type: "recipe_recommendation",
        recipe: {
          slug: "recommended-stew",
          title: "Recommended Stew",
        },
        saved: false,
      },
    });
    if (!recommendation) throw new Error("Recommendation was not delivered");

    const addResponse = await authenticatedRequest(
      member,
      `/notifications/${recommendation.id}/actions/add_to_recipe_box`,
      { method: "POST" },
    );
    expect(addResponse.status).toBe(200);
    expect(
      await json<{ item: { actions: string[]; detail: { saved: boolean } } }>(
        addResponse,
      ),
    ).toMatchObject({
      item: { actions: [], detail: { saved: true } },
    });
    expect(
      await json<{ recipeSlugs: string[] }>(
        await authenticatedRequest(member, "/api/profile/recipe-box"),
      ),
    ).toMatchObject({ recipeSlugs: ["recommended-stew"] });
  });

  it("allows edge replacement and rejects cycles in the group hierarchy", async () => {
    try {
      const reversed = await client<
        {
          broaderGroupKey: string;
          narrowerGroupKey: string;
          relationType: string;
        }[]
      >`
        update ingredient_group_hierarchy
        set
          narrower_group_key = 'poultry',
          broader_group_key = 'chicken'
        where
          narrower_group_key = 'chicken'
          and broader_group_key = 'poultry'
        returning
          narrower_group_key as "narrowerGroupKey",
          broader_group_key as "broaderGroupKey",
          relation_type as "relationType"
      `;
      expect(reversed).toEqual([
        {
          narrowerGroupKey: "poultry",
          broaderGroupKey: "chicken",
          relationType: "classification",
        },
      ]);
      await expect(
        client`
          insert into ingredient_group_hierarchy (
            narrower_group_key,
            broader_group_key,
            relation_type
          ) values ('chicken', 'poultry', 'classification')
        `,
      ).rejects.toMatchObject({ code: "23514" });
    } finally {
      await client`
        update ingredient_group_hierarchy
        set
          narrower_group_key = 'chicken',
          broader_group_key = 'poultry'
        where
          narrower_group_key = 'poultry'
          and broader_group_key = 'chicken'
      `;
    }
  });

  it("serializes concurrent opposing hierarchy edges", async () => {
    const inserts = await Promise.allSettled([
      client`
        insert into ingredient_group_hierarchy (
          narrower_group_key,
          broader_group_key,
          relation_type
        ) values ('dairy', 'gluten', 'classification')
      `,
      client`
        insert into ingredient_group_hierarchy (
          narrower_group_key,
          broader_group_key,
          relation_type
        ) values ('gluten', 'dairy', 'classification')
      `,
    ]);

    try {
      expect(
        inserts.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      const rejected = inserts.find((result) => result.status === "rejected");
      expect(rejected?.reason).toMatchObject({ code: "23514" });

      const storedEdges = await client`
        select narrower_group_key, broader_group_key
        from ingredient_group_hierarchy
        where
          (narrower_group_key = 'dairy' and broader_group_key = 'gluten')
          or (narrower_group_key = 'gluten' and broader_group_key = 'dairy')
      `;
      expect(storedEdges).toHaveLength(1);
    } finally {
      await client`
        delete from ingredient_group_hierarchy
        where
          (narrower_group_key = 'dairy' and broader_group_key = 'gluten')
          or (narrower_group_key = 'gluten' and broader_group_key = 'dairy')
      `;
    }
  });

  it("does not inherit diet ingredients across composition relationships", async () => {
    const cook = await createUser("Relation Cook", "relation-cook@example.test");

    try {
      await client`
        insert into ingredient_group_hierarchy (
          narrower_group_key,
          broader_group_key,
          relation_type
        ) values
          ('stock', 'poultry', 'composition'),
          ('stock', 'meat', 'composition')
      `;

      const response = await authenticatedRequest(
        cook,
        "/api/profile/diet/options",
      );
      expect(response.status).toBe(200);
      const options = (await response.json()) as {
        groups: Array<{
          broaderGroupKeys: string[];
          ingredientSlugs: string[];
          key: string;
        }>;
      };

      expect(
        options.groups.find((group) => group.key === "stock")
          ?.broaderGroupKeys,
      ).toEqual([]);
      expect(
        options.groups.find((group) => group.key === "poultry")
          ?.ingredientSlugs,
      ).not.toContain("vegetable-stock");
      expect(
        options.groups.find((group) => group.key === "meat")?.ingredientSlugs,
      ).not.toContain("vegetable-stock");
    } finally {
      await client`
        delete from ingredient_group_hierarchy
        where narrower_group_key = 'stock'
          and broader_group_key in ('poultry', 'meat')
      `;
    }
  });

  it("persists diet settings and cascades an import job graph", async () => {
    const cook = await createUser("Import Cook", "import-cook@example.test");

    const optionsResponse = await authenticatedRequest(
      cook,
      "/api/profile/diet/options",
    );
    expect(optionsResponse.status).toBe(200);
    const options = (await optionsResponse.json()) as {
      groups: Array<{
        ingredientSlugs: string[];
        key: string;
        broaderGroupKeys: string[];
      }>;
      ingredients: Array<{ slug: string }>;
      presets: Array<{
        excludedGroupKeys: string[];
        excludedIngredientSlugs: string[];
        key: string;
      }>;
    };
    expect(options.ingredients.length).toBeGreaterThan(100);
    expect(options.presets.find((preset) => preset.key === "vegan")).toEqual(
      expect.objectContaining({
        excludedGroupKeys: expect.arrayContaining([
          "meat",
          "poultry",
          "fish",
          "shellfish",
          "dairy",
          "egg",
        ]),
        excludedIngredientSlugs: ["honey"],
      }),
    );
    expect(options.presets.map((preset) => preset.key)).toEqual(
      expect.arrayContaining([
        "vegetarian",
        "vegan",
        "pescatarian",
        "dairy-free",
        "gluten-free",
        "low-fodmap",
      ]),
    );
    const wheat = options.groups.find((group) => group.key === "wheat");
    const gluten = options.groups.find((group) => group.key === "gluten");
    expect(
      options.groups.find((group) => group.key === "poultry")
        ?.ingredientSlugs,
    ).toContain("chicken-breast");
    expect(options.groups.find((group) => group.key === "chicken")).toEqual(
      expect.objectContaining({
        broaderGroupKeys: ["poultry"],
        ingredientSlugs: expect.arrayContaining([
          "chicken-breast",
          "chicken-thigh",
          "chicken-stock",
          "chicken-stock-pot",
        ]),
      }),
    );
    expect(
      options.groups.find((group) => group.key === "stock")?.ingredientSlugs,
    ).toEqual(
      expect.arrayContaining([
        "chicken-stock",
        "chicken-stock-pot",
        "vegetable-stock",
      ]),
    );
    expect(
      options.groups.find((group) => group.key === "dairy")?.ingredientSlugs,
    ).not.toContain("coconut-milk");
    expect(
      options.groups.find((group) => group.key === "dairy")?.ingredientSlugs,
    ).toEqual(
      expect.arrayContaining([
        "milk-chocolate",
        "white-chocolate",
        "white-chocolate-chips",
      ]),
    );
    expect(
      options.groups.find((group) => group.key === "onion")?.ingredientSlugs,
    ).toContain("shallots");
    expect(
      options.groups.find((group) => group.key === "garlic")?.ingredientSlugs,
    ).toContain("garlic-powder");
    expect(
      options.groups.find((group) => group.key === "peanut")
        ?.ingredientSlugs,
    ).toContain("crunchy-peanut-butter");
    expect(wheat?.ingredientSlugs).toContain("spaghetti");
    expect(gluten?.ingredientSlugs).toContain("spaghetti");

    const diet = {
      presetDietKeys: ["vegan"],
      excludedIngredientSlugs: ["honey"],
      excludedGroupKeys: ["shellfish"],
      recipeMatchMode: "warn",
    };
    const putDietResponse = await authenticatedRequest(
      cook,
      "/api/profile/diet",
      { method: "PUT", body: diet },
    );
    expect(putDietResponse.status).toBe(200);
    expect(await putDietResponse.json()).toEqual(diet);

    const getDietResponse = await authenticatedRequest(
      cook,
      "/api/profile/diet",
    );
    expect(getDietResponse.status).toBe(200);
    expect(await getDietResponse.json()).toEqual(diet);
    expect(
      await db
        .select()
        .from(schema.userDietPreset)
        .where(eq(schema.userDietPreset.userId, cook.id)),
    ).toEqual([
      expect.objectContaining({ presetKey: "vegan", userId: cook.id }),
    ]);
    expect(
      await db
        .select()
        .from(schema.userDietExcludedIngredient)
        .where(eq(schema.userDietExcludedIngredient.userId, cook.id)),
    ).toEqual([
      expect.objectContaining({ ingredientSlug: "honey", userId: cook.id }),
    ]);
    expect(
      await db
        .select()
        .from(schema.userDietExcludedGroup)
        .where(eq(schema.userDietExcludedGroup.userId, cook.id)),
    ).toEqual([
      expect.objectContaining({ groupKey: "shellfish", userId: cook.id }),
    ]);

    const artifactPut = vi.fn(async () => undefined);
    const workflowCreate = vi.fn(async () => undefined);
    const importEnv: Bindings = {
      ...baseEnv,
      ARTIFACTS: {
        put: artifactPut,
      } as unknown as R2Bucket,
      RECIPE_INGEST_WORKFLOW: {
        create: workflowCreate,
      } as unknown as Workflow,
    };
    const form = new FormData();
    form.append(
      "images",
      new File(
        [
          new Uint8Array([
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
          ]),
        ],
        "recipe.png",
        { type: "image/png" },
      ),
    );
    const importResponse = await app.request(
      "/recipe-imports",
      {
        method: "POST",
        headers: { cookie: cook.cookie, origin: authOrigin },
        body: form,
      },
      importEnv,
      {
        waitUntil: vi.fn(),
      } as unknown as ExecutionContext,
    );
    expect(importResponse.status).toBe(202);
    const importJob = await json<{ id: string }>(importResponse);
    expect(artifactPut).toHaveBeenCalledOnce();
    expect(artifactPut).toHaveBeenCalledWith(
      sourceImageKey(importJob.id, 0, "png"),
      expect.any(File),
      { httpMetadata: { contentType: "image/png" } },
    );
    expect(workflowCreate).toHaveBeenCalledWith({
      id: importJob.id,
      params: { jobId: importJob.id },
    });
    expect(
      await db
        .select({ count: schema.appRateLimit.count })
        .from(schema.appRateLimit)
        .where(eq(schema.appRateLimit.key, `recipe-photo-import:${cook.id}`)),
    ).toEqual([{ count: 1 }]);

    await db.insert(schema.recipeImportArtifact).values({
      jobId: importJob.id,
      stage: "extract",
      kind: "source-manifest",
      r2Key: artifactKey(importJob.id, "extract", "source-manifest.json"),
      checksum: "integration-checksum",
    });
    await db.insert(schema.recipeImportAttempt).values({
      jobId: importJob.id,
      stage: "extract",
      attempt: 1,
      succeeded: true,
    });

    const importStatusResponse = await authenticatedRequest(
      cook,
      `/recipe-imports/${importJob.id}`,
    );
    expect(importStatusResponse.status).toBe(200);
    expect(
      await json<{ artifacts: Array<{ kind: string }> }>(importStatusResponse),
    ).toMatchObject({ artifacts: [{ kind: "source-manifest" }] });

    await db
      .delete(schema.recipeImportJob)
      .where(eq(schema.recipeImportJob.id, importJob.id));
    expect(
      await db
        .select()
        .from(schema.recipeImportArtifact)
        .where(eq(schema.recipeImportArtifact.jobId, importJob.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.recipeImportAttempt)
        .where(eq(schema.recipeImportAttempt.jobId, importJob.id)),
    ).toHaveLength(0);

    await db.delete(schema.user).where(eq(schema.user.id, cook.id));
    expect(
      await db
        .select()
        .from(schema.userDietProfile)
        .where(eq(schema.userDietProfile.userId, cook.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.userDietPreset)
        .where(eq(schema.userDietPreset.userId, cook.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.userDietExcludedIngredient)
        .where(eq(schema.userDietExcludedIngredient.userId, cook.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.userDietExcludedGroup)
        .where(eq(schema.userDietExcludedGroup.userId, cook.id)),
    ).toHaveLength(0);
  });
});

describe("durable recipe batches", () => {
  function batchServices() {
    const objects = new Map<string, string>();
    const put = vi.fn(async (key: string, value: string) => { objects.set(key, value); });
    const create = vi.fn().mockResolvedValue({});
    const status = vi.fn().mockResolvedValue({ status: "queued" });
    const get = vi.fn().mockResolvedValue({ status });
    return { objects, create, get, status, env: { ...baseEnv, ARTIFACTS: { put } as unknown as R2Bucket, RECIPE_INGEST_WORKFLOW: { create, get } as unknown as Workflow } };
  }
  const draft = { title: "Batch salt", description: "A test recipe", source: "Mix the @salt{1%tsp} into the dish.", cuisine: "", servings: 2 };
  function sources() {
    return Array.from({ length: 20 }, (_, index) => index % 2 === 0 ? { type: "url", url: `https://recipes.example.test/${index}` } : { type: "file", filename: `recipe-${index}.cook`, content: `Mix @salt{${index}%tsp}.` });
  }
  async function readyItem(id: string) {
    await db.transaction(tx => insertGeneratedDraft(tx, id, draft));
    await db.update(schema.recipeImportJob).set({ status: "succeeded", reviewState: "ready" }).where(eq(schema.recipeImportJob.id, id));
  }

  function collectionSource(files: Record<string, string> = { "salt.cook": draft.source }) {
    return { type: "archive", filename: "collection.zip", content: Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([path, text]) => [path, strToU8(text)])))).toString("base64") };
  }
  async function acceptItem(cook: TestUser, service: ReturnType<typeof batchServices>, batchId: string, itemId: string, slug: string) {
    await readyItem(itemId);
    const payload = JSON.parse(savedRecipeBody(slug, draft.title));
    payload.recipe.description = draft.description;
    const response = await authenticatedRequest(cook, `/recipe-import-batches/${batchId}/items/${itemId}/acceptance`, { method: "PUT", body: { version: 1, idempotencyKey: crypto.randomUUID(), recipe: { slug, title: draft.title, description: draft.description, body: JSON.stringify(payload), visibility: "private" } }, env: service.env });
    expect(response.status).toBe(200);
    return (await response.json() as { recipeId: string }).recipeId;
  }
  it("reviews collection entries, skips duplicates across imports, and retains provenance after undo", async () => {
    const cook = await createUser("Collection Cook", "collection@example.test");
    const stranger = await createUser("Stranger", "stranger@example.test");
    const service = batchServices();
    const body = { idempotencyKey: crypto.randomUUID(), sources: [collectionSource({ "salt.cook": draft.source, "same.cook": draft.source, "bad.cook": " " })] };
    const response = await authenticatedRequest(cook, "/recipe-import-batches", { method: "POST", body, env: service.env });
    expect(response.status).toBe(201);
    const batch = await response.json() as { id: string; items: { id: string; reviewState: string; archive: { entryPath: string; archiveChecksum: string } }[] };
    expect(batch.items[0]?.archive.entryPath).toBe("salt.cook");
    expect(batch.items[1]?.reviewState).toBe("skipped");
    expect(await db.select().from(schema.recipe)).toHaveLength(0);
    const recipeId = await acceptItem(cook, service, batch.id, batch.items[0]!.id, "collection-salt");
    const duplicate = await authenticatedRequest(cook, "/recipe-import-batches", { method: "POST", body: { idempotencyKey: crypto.randomUUID(), sources: [collectionSource()] }, env: service.env });
    expect((await duplicate.json() as { items: { reviewState: string }[] }).items[0]?.reviewState).toBe("skipped");
    expect((await authenticatedRequest(stranger, `/recipe-import-batches/${batch.id}/undo`, { env: service.env })).status).toBe(404);
    await db.update(schema.recipeImportJob).set({ status: "failed", reviewState: "needs_attention" }).where(eq(schema.recipeImportJob.id, batch.items[2]!.id));
    expect((await previewBatchUndo(db, cook.id, batch.id)).items[0]?.outcome).toBe("eligible");
    const unavailable = await authenticatedRequest(cook, `/recipe-import-batches/${batch.id}/undo`, { method: "PUT", body: { state: "started" }, env: service.env });
    expect(unavailable.status).toBe(503);
    expect((await previewBatchUndo(db, cook.id, batch.id)).state).toBe("preview");
    expect(await db.select().from(schema.recipe)).toHaveLength(1);
    const background: Promise<unknown>[] = [];
    const executionCtx = { waitUntil: (promise: Promise<unknown>) => { background.push(promise); }, passThroughOnException: vi.fn() } as unknown as ExecutionContext;
    const undo = await authenticatedRequest(cook, `/recipe-import-batches/${batch.id}/undo`, { method: "PUT", body: { state: "started" }, env: service.env, executionCtx });
    expect(undo.status).toBe(202);
    expect(background).toHaveLength(1);
    await Promise.all(background);
    await executeBatchUndo(db, cook.id, batch.id);
    expect(await db.select().from(schema.recipe)).toHaveLength(0);
    const [receipt] = await db.select().from(schema.recipeImportJob).where(eq(schema.recipeImportJob.id, batch.items[0]!.id));
    expect(receipt?.acceptedRecipeId).toBeNull();
    expect(receipt?.acceptedRecipeSnapshotId).toBe(recipeId);
    expect(receipt?.undoOutcome).toBe("deleted");
    expect((await previewBatchUndo(db, cook.id, batch.id)).items[0]?.outcome).toBe("deleted");
    expect(await db.select().from(schema.recipeImportArchiveEntry)).toHaveLength(4);
    expect((await authenticatedRequest(cook, `/recipe-import-batches/${batch.id}/items/${batch.items[2]!.id}/acceptance`, { method: "PUT", body: { version: 1, idempotencyKey: crypto.randomUUID(), recipe: { slug: "blocked", title: draft.title, body: savedRecipeBody("blocked", draft.title) } }, env: service.env })).status).toBe(409);
  });
  it("preserves transferred, forked, changed, and cooked recipes and rechecks after preview", async () => {
    const cook = await createUser("Collection Cook", "collection@example.test");
    const other = await createUser("Other Cook", "other@example.test");
    const service = batchServices();
    const response = await authenticatedRequest(cook, "/recipe-import-batches", { method: "POST", body: { idempotencyKey: crypto.randomUUID(), duplicatePolicy: "allow", sources: [collectionSource(Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`${i}.cook`, draft.source])))] }, env: service.env });
    const batch = await response.json() as { id: string; items: { id: string }[] };
    const ids = [];
    for (const [i, item] of batch.items.entries()) ids.push(await acceptItem(cook, service, batch.id, item.id, `collection-${i}`));
    expect((await previewBatchUndo(db, cook.id, batch.id)).items.every(item => item.outcome === "eligible")).toBe(true);
    await db.update(schema.recipe).set({ userId: other.id }).where(eq(schema.recipe.id, ids[0]!));
    const forkBody = { slug: "fork", title: "Fork", body: savedRecipeBody("fork", "Fork"), parentRecipeId: ids[1] };
    expect((await authenticatedRequest(other, "/recipes", { method: "POST", body: forkBody, env: service.env })).status).toBe(404);
    expect((await authenticatedRequest(cook, "/recipes", { method: "POST", body: forkBody, env: service.env })).status).toBe(201);
    expect((await authenticatedRequest(cook, "/recipes/collection-1", { method: "DELETE", env: service.env })).status).toBe(409);
    await db.update(schema.recipe).set({ title: "Edited" }).where(eq(schema.recipe.id, ids[2]!));
    await db.insert(schema.cookingSession).values({ id: crypto.randomUUID(), userId: cook.id, recipeSlug: "collection-3", recipeTitle: draft.title, servings: 2 });
    await beginBatchUndo(db, cook.id, batch.id);
    await executeBatchUndo(db, cook.id, batch.id);
    const results = await previewBatchUndo(db, cook.id, batch.id);
    expect(results.items.map(item => item.outcome)).toEqual(["preserved", "preserved", "preserved", "preserved", "deleted"]);
    expect(await db.select().from(schema.recipe)).toHaveLength(5);
  });

  it("records per-item undo failures and retries without deleting a recipe twice", async () => {
    const cook = await createUser("Collection Cook", "collection@example.test");
    const service = batchServices();
    const response = await authenticatedRequest(cook, "/recipe-import-batches", { method: "POST", body: { idempotencyKey: crypto.randomUUID(), duplicatePolicy: "allow", sources: [collectionSource({ "a.cook": draft.source, "b.cook": draft.source })] }, env: service.env });
    const batch = await response.json() as { id: string; items: { id: string }[] };
    await expect(beginBatchUndo(db, cook.id, batch.id)).rejects.toThrow("Wait for processing");
    for (const [i, item] of batch.items.entries()) await acceptItem(cook, service, batch.id, item.id, `failure-${i}`);
    await beginBatchUndo(db, cook.id, batch.id);
    const transaction = vi.spyOn(db, "transaction").mockRejectedValueOnce(new Error("Temporary database failure"));
    await executeBatchUndo(db, cook.id, batch.id);
    transaction.mockRestore();
    const attempt = await previewBatchUndo(db, cook.id, batch.id);
    expect(attempt.state).toBe("completed");
    expect(attempt.items.map(item => item.outcome)).toEqual(["failed", "deleted"]);
    await beginBatchUndo(db, cook.id, batch.id);
    await executeBatchUndo(db, cook.id, batch.id);
    expect((await previewBatchUndo(db, cook.id, batch.id)).items.map(item => item.outcome)).toEqual(["deleted", "deleted"]);
    expect(await db.select().from(schema.recipe)).toHaveLength(0);
  });

  it("guards duplicates at acceptance and rejects ordinary batches and malformed archives for undo", async () => {
    const cook = await createUser("Collection Cook", "collection@example.test");
    const other = await createUser("Other Cook", "other@example.test");
    const service = batchServices();
    const ids = [];
    for (let i = 0; i < 2; i++) {
      const response = await authenticatedRequest(cook, "/recipe-import-batches", { method: "POST", body: { idempotencyKey: crypto.randomUUID(), sources: [collectionSource()] }, env: service.env });
      ids.push(await response.json() as { id: string; items: { id: string }[] });
    }
    const first = ids[0]!;
    const second = ids[1]!;
    await acceptItem(cook, service, first.id, first.items[0]!.id, "first-copy");
    await readyItem(second.items[0]!.id);
    const payload = JSON.parse(savedRecipeBody("second-copy", draft.title));
    payload.recipe.description = draft.description;
    const acceptance = await authenticatedRequest(cook, `/recipe-import-batches/${second.id}/items/${second.items[0]!.id}/acceptance`, { method: "PUT", body: { version: 1, idempotencyKey: crypto.randomUUID(), recipe: { slug: "second-copy", title: draft.title, description: draft.description, body: JSON.stringify(payload), visibility: "private" } }, env: service.env });
    expect(acceptance.status).toBe(409);
    expect((await authenticatedRequest(other, `/recipe-import-batches/${first.id}/undo`, { method: "PUT", body: { state: "started" }, env: service.env, executionCtx: { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext })).status).toBe(404);
    const ordinary = await authenticatedRequest(cook, "/recipe-import-batches", { method: "POST", body: { idempotencyKey: crypto.randomUUID(), sources: sources().slice(0, 1) }, env: service.env });
    const ordinaryBatch = await ordinary.json() as { id: string };
    expect((await authenticatedRequest(cook, `/recipe-import-batches/${ordinaryBatch.id}/undo`, { env: service.env })).status).toBe(409);
    const oversized = await app.request("/recipe-import-batches", { method: "POST", headers: { "content-type": "application/json", "content-length": "8000001", origin: authOrigin, cookie: cook.cookie }, body: "{}" }, service.env);
    expect(oversized.status).toBe(413);
    const oversizedStream = await app.request("/recipe-import-batches", { method: "POST", headers: { "content-type": "application/json", origin: authOrigin, cookie: cook.cookie }, body: "a".repeat(8_000_001) }, service.env);
    expect(oversizedStream.status).toBe(413);
    const fullCollection = collectionSource(Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`${i}.cook`, draft.source])));
    const tooMany = await authenticatedRequest(cook, "/recipe-import-batches", { method: "POST", body: { idempotencyKey: crypto.randomUUID(), sources: [fullCollection, fullCollection, { type: "archive", filename: "invalid.zip", content: "AAAA" }] }, env: service.env });
    expect(tooMany.status).toBe(400);
    expect(await tooMany.json()).toMatchObject({ error: "A batch can contain at most 50 recipes" });
    const malformed = await authenticatedRequest(cook, "/recipe-import-batches", { method: "POST", body: { idempotencyKey: crypto.randomUUID(), sources: [{ type: "archive", filename: "bad.zip", content: "AAAA" }] }, env: service.env });
    expect(malformed.status).toBe(400);
  });

  it("persists 20 mixed sources once, resumes dispatch, and isolates owners", async () => {
    const cook = await createUser("Batch Cook", "batch@example.test");
    const stranger = await createUser("Other Cook", "other@example.test");
    const service = batchServices();
    const body = { idempotencyKey: crypto.randomUUID(), sources: sources() };
    const response = await authenticatedRequest(cook, "/recipe-import-batches", { method: "POST", body, env: service.env });
    expect(response.status).toBe(201);
    expect(response.headers.get("Location")).toMatch(/\/api\/recipe-import-batches\//);
    const batch = await response.json() as { id: string; items: { id: string; position: number }[] };
    expect(batch.items).toHaveLength(20);
    expect(batch.items.map(item => item.position)).toEqual(Array.from({ length: 20 }, (_, index) => index));
    expect(service.objects.size).toBe(20);
    expect(service.create).not.toHaveBeenCalled();
    const pending = await authenticatedRequest(cook, `/recipe-import-batches/${batch.id}/execution`, { env: service.env });
    expect((await pending.json() as { state: string }).state).toBe("pending");
    expect((await authenticatedRequest(cook, `/recipe-import-batches/${batch.id}/execution`, { method: "PUT", body: { state: "started" }, env: service.env })).status).toBe(200);
    expect(service.create).toHaveBeenCalledTimes(20);
    const replay = await authenticatedRequest(cook, "/recipe-import-batches", { method: "POST", body, env: service.env });
    expect((await replay.json() as { id: string }).id).toBe(batch.id);
    expect(service.objects.size).toBe(20);
    expect(await db.select().from(schema.recipeImportJob)).toHaveLength(20);
    const mismatch = await authenticatedRequest(cook, "/recipe-import-batches", { method: "POST", body: { ...body, sources: body.sources.slice(1) }, env: service.env });
    expect(mismatch.status).toBe(409);
    expect((await authenticatedRequest(stranger, `/recipe-import-batches/${batch.id}`, { env: service.env })).status).toBe(404);
    expect((await authenticatedRequest(cook, `/recipe-import-batches/${batch.id}`, { env: service.env })).status).toBe(200);
    service.create.mockRejectedValueOnce(new Error("dispatch down"));
    service.get.mockRejectedValueOnce(new Error("workflow unavailable"));
    expect((await authenticatedRequest(cook, `/recipe-import-batches/${batch.id}/execution`, { method: "PUT", body: { state: "started" }, env: service.env })).status).toBe(502);
    expect((await authenticatedRequest(cook, `/recipe-import-batches/${batch.id}/execution`, { method: "PUT", body: { state: "started" }, env: service.env })).status).toBe(200);
  });

  it("rejects stale autosaves and accepts a version only once", async () => {
    const cook = await createUser("Batch Cook", "batch@example.test");
    const service = batchServices();
    const response = await authenticatedRequest(cook, "/recipe-import-batches", { method: "POST", body: { idempotencyKey: crypto.randomUUID(), sources: sources().slice(0, 2) }, env: service.env });
    const batch = await response.json() as { id: string; items: { id: string }[] };
    const item = batch.items[0]!;
    await readyItem(item.id);
    const path = `/recipe-import-batches/${batch.id}/items/${item.id}`;
    const edits = { ...draft, title: "Edited salt", cuisine: "Mexican, European", prepTime: 5 };
    const autosaves = await Promise.all([1, 2].map(() => authenticatedRequest(cook, `${path}/draft`, { method: "PUT", body: { version: 1, draft: edits }, env: service.env })));
    expect(autosaves.map(response => response.status).sort()).toEqual([200, 409]);
    const [stored] = await db.select().from(schema.recipeImportJob).where(eq(schema.recipeImportJob.id, item.id));
    expect((await readBatchDrafts(db, [item.id])).get(item.id)?.generatedDraft).toEqual(draft);
    expect(stored?.draftVersion).toBe(2);
    await db.transaction(tx => insertGeneratedDraft(tx, item.id, draft));
    const current = (await readBatchDrafts(db, [item.id])).get(item.id);
    expect(current?.draft).toEqual(edits);
    expect(current?.generatedDraft).toEqual(draft);
    const draftResource = await authenticatedRequest(cook, `${path}/draft`, { env: service.env });
    expect((await draftResource.json() as { draft: unknown }).draft).toEqual(edits);
    expect(await db.select().from(schema.recipeImportDraftCuisine)).toHaveLength(2);
    const payload = JSON.parse(savedRecipeBody("edited-salt", "Edited salt"));
    Object.assign(payload.recipe, { description: edits.description, cuisine: ["Mexican", "European"], prepTime: 5 });
    const accept = { version: 2, idempotencyKey: crypto.randomUUID(), recipe: { slug: "edited-salt", title: "Edited salt", description: edits.description, body: JSON.stringify(payload), visibility: "private" } };
    expect((await authenticatedRequest(cook, `${path}/acceptance`, { method: "PUT", body: { ...accept, version: 1 }, env: service.env })).status).toBe(409);
    const differentMetadata = { ...payload, recipe: { ...payload.recipe, servings: 9 } };
    expect((await authenticatedRequest(cook, `${path}/acceptance`, { method: "PUT", body: { ...accept, recipe: { ...accept.recipe, body: JSON.stringify(differentMetadata) } }, env: service.env })).status).toBe(409);
    expect((await authenticatedRequest(cook, `${path}/acceptance`, { method: "PUT", body: { ...accept, recipe: { ...accept.recipe, visibility: "public" } }, env: service.env })).status).toBe(409);
    const accepted = await Promise.all([1, 2].map(() => authenticatedRequest(cook, `${path}/acceptance`, { method: "PUT", body: accept, env: service.env })));
    expect(accepted.map(response => response.status)).toEqual([200, 200]);
    expect(await db.select().from(schema.recipe)).toHaveLength(1);
    expect((await authenticatedRequest(cook, `${path}/acceptance`, { method: "PUT", body: { ...accept, recipe: { ...accept.recipe, title: "Different request" } }, env: service.env })).status).toBe(409);
    expect((await authenticatedRequest(cook, `${path}/acceptance`, { method: "PUT", body: { ...accept, idempotencyKey: crypto.randomUUID() }, env: service.env })).status).toBe(409);
    expect((await authenticatedRequest(cook, `${path}/draft`, { method: "PUT", body: { version: 2, draft: edits }, env: service.env })).status).toBe(409);
    expect((await authenticatedRequest(cook, `${path}/review`, { method: "PUT", body: { state: "skipped" }, env: service.env })).status).toBe(409);
    expect(await db.select().from(schema.recipeImportReviewEvent)).toHaveLength(2);
    const [provenance] = await db.select().from(schema.recipeImportJob).where(eq(schema.recipeImportJob.id, item.id));
    expect(provenance?.acceptedRecipeId).toBeTruthy();
    expect(provenance?.batchId).toBe(batch.id);
    const receipt = await authenticatedRequest(cook, `${path}/acceptance`, { env: service.env });
    expect((await receipt.json() as { recipeId: string }).recipeId).toBe(provenance?.acceptedRecipeId);
  });

  it("keeps partial failures independent and fences repeated retries", async () => {
    const cook = await createUser("Batch Cook", "batch@example.test");
    const service = batchServices();
    const response = await authenticatedRequest(cook, "/recipe-import-batches", { method: "POST", body: { idempotencyKey: crypto.randomUUID(), sources: [...sources().slice(0, 2), { type: "url", url: "http://localhost/private" }, sources()[0]] }, env: service.env });
    const batch = await response.json() as { id: string; items: { id: string; status: string; errorType: string }[] };
    expect(batch.items.map(item => item.status)).toEqual(["queued", "queued", "failed", "failed"]);
    expect(service.create).not.toHaveBeenCalled();
    const failed = batch.items[0]!;
    await db.update(schema.recipeImportJob).set({ status: "running", workflowInstanceId: `${failed.id}-1` }).where(eq(schema.recipeImportJob.id, failed.id));
    service.status.mockResolvedValueOnce({ status: "errored" });
    expect((await authenticatedRequest(cook, `/recipe-import-batches/${batch.id}/execution`, { method: "PUT", body: { state: "started" }, env: service.env })).status).toBe(200);
    const [recovered] = await db.select().from(schema.recipeImportJob).where(eq(schema.recipeImportJob.id, failed.id));
    expect(recovered?.errorType).toBe("WorkflowError");
    await db.update(schema.recipeImportJob).set({ status: "failed", reviewState: "needs_attention", errorType: "ParseError" }).where(eq(schema.recipeImportJob.id, failed.id));
    const path = `/recipe-import-batches/${batch.id}/items/${failed.id}`;
    expect((await authenticatedRequest(cook, `${path}/attempts`, { method: "POST", env: service.env })).status).toBe(201);
    expect((await authenticatedRequest(cook, `${path}/attempts`, { method: "POST", env: service.env })).status).toBe(409);
    expect(service.create).toHaveBeenCalledWith({ id: `${failed.id}-2`, params: { jobId: failed.id, batchAttempt: 2 } });
    const attempt = await authenticatedRequest(cook, `${path}/attempts/2`, { env: service.env });
    expect((await attempt.json() as { attempt: number }).attempt).toBe(2);
    const badPath = `/recipe-import-batches/${batch.id}/items/${batch.items[2]!.id}`;
    expect((await authenticatedRequest(cook, `${badPath}/attempts`, { method: "POST", env: service.env })).status).toBe(409);
    expect((await authenticatedRequest(cook, `${badPath}/review`, { method: "PUT", body: { state: "skipped" }, env: service.env })).status).toBe(200);
    const beforeReplay = (await db.select().from(schema.recipeImportReviewEvent)).length;
    expect((await authenticatedRequest(cook, `${badPath}/review`, { method: "PUT", body: { state: "skipped" }, env: service.env })).status).toBe(200);
    expect(await db.select().from(schema.recipeImportReviewEvent)).toHaveLength(beforeReplay);
    const resumed = await authenticatedRequest(cook, `/recipe-import-batches/${batch.id}`, { env: service.env });
    expect((await resumed.json() as { counts: { skipped: number } }).counts.skipped).toBe(1);
  });
});
