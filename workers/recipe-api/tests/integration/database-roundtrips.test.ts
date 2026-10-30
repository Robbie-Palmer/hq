import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { closeDbClient, createDb, schema } from "recipe-db";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { syncLinkedAccountEmails } from "../../src/user-emails";

type DatabaseRoundTripMetrics = {
  connectionCount: number;
  queryCount: number;
};

function requiredDatabaseUrl(): string {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("DATABASE_URL is required for integration tests");
  return value;
}

const databaseURL = requiredDatabaseUrl();
const { db, client } = createDb(databaseURL);
const userId = "round-trip-user";

function expectRoundTripsAtMost(
  metrics: DatabaseRoundTripMetrics,
  limits: DatabaseRoundTripMetrics,
): void {
  expect(metrics.connectionCount).toBeGreaterThan(0);
  expect(metrics.connectionCount).toBeLessThanOrEqual(limits.connectionCount);
  expect(metrics.queryCount).toBeGreaterThan(0);
  expect(metrics.queryCount).toBeLessThanOrEqual(limits.queryCount);
}

function recordRoundTrips(
  label: string,
  metrics: DatabaseRoundTripMetrics,
): void {
  if (process.env.RECORD_DATABASE_ROUND_TRIPS === "1") {
    console.info(label, metrics);
  }
}

function stubGithubEmails(emails: string[]): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      Response.json(emails.map((email) => ({ email, verified: true }))),
    ),
  );
}

function measuredDatabase() {
  const metrics: DatabaseRoundTripMetrics = {
    connectionCount: 0,
    queryCount: 0,
  };
  const connectionIds = new Set<number>();
  const measuredClient = postgres(databaseURL, {
    prepare: false,
    debug: (connectionId) => {
      connectionIds.add(connectionId);
      metrics.connectionCount = connectionIds.size;
      metrics.queryCount += 1;
    },
  });
  const measuredDb = drizzle(measuredClient, {
    schema,
    casing: "snake_case",
  });
  return { client: measuredClient, db: measuredDb, metrics };
}

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await client.unsafe('truncate table "user" restart identity cascade');
});

afterAll(async () => {
  await closeDbClient(client);
});

describe("linked-email database round trips", () => {
  it("keeps synchronization within its reduced budget", async () => {
    await db.insert(schema.user).values({
      id: userId,
      name: "Round Trip Cook",
      email: "round-trip@example.test",
      emailVerified: true,
    });
    stubGithubEmails([
      "first-alias@example.test",
      "second-alias@example.test",
    ]);
    const measured = measuredDatabase();
    try {
      await syncLinkedAccountEmails(measured.db, {
        providerId: "github",
        userId,
        accessToken: "integration-token",
      });
      const aliases = await db
        .select({ email: schema.userEmail.email })
        .from(schema.userEmail)
        .where(eq(schema.userEmail.userId, userId))
        .orderBy(schema.userEmail.email);

      recordRoundTrips("linked-email synchronization", measured.metrics);
      expectRoundTripsAtMost(measured.metrics, {
        connectionCount: 1,
        queryCount: 2,
      });
      expect(aliases).toEqual([
        { email: "first-alias@example.test" },
        { email: "second-alias@example.test" },
      ]);
    } finally {
      await closeDbClient(measured.client);
    }
  });

  it("preserves alias ownership and is idempotent when retried", async () => {
    await db.insert(schema.user).values([
      {
        id: userId,
        name: "Round Trip Cook",
        email: "round-trip@example.test",
        emailVerified: true,
      },
      {
        id: "other-user",
        name: "Other Cook",
        email: "other@example.test",
        emailVerified: true,
      },
    ]);
    await db.insert(schema.userEmail).values({
      email: "claimed@example.test",
      userId: "other-user",
      verified: true,
      isPrimary: false,
    });
    stubGithubEmails(["owned@example.test", "claimed@example.test"]);

    const account = {
      providerId: "github",
      userId,
      accessToken: "integration-token",
    };
    await syncLinkedAccountEmails(db, account);
    await syncLinkedAccountEmails(db, account);

    const aliases = await db
      .select({
        email: schema.userEmail.email,
        userId: schema.userEmail.userId,
      })
      .from(schema.userEmail)
      .orderBy(schema.userEmail.email);
    expect(aliases).toEqual([
      { email: "claimed@example.test", userId: "other-user" },
      { email: "owned@example.test", userId },
    ]);
  });

  it("rolls back every alias when the bulk upsert fails", async () => {
    stubGithubEmails([
      "first-alias@example.test",
      "second-alias@example.test",
    ]);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await syncLinkedAccountEmails(db, {
      providerId: "github",
      userId: "missing-user",
      accessToken: "integration-token",
    });

    expect(await db.select().from(schema.userEmail)).toEqual([]);
    expect(consoleError).toHaveBeenCalledOnce();
  });
});
