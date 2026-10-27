import { createRequire } from "node:module";

const databaseUrl = process.env.MINIMAL_BOOTSTRAP_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("MINIMAL_BOOTSTRAP_DATABASE_URL is required");
}

const requireFromWorkspace = createRequire(
  new URL("../../../../../packages/drizzle-postgres/package.json", import.meta.url),
);
const postgresModule = await import(requireFromWorkspace.resolve("postgres"));
const postgres = postgresModule.default;
const sql = postgres(databaseUrl, {
  max: 1,
  connect_timeout: 30,
  idle_timeout: 5,
});

try {
  await sql.begin(async (transaction) => {
    await transaction`
      create temporary table bootstrap_canary_proof (
        id text primary key,
        payload text not null
      )
    `;
    await transaction`
      insert into bootstrap_canary_proof (id, payload)
      values ('synthetic-preview-row', 'no-production-data')
    `;
    const rows = await transaction<
      { id: string; payload: string }[]
    >`select id, payload from bootstrap_canary_proof`;
    if (
      rows.length !== 1 ||
      rows[0]?.id !== "synthetic-preview-row" ||
      rows[0]?.payload !== "no-production-data"
    ) {
      throw new Error("Neon preview read/write verification returned unexpected data");
    }
  });
  console.log("Neon preview read/write smoke passed with synthetic data.");
} finally {
  await sql.end({ timeout: 5 });
}
