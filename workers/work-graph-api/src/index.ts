export {
  createWorkGraphApp,
  type WorkGraphApiRepository,
  type WorkGraphAppOptions,
} from "./app";

import { closeDb, createDb, WorkGraphRepository } from "work-graph-db";
import { createWorkGraphApp } from "./app";

export interface WorkGraphBindings {
  HYPERDRIVE: Hyperdrive;
}

export default {
  async fetch(request, env, context) {
    // A Worker invocation uses one sequential repository transaction. Keep its
    // client to one connection so concurrent requests, rather than one request,
    // consume the Hyperdrive pool.
    const db = createDb(env.HYPERDRIVE.connectionString, {
      maxConnections: 1,
    });
    try {
      return await createWorkGraphApp(
        new WorkGraphRepository(db),
      ).fetch(request, env, context);
    } finally {
      await closeDb(db);
    }
  },
} satisfies ExportedHandler<WorkGraphBindings>;
