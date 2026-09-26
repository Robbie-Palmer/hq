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
    const db = createDb(env.HYPERDRIVE.connectionString);
    try {
      return await createWorkGraphApp(
        new WorkGraphRepository(db),
      ).fetch(request, env, context);
    } finally {
      await closeDb(db);
    }
  },
} satisfies ExportedHandler<WorkGraphBindings>;
