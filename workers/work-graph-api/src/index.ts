export {
  createWorkGraphApp,
  type WorkGraphApiRepository,
  type WorkGraphAppOptions,
} from "./app";

import { closeDb, createDb, WorkGraphRepository } from "work-graph-db";
import { createWorkGraphApp } from "./app";
import {
  isCacheableProjectionRequest,
  isSuccessfulMutationRequest,
  WorkGraphProjectionCache,
  type ProjectionCacheOperation,
} from "./projection-cache";

export interface WorkGraphBindings {
  HYPERDRIVE: Hyperdrive;
  WORKER_VERSION?: { id: string };
}

const projectionCacheStore = (): Cache | undefined =>
  typeof caches === "undefined" ? undefined : caches.default;

const logCacheError = (
  operation: ProjectionCacheOperation,
  workerVersion: string | undefined,
): void => {
  console.error({
    message: "Work Graph projection cache failed",
    requestId: crypto.randomUUID(),
    route: "worker.cache",
    outcome: "error",
    status: 500,
    workerVersion: workerVersion ?? "local",
    exceptionClass: `projection_cache_${operation}_error`,
  });
};

const fetchFromRepository = async (
  request: Request,
  env: WorkGraphBindings,
  context: ExecutionContext,
): Promise<Response> => {
  // A Worker invocation uses one sequential repository transaction. Keep its
  // client to one connection so concurrent requests, rather than one request,
  // consume the Hyperdrive pool.
  let db: ReturnType<typeof createDb> | undefined;
  try {
    db = createDb(env.HYPERDRIVE.connectionString, {
      maxConnections: 1,
    });
    return await createWorkGraphApp(new WorkGraphRepository(db), {
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
};

export default {
  async fetch(request, env, context) {
    try {
      const cacheStore = projectionCacheStore();
      const projectionCache =
        cacheStore === undefined
          ? undefined
          : new WorkGraphProjectionCache(
              cacheStore,
              env.WORKER_VERSION?.id,
              (operation) => logCacheError(operation, env.WORKER_VERSION?.id),
            );

      if (
        projectionCache !== undefined &&
        isCacheableProjectionRequest(request)
      ) {
        const lookup = await projectionCache.lookup(request);
        if (lookup.response !== undefined) return lookup.response;

        const response = await fetchFromRepository(request, env, context);
        if (response.status === 200 && lookup.key !== undefined) {
          context.waitUntil(
            projectionCache.store(lookup.key, response.clone()),
          );
          return projectionCache.markMiss(response);
        }
        return response;
      }

      const response = await fetchFromRepository(request, env, context);
      if (
        projectionCache !== undefined &&
        isSuccessfulMutationRequest(request, response)
      ) {
        await projectionCache.invalidate(request);
      }
      return response;
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
} satisfies ExportedHandler<WorkGraphBindings>;
