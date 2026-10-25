export {
  createWorkGraphApp,
  type WorkGraphApiRepository,
  type WorkGraphAppOptions,
} from "./app";

import {
  closeDb,
  createDatabaseQueryMetrics,
  createDb,
  WorkGraphRepository,
} from "work-graph-db";
import { createWorkGraphApp } from "./app";
import {
  exportAnalyticsBatch,
  R2AnalyticsObjectStore,
} from "./analytics-export";

export interface WorkGraphBindings {
  ANALYTICS?: R2Bucket;
  ANALYTICS_BATCH_SIZE?: string;
  HYPERDRIVE: Hyperdrive;
  WORKER_VERSION?: { id: string };
}

const analyticsBatchSize = (raw: string | undefined): number => {
  const value = raw === undefined ? 1_000 : Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > 10_000) {
    throw new Error(
      "ANALYTICS_BATCH_SIZE must be an integer from 1 through 10000.",
    );
  }
  return value;
};

export default {
  async fetch(request, env, context) {
    // A Worker invocation uses one sequential repository transaction. Keep its
    // client to one connection so concurrent requests, rather than one request,
    // consume the Hyperdrive pool.
    let db: ReturnType<typeof createDb> | undefined;
    try {
      try {
        const databaseMetrics = createDatabaseQueryMetrics();
        db = createDb(env.HYPERDRIVE.connectionString, {
          maxConnections: 1,
          metrics: databaseMetrics,
        });
        return await createWorkGraphApp(new WorkGraphRepository(db), {
          databaseMetrics,
          workerVersion: env.WORKER_VERSION?.id,
        }).fetch(request, env, context);
      } finally {
        if (db !== undefined) {
          try {
            await closeDb(db);
          } catch {
            console.error({
              message: "Work Graph Worker cleanup failed",
              requestId: crypto.randomUUID(),
              route: "worker.fetch",
              outcome: "error",
              status: 500,
              workerVersion: env.WORKER_VERSION?.id ?? "local",
              exceptionClass: "worker_cleanup_error",
            });
          }
        }
      }
    } catch {
      // Startup failures bypass Hono. Never log their raw errors.
      const requestId = crypto.randomUUID();
      console.error({
        message: "Work Graph Worker failed",
        requestId,
        route: "worker.fetch",
        outcome: "error",
        status: 500,
        workerVersion: env.WORKER_VERSION?.id ?? "local",
        exceptionClass: "worker_lifecycle_error",
      });
      return Response.json(
        {
          error: {
            code: "internal_error",
            message: "The Work Graph request failed.",
            requestId,
          },
        },
        { status: 500, headers: { "X-Request-Id": requestId } },
      );
    }
  },
  async scheduled(_controller, env) {
    const startedAt = Date.now();
    const databaseMetrics = createDatabaseQueryMetrics();
    let db: ReturnType<typeof createDb> | undefined;
    try {
      db = createDb(env.HYPERDRIVE.connectionString, {
        maxConnections: 1,
        metrics: databaseMetrics,
      });
      if (env.ANALYTICS === undefined) {
        throw new Error("The ANALYTICS bucket binding is missing.");
      }
      const result = await exportAnalyticsBatch(
        new WorkGraphRepository(db),
        new R2AnalyticsObjectStore(env.ANALYTICS),
        analyticsBatchSize(env.ANALYTICS_BATCH_SIZE),
      );
      console.info({
        message: "Work Graph analytics export completed",
        route: "worker.scheduled.analytics",
        status: result.status,
        eventRows: result.eventRows,
        scopeRows: result.scopeRows,
        bytes: result.objectBytes,
        durationMilliseconds: Date.now() - startedAt,
        databaseReads: databaseMetrics.queryCount,
        databaseResultRows: databaseMetrics.resultRowCount,
        databaseResultBytesEstimated: databaseMetrics.resultBytesEstimated,
        throughSequence: result.throughSequence,
        workerVersion: env.WORKER_VERSION?.id ?? "local",
      });
    } catch {
      console.error({
        message: "Work Graph analytics export failed",
        route: "worker.scheduled.analytics",
        outcome: "error",
        durationMilliseconds: Date.now() - startedAt,
        databaseReads: databaseMetrics.queryCount,
        databaseResultRows: databaseMetrics.resultRowCount,
        databaseResultBytesEstimated: databaseMetrics.resultBytesEstimated,
        workerVersion: env.WORKER_VERSION?.id ?? "local",
        exceptionClass: "analytics_export_error",
      });
      throw new Error("The Work Graph analytics export failed.");
    } finally {
      if (db !== undefined) {
        try {
          await closeDb(db);
        } catch {
          console.error({
            message: "Work Graph analytics database cleanup failed",
            route: "worker.scheduled.analytics",
            outcome: "error",
            workerVersion: env.WORKER_VERSION?.id ?? "local",
            exceptionClass: "analytics_cleanup_error",
          });
        }
      }
    }
  },
} satisfies ExportedHandler<WorkGraphBindings>;
