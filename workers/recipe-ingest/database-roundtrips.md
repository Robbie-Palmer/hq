# Recipe database round-trip measurements

These measurements use the disposable PostgreSQL 17 instance started by
`mise //workers/recipe-ingest:test:integration`. The baseline is commit
`40c46026` with measurement-only instrumentation applied. Each query count
includes Postgres.js's type-discovery query when it opens a backend connection.

## Recipe-ingest stages

The recipe-ingest measurements did not justify a behavior change. Every durable
persistence stage already uses one database client and closes it after the step.
The artifact stages issue one manifest insert and one job update.

| Stage | Before connections | Before queries | After connections | After queries | CI maximum |
| --- | ---: | ---: | ---: | ---: | --- |
| start | 1 | 2 | 1 | 2 | 1 connection, 2 queries |
| persist-extract | 1 | 3 | 1 | 3 | 1 connection, 3 queries |
| persist-normalize | 1 | 3 | 1 | 3 | 1 connection, 3 queries |
| persist-canonicalize | 1 | 3 | 1 | 3 | 1 connection, 3 queries |
| finalize | 1 | 3 | 1 | 3 | 1 connection, 3 queries |
| failure cleanup | 1 | 2 | 1 | 2 | 1 connection, 2 queries |

## Linked-email synchronization

The fixture synchronizes two new verified GitHub aliases. The old path ran a
read and a write for each alias in parallel. The parallel work caused the
Postgres.js client to open two backend connections. The new path sends one bulk
upsert with an ownership condition on conflicts.

| Path | Before | After | Change | CI maximum |
| --- | ---: | ---: | ---: | ---: |
| Backend connections | 2 | 1 | 50% fewer | 1 |
| Queries, including connection startup | 6 | 2 | 67% fewer | 2 |
| Application statements | 4 | 1 | 75% fewer | 1 |

The integration suite also runs the bulk upsert twice, verifies that an alias
owned by another user does not move, and forces a foreign-key failure to prove
that PostgreSQL rolls back the complete statement. Existing `withDb` tests
continue to cover client cleanup after success and failure.
