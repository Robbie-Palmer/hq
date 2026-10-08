# Drizzle PostgreSQL

Shared runtime wiring for applications that use Drizzle with postgres.js.

The package selects a Cloudflare Hyperdrive connection before a direct
`DATABASE_URL`, disables named prepared statements for Hyperdrive compatibility,
constructs a schema-typed Drizzle client, and closes the underlying postgres.js
client.

Application packages still own their schemas, migrations, missing-connection
errors, and cleanup logging. `finance-tax-monitor` uses this package now.
Migrating the equivalent connection code in `recipe-db` is a separate change so
this refactor does not alter recipe API or ingestion behavior.
