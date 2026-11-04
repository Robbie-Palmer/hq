import {
  createDrizzlePostgres,
  type DrizzlePostgresDatabase,
} from "drizzle-postgres";
import * as schema from "./schema";

export type WeddingPlannerDb = DrizzlePostgresDatabase<typeof schema>;

export function createWeddingPlannerDb(connectionString: string) {
  return createDrizzlePostgres(connectionString, schema);
}
