# Finance tax source monitor

This Worker runs a directly scheduled Cloudflare Workflow that checks the GOV.UK
Content API pages governing the reviewed UK employment tax rules. The schedule is
declared on the Workflow binding in `wrangler.toml`; there is no scheduler Worker
or GitHub Actions cache.

## Storage boundary

- Cloudflare Workflows retains step checkpoints, retry backoff, sleeps, and
  short-lived execution results.
- Private R2 stores the exact upstream response and normalized snapshot as gzip
  objects keyed by SHA-256. Object keys are immutable.
- PostgreSQL stores the source registry, last successful check, object manifests,
  compact diffs, and review or activation state.
- Git stores the monitor code, schema, migrations, and small synthetic fixtures.
  It does not store recurring GOV.UK responses.

Each fetch step returns only checksums, R2 keys, response metadata, and dates to
the Workflow engine. Large HTML fields stay in R2. Repeated response bytes do not
create another object or revision. A changed normalized fingerprint creates a
pending `tax_rule_update_review` row. The first observed snapshot also requires
review before it becomes the accepted monitoring baseline.

The monitor never activates tax rules. A reviewer must update the versioned
`finance-tax-rules` dataset, add or amend validation cases, and run:

```sh
mise run //packages/finance-tax-rules:check
```

The Worker has no binding to household records. Requests to GOV.UK contain only
the public source URL and HTTP headers, never salary or household data.

## Checks

```sh
mise run //workers/finance-tax-monitor:check
mise run //workers/finance-tax-monitor:test:coverage
```

`wrangler.toml` contains a non-existent Hyperdrive sentinel so dry-run bundles
remain reproducible. A production deploy must supply `FINANCE_HYPERDRIVE_ID` and
have the private `finance-source-artifacts` R2 bucket provisioned. The separate
finance infrastructure ticket owns those live resources and database migration.
