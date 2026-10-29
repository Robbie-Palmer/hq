import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  closeDbClient,
  createDb,
  type Db,
  schema,
} from "recipe-db";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { writeArtifact } from "../../src/artifacts";
import type { Env as IngestEnv } from "../../src/env";
import {
  markJobFailed,
  markJobRunning,
  markJobSucceeded,
  updateJobStage,
} from "../../src/jobs";

function requiredDatabaseUrl(): string {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("DATABASE_URL is required for integration tests");
  return value;
}

const databaseURL = requiredDatabaseUrl();
const { db, client } = createDb(databaseURL);
const userId = "round-trip-user";

type DatabaseRoundTripMetrics = {
  connectionCount: number;
  queryCount: number;
};

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

async function createImportJob(): Promise<string> {
  await db.insert(schema.user).values({
    id: userId,
    name: "Round Trip Cook",
    email: "round-trip@example.test",
    emailVerified: true,
  });
  const [job] = await db
    .insert(schema.recipeImportJob)
    .values({ userId, imageCount: 1 })
    .returning({ id: schema.recipeImportJob.id });
  if (!job) throw new Error("Expected an import job fixture");
  return job.id;
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

async function measure(operation: (database: Db) => Promise<unknown>) {
  const measured = measuredDatabase();
  try {
    await operation(measured.db);
    return measured.metrics;
  } finally {
    await closeDbClient(measured.client);
  }
}

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await client.unsafe('truncate table "user" restart identity cascade');
});

afterAll(async () => {
  await closeDbClient(client);
});

describe("database round-trip baselines", () => {
  it("measures recipe-ingest persistence stages", async () => {
    const jobId = await createImportJob();
    const artifacts = {
      put: vi.fn().mockResolvedValue(undefined),
    } as unknown as R2Bucket;
    const env = { ARTIFACTS: artifacts } as IngestEnv;

    const start = await measure((measuredDb) =>
      markJobRunning(measuredDb, jobId, "workflow-1"),
    );
    const persistExtract = await measure(async (measuredDb) => {
      await writeArtifact({
        env,
        db: measuredDb,
        jobId,
        stage: "extract",
        kind: "extraction",
        filename: "extraction.json",
        payload: { title: "Measured recipe" },
        model: "baseline-model",
      });
      await updateJobStage(
        measuredDb,
        jobId,
        "normalize",
        "Tidying the recipe into a draft",
      );
    });
    const persistNormalize = await measure(async (measuredDb) => {
      await writeArtifact({
        env,
        db: measuredDb,
        jobId,
        stage: "normalize",
        kind: "cooklang",
        filename: "cooklang.json",
        payload: { source: "Measured recipe" },
        model: "baseline-model",
      });
      await updateJobStage(
        measuredDb,
        jobId,
        "canonicalize",
        "Matching ingredients to the pantry",
      );
    });
    const persistCanonicalize = await measure(async (measuredDb) => {
      await writeArtifact({
        env,
        db: measuredDb,
        jobId,
        stage: "canonicalize",
        kind: "canonicalization-decisions",
        filename: "decisions.json",
        payload: { decisions: [] },
        model: "baseline-model",
      });
      await updateJobStage(
        measuredDb,
        jobId,
        "finalize",
        "Preparing your draft",
      );
    });
    const finalize = await measure(async (measuredDb) => {
      await writeArtifact({
        env,
        db: measuredDb,
        jobId,
        stage: "finalize",
        kind: "draft",
        filename: "draft.json",
        payload: { title: "Measured recipe" },
        preview: { title: "Measured recipe" },
      });
      await markJobSucceeded(measuredDb, jobId);
    });
    const failureCleanup = await measure((measuredDb) =>
      markJobFailed(measuredDb, jobId, "MeasuredError", "Measured failure"),
    );

    recordRoundTrips("recipe-ingest start", start);
    recordRoundTrips("recipe-ingest persist-extract", persistExtract);
    recordRoundTrips("recipe-ingest persist-normalize", persistNormalize);
    recordRoundTrips(
      "recipe-ingest persist-canonicalize",
      persistCanonicalize,
    );
    recordRoundTrips("recipe-ingest finalize", finalize);
    recordRoundTrips("recipe-ingest failure cleanup", failureCleanup);
    expectRoundTripsAtMost(start, { connectionCount: 1, queryCount: 2 });
    expectRoundTripsAtMost(persistExtract, {
      connectionCount: 1,
      queryCount: 3,
    });
    expectRoundTripsAtMost(persistNormalize, {
      connectionCount: 1,
      queryCount: 3,
    });
    expectRoundTripsAtMost(persistCanonicalize, {
      connectionCount: 1,
      queryCount: 3,
    });
    expectRoundTripsAtMost(finalize, { connectionCount: 1, queryCount: 3 });
    expectRoundTripsAtMost(failureCleanup, {
      connectionCount: 1,
      queryCount: 2,
    });
    expect(artifacts.put).toHaveBeenCalledTimes(4);
  });
});
