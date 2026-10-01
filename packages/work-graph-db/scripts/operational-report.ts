import { closeDb, createDb, type Db } from "../src/connection";
import { readOperationalReport } from "../src/analytics";

const [start, end] = process.argv.slice(2);
if (!start || !end || process.argv.length !== 4 || !process.env.DATABASE_URL) {
  console.error(
    "Usage: operational-report <start-ISO> <end-ISO>; DATABASE_URL required.",
  );
  process.exitCode = 1;
} else {
  let db: Db | undefined;
  try {
    db = createDb(process.env.DATABASE_URL, { maxConnections: 1 });
    console.log(
      JSON.stringify(await readOperationalReport(db, { start, end }), null, 2),
    );
  } catch {
    // Database errors can include connection strings or SQL values.
    console.error(
      "Operational report failed. Check the period and private database access.",
    );
    process.exitCode = 1;
  } finally {
    try {
      await closeDb(db);
    } catch {
      console.error("Operational report database cleanup failed.");
      process.exitCode = 1;
    }
  }
}
