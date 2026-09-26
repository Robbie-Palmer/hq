import type { AgentAuthEvent, AgentSession } from "@better-auth/agent-auth";
import type { Db } from "recipe-db";
import * as schema from "recipe-db/schema";
import { describe, expect, it, vi } from "vitest";
import {
  createRecipeAgentAuthPlugin,
  escapedLikePattern,
  executeRecipeAgentCapability,
  RECIPE_SITE_AGENT_CAPABILITIES,
} from "../src/agent-auth";
import { createAuth, isPreviewAuthEnabled } from "../src/auth";

function queryDb(...results: unknown[][]): Db {
  let resultIndex = 0;
  const db = {
    select: () => {
      const result = results[resultIndex++] ?? [];
      const query = {
        from: () => query,
        leftJoin: () => query,
        where: () => query,
        groupBy: () => Promise.resolve(result),
        orderBy: () => query,
        limit: () => Promise.resolve(result),
        then: <TResult1 = unknown[]>(
          resolve?:
            | ((value: unknown[]) => TResult1 | PromiseLike<TResult1>)
            | null,
        ) => Promise.resolve(result).then(resolve),
      };
      return query;
    },
    transaction: (
      callback: (tx: Db) => Promise<unknown>,
      _options?: unknown,
    ) => callback(db as unknown as Db),
  };
  return db as unknown as Db;
}

function secondaryStorageDb(
  rows: Array<{ value: string; expiresAt: Date | null }>,
) {
  const state = {
    rows,
    writes: [] as Array<{ key: string; value: string; expiresAt: Date }>,
    deleteCount: 0,
  };
  const db = {
    select: () => {
      const query = {
        from: () => query,
        where: () => query,
        limit: () => Promise.resolve(state.rows),
      };
      return query;
    },
    insert: () => ({
      values: (values: {
        key: string;
        value: string;
        expiresAt: Date;
      }) => {
        state.writes.push(values);
        return { onConflictDoUpdate: () => Promise.resolve() };
      },
    }),
    delete: () => ({
      where: () => {
        state.deleteCount += 1;
        return Promise.resolve();
      },
    }),
  } as unknown as Db;
  return { db, state };
}

function jtiReservationDb() {
  const state = {
    reserved: false,
    writes: [] as Array<{ key: string; value: string; expiresAt: Date }>,
  };
  const transactionDb = {
    delete: () => ({ where: () => Promise.resolve() }),
    insert: () => ({
      values: (values: { key: string; value: string; expiresAt: Date }) => {
        state.writes.push(values);
        return {
          onConflictDoNothing: () => ({
            returning: () => {
              if (state.reserved) return Promise.resolve([]);
              state.reserved = true;
              return Promise.resolve([{ key: values.key }]);
            },
          }),
        };
      },
    }),
  };
  const db = {
    transaction: (callback: (tx: typeof transactionDb) => Promise<unknown>) =>
      callback(transactionDb),
  } as unknown as Db;
  return { db, state };
}

function agentSession(userId = "delegating-user"): AgentSession {
  return {
    type: "delegated",
    agentId: "agent-1",
    userId,
    agent: {
      id: "agent-1",
      name: "Recipe helper",
      mode: "delegated",
      capabilityGrants: [],
      hostId: "host-1",
      createdAt: new Date("2026-08-22T08:00:00Z"),
      activatedAt: new Date("2026-08-22T08:01:00Z"),
      metadata: null,
    },
    host: { id: "host-1", userId, status: "active" },
    user: {
      id: userId,
      name: "Delegating user",
      email: "delegating-user@example.test",
    },
  };
}

function agentExecutionDb(...queryResults: unknown[][]) {
  const state = {
    auditValues: [] as Record<string, unknown>[],
    counts: new Map<string, number>(),
  };
  const db = Object.assign(queryDb(...queryResults), {
    insert: vi.fn((table: unknown) => {
      if (table === schema.appRateLimit) {
        return {
          values: (values: { key: string; windowStart: Date }) => ({
            onConflictDoUpdate: () => ({
              returning: () => {
                const count = (state.counts.get(values.key) ?? 0) + 1;
                state.counts.set(values.key, count);
                return Promise.resolve([
                  { count, windowStart: values.windowStart },
                ]);
              },
            }),
          }),
        };
      }
      if (table === schema.agentAuthAuditEvent) {
        return {
          values: (values: Record<string, unknown>) => {
            state.auditValues.push(values);
            return Promise.resolve();
          },
        };
      }
      throw new Error("Unexpected insert table");
    }),
  }) as Db;
  return { db, state };
}

function recipe(
  overrides: Partial<typeof schema.recipe.$inferSelect> = {},
): typeof schema.recipe.$inferSelect {
  return {
    id: "00000000-0000-4000-8000-000000000061",
    slug: "tomato-soup",
    title: "Tomato Soup",
    description: "A quick soup",
    body: "Add @tomato{2} and simmer.",
    userId: "delegating-user",
    visibility: "private",
    createdAt: new Date("2026-08-20T08:00:00Z"),
    updatedAt: new Date("2026-08-21T08:00:00Z"),
    ...overrides,
  };
}

function savedRecipeBody(input: {
  canonical?: string;
  cuisines?: string[];
  cookware?: string[];
  ingredients: string[];
  slug: string;
}): string {
  const source = input.ingredients
    .map((ingredient) => `Add @${ingredient}{1}.`)
    .join("\n");
  return JSON.stringify({
    version: 1,
    source,
    recipe: {
      slug: input.slug,
      title: input.slug,
      description: `${input.slug} description`,
      cookBody: source,
      date: "2026-09-09",
      cuisine: input.cuisines ?? [],
      servings: 2,
      tags: [],
      cookware: input.cookware ?? [],
      ingredientGroups: [
        {
          items: input.ingredients.map((ingredient) => ({ ingredient })),
        },
      ],
      instructions: ["Combine the ingredients."],
      ...(input.canonical ? { canonical: input.canonical } : {}),
    },
  });
}

describe("recipe Agent Auth capabilities", () => {
  it("enables preview password auth only for canonical Pages previews and local development", () => {
    expect(
      isPreviewAuthEnabled({
        DEPLOYMENT_ENV: "preview",
        BETTER_AUTH_URL: "https://pr-42.personal-site-bu5.pages.dev",
      }),
    ).toBe(true);
    expect(
      isPreviewAuthEnabled({
        DEPLOYMENT_ENV: "preview",
        BETTER_AUTH_URL: "http://localhost:3000",
      }),
    ).toBe(true);

    for (const BETTER_AUTH_URL of [
      "https://robbiepalmer.me",
      "https://pr-42.personal-site-bu5.pages.dev.attacker.example",
      "https://pr-0.personal-site-bu5.pages.dev",
      "not-a-url",
    ]) {
      expect(
        isPreviewAuthEnabled({ DEPLOYMENT_ENV: "preview", BETTER_AUTH_URL }),
      ).toBe(false);
    }
  });

  it("does not enable Better Auth password routes for a misconfigured production hostname", () => {
    const auth = createAuth({} as Db, {
      DEPLOYMENT_ENV: "preview",
      BETTER_AUTH_URL: "https://robbiepalmer.me",
      BETTER_AUTH_SECRET: "test-secret-at-least-32-characters-long",
    });

    expect(auth.options.emailAndPassword?.enabled).toBe(false);
  });

  it("enables Better Auth password routes for a canonical Pages preview", () => {
    const auth = createAuth({} as Db, {
      DEPLOYMENT_ENV: "preview",
      BETTER_AUTH_URL: "https://pr-42.personal-site-bu5.pages.dev",
      BETTER_AUTH_SECRET: "test-secret-at-least-32-characters-long",
    });

    expect(auth.options.emailAndPassword?.enabled).toBe(true);
  });

  it("fails closed when Better Auth's rate-limit store is unavailable", async () => {
    const db = {
      insert: () => {
        throw new Error("db down");
      },
    } as unknown as Db;
    const auth = createAuth(db, {
      BETTER_AUTH_URL: "https://recipes.example.test",
      BETTER_AUTH_SECRET: "test-secret-at-least-32-characters-long",
    });
    const storage = auth.options.rateLimit?.customStorage;
    if (!storage) throw new Error("Rate-limit storage was not configured");
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      storage.consume("sign-in", { max: 20, window: 60 }),
    ).resolves.toEqual({ allowed: false, retryAfter: 60 });
  });

  it("keeps PostgreSQL secondary storage after applying Cloudflare options", () => {
    const auth = createAuth({} as Db, {
      BETTER_AUTH_URL: "https://recipes.example.test",
      BETTER_AUTH_SECRET: "test-secret-at-least-32-characters-long",
    });

    expect(auth.options.secondaryStorage).toBeDefined();
  });

  it("reads, expires, writes, and deletes replay-protection entries", async () => {
    const { db, state } = secondaryStorageDb([
      { value: "cached-jti", expiresAt: new Date(Date.now() + 60_000) },
    ]);
    const auth = createAuth(db, {
      BETTER_AUTH_URL: "https://recipes.example.test",
      BETTER_AUTH_SECRET: "test-secret-at-least-32-characters-long",
    });
    const storage = auth.options.secondaryStorage;
    expect(storage).toBeDefined();
    if (!storage) throw new Error("Secondary storage was not configured");

    await expect(storage.get("jti:active")).resolves.toBe("cached-jti");
    await storage.set("jti:new", "new-value", 60);
    await storage.set("cache:bounded-default", "new-value");
    await storage.delete("jti:new");

    expect(state.writes).toHaveLength(2);
    expect(state.writes[0]).toMatchObject({
      key: "jti:new",
      value: "new-value",
    });
    expect(state.writes[0]?.expiresAt?.getTime()).toBeGreaterThan(Date.now());
    expect(state.writes[1]?.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(state.deleteCount).toBe(1);

    state.rows = [
      { value: "expired-jti", expiresAt: new Date(Date.now() - 60_000) },
    ];
    await expect(storage.get("jti:expired")).resolves.toBeNull();
    expect(state.deleteCount).toBe(2);

    state.rows = [];
    await expect(storage.get("jti:missing")).resolves.toBeNull();
  });

  it("atomically reserves JTI keys before Better Auth stores them", async () => {
    const { db, state } = jtiReservationDb();
    const auth = createAuth(db, {
      BETTER_AUTH_URL: "https://recipes.example.test",
      BETTER_AUTH_SECRET: "test-secret-at-least-32-characters-long",
    });
    const storage = auth.options.secondaryStorage;
    if (!storage) throw new Error("Secondary storage was not configured");

    const key = "agent-auth:jti:agent-1:jti-1";
    await expect(Promise.all([storage.get(key), storage.get(key)])).resolves.toEqual([
      null,
      "1",
    ]);
    expect(state.writes).toHaveLength(2);
    expect(state.writes[0]).toMatchObject({ key, value: "1" });
    expect(state.writes[0]?.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("removes and returns a live secondary-storage entry atomically", async () => {
    const pending = { deletes: 0, rows: [{ value: "otp-value" }] };
    const db = {
      delete: () => ({
        where: () => {
          pending.deletes += 1;
          return {
            returning: () => Promise.resolve(pending.rows.splice(0, 1)),
          };
        },
      }),
    } as unknown as Db;
    const auth = createAuth(db, {
      BETTER_AUTH_URL: "https://recipes.example.test",
      BETTER_AUTH_SECRET: "test-secret-at-least-32-characters-long",
    });
    const storage = auth.options.secondaryStorage;
    if (!storage) throw new Error("Secondary storage was not configured");

    await expect(storage.getAndDelete("verification:cached")).resolves.toBe(
      "otp-value",
    );
    expect(pending.deletes).toBe(1);
  });

  it("returns null for an absent or expired secondary-storage entry", async () => {
    const db = {
      delete: () => ({
        where: () => ({ returning: () => Promise.resolve([]) }),
      }),
    } as unknown as Db;
    const auth = createAuth(db, {
      BETTER_AUTH_URL: "https://recipes.example.test",
      BETTER_AUTH_SECRET: "test-secret-at-least-32-characters-long",
    });
    const storage = auth.options.secondaryStorage;
    if (!storage) throw new Error("Secondary storage was not configured");

    await expect(storage.getAndDelete("verification:missing")).resolves.toBe(
      null,
    );
  });

  it("increments a counter atomically with a fresh value and bounded expiry", async () => {
    const state = {
      upsert: undefined as
        | { key: string; value: string; expiresAt: Date }
        | undefined,
      updateCount: 0,
    };
    const db = {
      insert: () => ({
        values: (values: { key: string; value: string; expiresAt: Date }) => {
          state.upsert = values;
          return {
            onConflictDoUpdate: () => {
              state.updateCount += 1;
              return {
                returning: () => Promise.resolve([{ value: "2" }]),
              };
            },
          };
        },
      }),
    } as unknown as Db;
    const auth = createAuth(db, {
      BETTER_AUTH_URL: "https://recipes.example.test",
      BETTER_AUTH_SECRET: "test-secret-at-least-32-characters-long",
    });
    const storage = auth.options.secondaryStorage;
    if (!storage) throw new Error("Secondary storage was not configured");

    await expect(storage.increment("rate-limit:ip", 60)).resolves.toBe(2);
    expect(state.upsert).toMatchObject({ key: "rate-limit:ip", value: "1" });
    const ttlMs = (state.upsert?.expiresAt.getTime() ?? 0) - Date.now();
    expect(ttlMs).toBeGreaterThan(59_000);
    expect(ttlMs).toBeLessThanOrEqual(60_000);
    expect(state.updateCount).toBe(1);
  });

  it("exposes recipe, pantry, shopping-list, and committed cooking-history reads", () => {
    expect(
      RECIPE_SITE_AGENT_CAPABILITIES.map((capability) => capability.name),
    ).toEqual([
      "recipes.search",
      "recipes.read",
      "recipes.dataset.inspect",
      "pantry.read",
      "shopping_list.read",
      "cook_log.read",
      "cooking_insights.read",
    ]);
    expect(
      RECIPE_SITE_AGENT_CAPABILITIES.every(
        (capability) =>
          capability.approvalStrength === "session" &&
          capability.grantTTL === 30 * 24 * 60 * 60,
      ),
    ).toBe(true);
  });

  it("bounds recipe search input and result size", () => {
    const search = RECIPE_SITE_AGENT_CAPABILITIES.find(
      (capability) => capability.name === "recipes.search",
    );

    expect(search?.input).toMatchObject({
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: { minLength: 1, maxLength: 200 },
        limit: { minimum: 1, maximum: 25, default: 10 },
      },
    });
    expect(search?.output).toMatchObject({
      properties: { items: { maxItems: 25 } },
    });
  });

  it("bounds recipe dataset inspection work and ranked values", () => {
    const inspect = RECIPE_SITE_AGENT_CAPABILITIES.find(
      (capability) => capability.name === "recipes.dataset.inspect",
    );

    expect(inspect?.input).toMatchObject({
      additionalProperties: false,
      properties: {
        sampleSize: { minimum: 1, maximum: 200, default: 100 },
        top: { minimum: 1, maximum: 25, default: 10 },
      },
    });
    expect(inspect?.output).toMatchObject({
      properties: {
        population: {
          properties: { sampledRecipes: { maximum: 200 } },
        },
        sample: {
          properties: {
            ingredients: { properties: { top: { maxItems: 25 } } },
            cuisines: { properties: { top: { maxItems: 25 } } },
          },
        },
      },
    });
  });

  it("bounds cooking log dates, cursors, and result size", () => {
    const cookLog = RECIPE_SITE_AGENT_CAPABILITIES.find(
      (capability) => capability.name === "cook_log.read",
    );

    expect(cookLog?.input).toMatchObject({
      additionalProperties: false,
      properties: {
        from: { format: "date-time" },
        to: { format: "date-time" },
        limit: { minimum: 1, maximum: 50, default: 20 },
        cursor: { maxLength: 500 },
      },
    });
    expect(cookLog?.output).toMatchObject({
      properties: { items: { maxItems: 50 } },
    });
  });

  it("searches recipes visible to a user without a household", async () => {
    expect(escapedLikePattern(String.raw`tomato%_\soup`)).toBe(
      String.raw`%tomato\%\_\\soup%`,
    );

    const result = await executeRecipeAgentCapability(
      queryDb([], [recipe()]),
      "recipes.search",
      { query: String.raw`tomato%_\soup`, limit: 5 },
      agentSession(),
    );

    expect(result).toEqual({
      items: [
        {
          id: "00000000-0000-4000-8000-000000000061",
          slug: "tomato-soup",
          title: "Tomato Soup",
          description: "A quick soup",
          visibility: "private",
          owned: true,
          updatedAt: new Date("2026-08-21T08:00:00Z"),
        },
      ],
    });
  });

  it("includes household-visible recipes for household members", async () => {
    const result = await executeRecipeAgentCapability(
      queryDb(
        [{ organizationId: "household-1" }],
        [{ userId: "delegating-user" }, { userId: "housemate" }],
        [
          recipe({
            slug: "household-stew",
            title: "Household Stew",
            userId: "housemate",
            visibility: "household",
          }),
        ],
      ),
      "recipes.search",
      { query: "stew" },
      agentSession(),
    );

    expect(result).toMatchObject({
      items: [
        { slug: "household-stew", visibility: "household", owned: false },
      ],
    });
  });

  it("reads one visible recipe with its Cooklang body", async () => {
    const result = await executeRecipeAgentCapability(
      queryDb([], [recipe()]),
      "recipes.read",
      { slug: "tomato-soup" },
      agentSession(),
    );

    expect(result).toMatchObject({
      recipe: {
        slug: "tomato-soup",
        body: "Add @tomato{2} and simmer.",
      },
    });
  });

  it("returns null when a recipe is not visible", async () => {
    await expect(
      executeRecipeAgentCapability(
        queryDb([], []),
        "recipes.read",
        { slug: "missing-recipe" },
        agentSession(),
      ),
    ).resolves.toEqual({ recipe: null });
  });

  it("inspects a bounded aggregate sample without returning recipe bodies", async () => {
    const result = await executeRecipeAgentCapability(
      queryDb(
        [],
        [
          { visibility: "public", value: 1 },
          { visibility: "household", value: 1 },
          { visibility: "private", value: 1 },
        ],
        [
          {
            id: "00000000-0000-4000-8000-000000000081",
            body: savedRecipeBody({
              slug: "tomato-pasta",
              ingredients: ["tomato", "basil"],
              cuisines: ["Italian"],
              cookware: ["saucepan"],
              canonical: "https://recipes.example.test/tomato-pasta",
            }),
          },
          {
            id: "00000000-0000-4000-8000-000000000082",
            body: savedRecipeBody({
              slug: "tomato-soup",
              ingredients: ["tomato", "salt"],
              cuisines: ["Italian", "American"],
            }),
          },
          {
            id: "00000000-0000-4000-8000-000000000083",
            body: "not-json",
          },
        ],
      ),
      "recipes.dataset.inspect",
      { sampleSize: 3, top: 2 },
      agentSession(),
    );

    expect(result).toEqual({
      population: {
        visibleRecipes: 3,
        sampledRecipes: 3,
        truncated: false,
      },
      visibility: { public: 1, household: 1, private: 1 },
      sample: {
        parseQuality: {
          validPayloads: 2,
          invalidPayloads: 1,
          withInstructionSdk: 0,
        },
        provenance: { withCanonicalUrl: 1, withoutCanonicalUrl: 1 },
        coverage: { withCuisine: 2, withIngredients: 2, withCookware: 1 },
        ingredients: {
          distinct: 3,
          top: [
            { ingredient: "tomato", recipeCount: 2 },
            { ingredient: "basil", recipeCount: 1 },
          ],
        },
        cuisines: {
          distinct: 2,
          top: [
            { cuisine: "Italian", recipeCount: 2 },
            { cuisine: "American", recipeCount: 1 },
          ],
        },
      },
    });
    expect(JSON.stringify(result)).not.toContain("recipes.example.test");
    expect(JSON.stringify(result)).not.toContain("Combine the ingredients");
  });

  it("marks a recipe dataset sample as truncated", async () => {
    const result = await executeRecipeAgentCapability(
      queryDb(
        [],
        [{ visibility: "public", value: 4 }],
        [
          {
            id: "00000000-0000-4000-8000-000000000084",
            body: savedRecipeBody({
              slug: "sampled-recipe",
              ingredients: ["salt"],
            }),
          },
        ],
      ),
      "recipes.dataset.inspect",
      { sampleSize: 1 },
      agentSession(),
    );

    expect(result).toMatchObject({
      population: {
        visibleRecipes: 4,
        sampledRecipes: 1,
        truncated: true,
      },
    });
  });

  it("reads a repeatable household pantry snapshot with item versions", async () => {
    const result = await executeRecipeAgentCapability(
      queryDb(
        [
          {
            householdId: "household-1",
            householdName: "Test household",
          },
        ],
        [
          { ingredientSlug: "onion", location: "fresh", version: 3n },
          { ingredientSlug: "milk", location: "fridge", version: 1n },
        ],
        [{ revision: 7n }],
      ),
      "pantry.read",
      {},
      agentSession(),
    );

    expect(result).toEqual({
      resourceId: "household-1",
      scope: "household",
      revision: "7",
      stock: { onion: "fresh", milk: "fridge" },
      itemVersions: { onion: "3", milk: "1" },
    });
  });

  it("returns an empty personal pantry when no aggregate exists", async () => {
    await expect(
      executeRecipeAgentCapability(
        queryDb([], [], []),
        "pantry.read",
        {},
        agentSession(),
      ),
    ).resolves.toEqual({
      resourceId: "delegating-user",
      scope: "personal",
      revision: "0",
      stock: {},
      itemVersions: {},
    });
  });

  it("reads the current household shopping list", async () => {
    const createdAt = new Date("2026-08-20T08:00:00Z");
    const updatedAt = new Date("2026-08-21T08:00:00Z");
    const result = await executeRecipeAgentCapability(
      queryDb(
        [{ organizationId: "household-1" }],
        [
          {
            id: "00000000-0000-4000-8000-000000000071",
            userId: null,
            organizationId: "household-1",
            status: "active",
            revision: 4n,
            snapshot: {
              recipes: [{ slug: "tomato-soup", servings: 2 }],
              checked: ["tomato"],
              extras: [
                { id: "extra-milk", text: "Milk", checked: false },
              ],
            },
            closedAt: null,
            createdAt,
            updatedAt,
          },
        ],
      ),
      "shopping_list.read",
      {},
      agentSession(),
    );

    expect(result).toEqual({
      shoppingList: {
        id: "00000000-0000-4000-8000-000000000071",
        resourceId: "household-1",
        scope: "household",
        revision: "4",
        snapshot: {
          recipes: [{ slug: "tomato-soup", servings: 2 }],
          checked: ["tomato"],
          extras: [{ id: "extra-milk", text: "Milk", checked: false }],
        },
        createdAt: createdAt.toISOString(),
        updatedAt: updatedAt.toISOString(),
      },
    });
  });

  it("returns null when the delegated user has no current shopping list", async () => {
    await expect(
      executeRecipeAgentCapability(
        queryDb([], []),
        "shopping_list.read",
        {},
        agentSession(),
      ),
    ).resolves.toEqual({ shoppingList: null });
  });

  it("reads only bounded completed cooking-log rows for the delegated user", async () => {
    const completedAt = new Date("2026-08-20T18:30:00.000Z");
    const result = await executeRecipeAgentCapability(
      queryDb([
        {
          id: "00000000-0000-4000-8000-000000000062",
          recipeSlug: "tomato-soup",
          recipeTitle: "Tomato Soup",
          servings: 2,
          completedAt,
        },
      ]),
      "cook_log.read",
      {
        from: "2026-08-01T00:00:00.000Z",
        to: "2026-08-22T00:00:00.000Z",
        limit: 10,
      },
      agentSession(),
    );

    expect(result).toEqual({
      items: [
        {
          id: "00000000-0000-4000-8000-000000000062",
          recipeSlug: "tomato-soup",
          recipeTitle: "Tomato Soup",
          servings: 2,
          completedAt,
        },
      ],
      nextCursor: null,
    });
  });

  it("rejects unbounded or malformed cooking-log requests", async () => {
    await expect(
      executeRecipeAgentCapability(
        queryDb([]),
        "cook_log.read",
        {
          from: "2026-01-01T00:00:00.000Z",
          to: "2026-08-22T00:00:00.000Z",
        },
        agentSession(),
      ),
    ).rejects.toMatchObject({
      status: "BAD_REQUEST",
      message: "Cook log range must not exceed 90 days",
    });
    await expect(
      executeRecipeAgentCapability(
        queryDb([]),
        "cook_log.read",
        { cursor: "not-a-cursor" },
        agentSession(),
      ),
    ).rejects.toThrow();
    await expect(
      executeRecipeAgentCapability(
        queryDb(),
        "recipes.dataset.inspect",
        { sampleSize: 201 },
        agentSession(),
      ),
    ).rejects.toThrow();
  });

  it("keeps the original cooking-log date window across pages", async () => {
    const firstPage = await executeRecipeAgentCapability(
      queryDb([
        {
          id: "00000000-0000-4000-8000-000000000062",
          recipeSlug: "tomato-soup",
          recipeTitle: "Tomato Soup",
          servings: 2,
          completedAt: new Date("2026-08-20T18:30:00.000Z"),
        },
        {
          id: "00000000-0000-4000-8000-000000000061",
          recipeSlug: "lentil-soup",
          recipeTitle: "Lentil Soup",
          servings: 4,
          completedAt: new Date("2026-08-19T18:30:00.000Z"),
        },
      ]),
      "cook_log.read",
      {
        from: "2026-08-01T00:00:00.000Z",
        to: "2026-08-22T00:00:00.000Z",
        limit: 1,
      },
      agentSession(),
    );
    if (!("nextCursor" in firstPage)) {
      throw new Error("Expected a cooking-log response");
    }
    const nextCursor = firstPage.nextCursor;
    expect(nextCursor).toBeTypeOf("string");

    const secondPage = await executeRecipeAgentCapability(
      queryDb([]),
      "cook_log.read",
      { cursor: nextCursor },
      agentSession(),
    );

    expect(secondPage).toEqual({ items: [], nextCursor: null });
    await expect(
      executeRecipeAgentCapability(
        queryDb([]),
        "cook_log.read",
        {
          cursor: nextCursor,
          from: "2026-08-02T00:00:00.000Z",
        },
        agentSession(),
      ),
    ).rejects.toThrow("Cursor does not match the requested date range");
  });

  it("returns server-computed cooking insights for the delegated user", async () => {
    const completedAt = new Date("2026-08-20T18:30:00.000Z");
    const result = await executeRecipeAgentCapability(
      queryDb(
        [{ cookModeStarts: 4, mealsCooked: 3 }],
        [
          {
            id: "00000000-0000-4000-8000-000000000063",
            recipeSlug: "tomato-soup",
            recipeTitle: "Tomato Soup",
            servings: 2,
            startedAt: new Date("2026-08-20T18:00:00.000Z"),
            completedAt,
          },
        ],
        [{ count: 2 }],
      ),
      "cooking_insights.read",
      {},
      agentSession(),
    );

    expect(result).toMatchObject({
      cookModeStarts: 4,
      mealsCooked: 3,
      distinctRecipesCooked: 2,
      recent: [{ recipeSlug: "tomato-soup", completedAt }],
    });
  });

  it("rejects malformed and unsupported capability requests", async () => {
    await expect(
      executeRecipeAgentCapability(
        queryDb([]),
        "recipes.read",
        { slug: "NOT A SLUG" },
        agentSession(),
      ),
    ).rejects.toThrow();
    await expect(
      executeRecipeAgentCapability(
        queryDb([]),
        "recipes.delete",
        {},
        agentSession(),
      ),
    ).rejects.toThrow("Unsupported agent capability: recipes.delete");
  });

  it("validates, executes, and audits through the Agent Auth callbacks", async () => {
    const { db, state } = agentExecutionDb([], [recipe()]);
    const plugin = createRecipeAgentAuthPlugin(db);
    const options = plugin.options;
    if (!options) throw new Error("Agent Auth options were not exposed");

    expect(
      await options.validateCapabilities?.([
        "recipes.search",
        "recipes.read",
      ]),
    ).toBe(true);
    expect(
      await options.validateCapabilities?.(["recipes.delete"]),
    ).toBe(false);

    const responseHeaders = new Headers();
    const executed = await options.onExecute?.({
      ctx: {
        headers: new Headers({
          "cf-connecting-ip": "203.0.113.9",
          "x-request-id": "agent-request-123",
        }),
        responseHeaders,
        setHeader: (key: string, value: string) =>
          responseHeaders.set(key, value),
      },
      capability: "recipes.read",
      arguments: { slug: "tomato-soup" },
      agentSession: agentSession(),
    } as never);
    expect(executed).toMatchObject({ recipe: { slug: "tomato-soup" } });

    const events: AgentAuthEvent[] = [
      {
        type: "capability.executed",
        actorType: "agent",
        actorId: "agent-1",
        agentId: "agent-1",
        userId: "delegating-user",
        capability: "recipes.read",
        status: "success",
        durationMs: 12,
      },
      {
        type: "capability.approved",
        actorType: "user",
        actorId: "delegating-user",
        agentId: "agent-1",
      },
    ];
    for (const event of events) await options.onEvent?.(event);

    expect(responseHeaders.get("x-request-id")).toBe("agent-request-123");
    expect(state.auditValues).toEqual([
      expect.objectContaining({
        eventType: "capability.executed",
        userId: "delegating-user",
        capability: "recipes.read",
        outcome: "success",
        correlationId: "agent-request-123",
      }),
      expect.objectContaining({
        eventType: "capability.approved",
        userId: "delegating-user",
      }),
    ]);
    expect(state.auditValues[0]).not.toHaveProperty("arguments");
  });
});
