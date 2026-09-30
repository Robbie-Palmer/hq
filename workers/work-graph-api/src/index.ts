export {
  createWorkGraphApp,
  type WorkGraphApiRepository,
  type WorkGraphAppOptions,
} from "./app";

import { closeDb, createDb, WorkGraphRepository } from "work-graph-db";
import { createWorkGraphApp } from "./app";

export interface WorkGraphBindings {
  HYPERDRIVE: Hyperdrive;
  WORKER_VERSION?: { id: string };
}

export default {
  async fetch(request, env, context) {
    // A Worker invocation uses one sequential repository transaction. Keep its
    // client to one connection so concurrent requests, rather than one request,
    // consume the Hyperdrive pool.
    let db: ReturnType<typeof createDb> | undefined;
    try {
      try {
        db = createDb(env.HYPERDRIVE.connectionString, {
          maxConnections: 1,
        });
        return await createWorkGraphApp(new WorkGraphRepository(db), {
          workerVersion: env.WORKER_VERSION?.id,
        }).fetch(request, env, context);
      } finally {
        if (db !== undefined) await closeDb(db);
      }
    } catch {
      // Startup and cleanup failures bypass Hono. Never log their raw errors.
      const requestId = crypto.randomUUID();
      console.error(
        JSON.stringify({
          message: "Work Graph Worker failed",
          requestId,
          route: "worker.fetch",
          outcome: "error",
          status: 500,
          workerVersion: env.WORKER_VERSION?.id ?? "local",
          exceptionClass: "worker_lifecycle_error",
        }),
      );
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
