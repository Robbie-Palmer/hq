# Asset Tracker shared-system contract

Status: accepted for the first shared-household implementation

Contract version: 1

Work item: `finance-02-shared-system-contract`

This contract moves Asset Tracker from one browser-owned JSON document to a
household-owned PostgreSQL model and `/api/v1` REST API. The current JSON shape
is a migration input and export format. It is not the server schema.

The machine-readable parts are:

* [`shared-system-schema.sql`](shared-system-schema.sql), the PostgreSQL schema;
* [`shared-system-openapi.yaml`](shared-system-openapi.yaml), the HTTP contract;
  and
* [`verify-shared-system-contract.mjs`](scripts/verify-shared-system-contract.mjs),
  which checks command coverage, required write protections, and schema
  references.

The implementation may split the DDL into Drizzle migrations and generate the
OpenAPI document from route schemas. It must preserve the constraints in these
artifacts.

## Boundaries and identifiers

The household is the tenant and authorization boundary. Every financial
record, plan, source, idempotency result, and calculation belongs to one
household. UUIDs identify server records. URLs carry the household UUID, and
the service checks an active membership before loading any household-owned
record.

Application users, household memberships, and financial entities are separate:

* an application user is an authenticated person;
* a membership grants an application role in one household; and
* a financial entity represents a person, joint pool, business, trust, or
  other owner in the financial model.

An ownership percentage never grants application access. A user may belong to
several households, and a financial entity does not need a login.

Money uses a decimal amount and an ISO 4217 currency code. The first release
accepts `GBP` and `USD`, matching the browser domain. Dates without times are
ISO `YYYY-MM-DD` values. Timestamps are UTC `date-time` values. The database
stores monetary values as `numeric(24,8)` and rates as `numeric(20,12)` rather
than binary floating point.

## Relational model

The SQL contract groups records into six areas.

| Area | Tables | Rule |
| --- | --- | --- |
| Identity and access | `app_user`, `auth_identity`, `user_session`, `household`, `household_membership` | Membership authorizes access. Financial ownership does not. |
| Financial model | `financial_entity`, `financial_account`, `account_ownership` | Accounts and ownership always carry the same household ID. Ownership intervals may not overlap for one entity and account. |
| Sources and temporal facts | `fact_source`, `financial_record` and its typed fact tables | `valid_on` says when a fact applied. `accepted_at` says when the service knew it. Corrections append records and point to the record they replace. |
| Plans | `plan_record` and its typed plan tables | A logical plan has immutable numbered versions. Replacing or deleting it appends a new version. |
| Calculations | `calculation_run`, `calculation_input` | A durable result records the algorithm version, household revision, output, and exact fact and plan versions used. |
| Write control | `household_state`, `idempotency_record`, `local_json_import` | One household revision guards writes. Idempotency records make a committed response replayable. Import records make JSON migration auditable and repeatable. |

`financial_record` is the immutable header for balances, capital flows, income,
transfers, holdings, prices, and exchange rates. A typed child table holds the
fields specific to each kind. A correction uses the same household and record
kind as its target. The service rejects update and delete operations against
accepted facts. A user-visible delete appends a correction with `is_void =
true`.

`plan_record` applies the same append-only rule to assumptions and intentions,
including account revisions, expected returns, recurring flows, planned
expenditure, and household settings. The latest non-deleted version is the
current plan. This is narrower than event sourcing. The service still reads
ordinary relational state and does not reconstruct a household by replaying a
general event stream.

Account ownership is effective-dated domain data. The sum may be less than
100% while an import awaits review, but it must not exceed 100% for an account
on a date. The implementation enforces the sum in the same transaction that
writes ownership rows.

## API shape

All shared endpoints live below `/api/v1`. A session cookie authenticates the
consumer. The household ID remains in the route so authorization checks cannot
depend on client-selected state hidden in a cookie.

`GET /api/v1/households/{householdId}/workspace` is the browser bootstrap read.
It returns one `HouseholdWorkspace` containing the household revision and all
read models currently assembled by `AssetTrackerProvider`: account summaries
and details, net-worth history, contribution and allocation history, transfers,
recurring flows, planned expenditure, income history, cash-flow data, financial
independence and runway results, settings, valuation date, and valuation
issues. `GET /accounts/{accountId}` provides the account detail route without
requiring a full bootstrap.

Successful reads return an `ETag` containing the quoted household revision.
Successful writes return `MutationResult`, which contains the new revision and
the refreshed workspace. This preserves the current browser API's "command in,
new state out" behavior without exposing database rows or adopting the JSON
document as server state.

### Browser command mapping

| Browser API method | HTTP operation |
| --- | --- |
| `load` | `GET /api/v1/households/{householdId}/workspace` |
| `createAccount` | `POST /api/v1/households/{householdId}/accounts` |
| `recordBalance` | `PUT /api/v1/households/{householdId}/accounts/{accountId}/balance-snapshots/{date}` |
| `recordTransfer` | `POST /api/v1/households/{householdId}/transfers` |
| `closeAccount` | `PATCH /api/v1/households/{householdId}/accounts/{accountId}` |
| `clearAccountHistory` | `DELETE /api/v1/households/{householdId}/accounts/{accountId}/history/{historyKind}` |
| `deleteSnapshot` | `DELETE /api/v1/households/{householdId}/accounts/{accountId}/balance-snapshots/{date}` |
| `deleteCapitalFlow` | `DELETE /api/v1/households/{householdId}/accounts/{accountId}/capital-flows/{date}/{flowKind}` |
| `importAccountHistory` | `POST /api/v1/households/{householdId}/account-history-imports` |
| `importIncomeHistory` | `PUT /api/v1/households/{householdId}/income-history` |
| `clearIncomeHistory` | `DELETE /api/v1/households/{householdId}/income-history` |
| `addRecurringFlow` | `POST /api/v1/households/{householdId}/recurring-flows` |
| `deleteRecurringFlow` | `DELETE /api/v1/households/{householdId}/recurring-flows/{flowId}` |
| `addPlannedExpenditure` | `POST /api/v1/households/{householdId}/planned-expenditures` |
| `deletePlannedExpenditure` | `DELETE /api/v1/households/{householdId}/planned-expenditures/{expenditureId}` |
| `materializeFlow` | `POST /api/v1/households/{householdId}/recurring-flows/{flowId}/materializations` |
| `setExpectedReturn` | `PUT /api/v1/households/{householdId}/accounts/{accountId}/expected-returns/{effectiveFrom}` |
| `setAccountLiquidity` | `PATCH /api/v1/households/{householdId}/accounts/{accountId}` |
| `setBaseCurrency`, `setInflation`, `setNetWorthTarget`, `setWithdrawalRate` | `PATCH /api/v1/households/{householdId}/settings` |
| `importData` | validate with `POST /local-json-imports`, then commit with `POST /local-json-imports/{importId}/commits` |
| `clear` | `DELETE /api/v1/households/{householdId}/financial-data` |
| `reset` | Remains a local demo-only command. Shared households use `clear`; the HTTP API does not seed private households with demo records. |

The final row is an intentional compatibility decision. The client must hide
"Reset demo" after it attaches to a shared household. This avoids adding a
production endpoint whose only purpose is to insert public demonstration data
into private storage.

### Validation and errors

The service rejects malformed JSON with `400 MALFORMED_REQUEST` and
schema-valid JSON that breaks domain rules with `422 VALIDATION_FAILED`.
Validation errors identify fields with JSON Pointer paths. Domain examples
include a transfer with no endpoint, a recurring flow with both an amount and
formula, a cross-currency transfer without a received amount, a financial
ownership total above 100%, and a fact dated after an account closed.

Errors use the shared `Error` schema:

```json
{
  "code": "STALE_REVISION",
  "message": "Household state changed since revision 41.",
  "requestId": "01K6...",
  "details": {
    "expectedRevision": 41,
    "currentRevision": 42
  }
}
```

Authentication failures return `401`. A caller without active membership gets
`404`, whether the household or nested record exists or not. This prevents
cross-household enumeration. Role failures inside a known household return
`403`. Missing resources return `404`. Business conflicts return `409`.
Rate limiting returns `429` with `Retry-After`. Unexpected failures return a
content-free `500` error and do not log financial values or user-entered text.

## Write contract

Every `POST`, `PUT`, `PATCH`, and `DELETE` below a household requires:

* `Idempotency-Key`, a UUID generated once for the user's intended command;
* `If-Match`, the quoted revision from the last workspace or mutation response;
  and
* a current authenticated session with a role allowed to perform the command.

The service evaluates a write in this order:

1. Authenticate the session and check active membership.
2. Find the idempotency record by household and key. If it has the same method,
   canonical path, actor, and request hash, replay its stored status, headers,
   and body. If the key names another request, return `409
   IDEMPOTENCY_KEY_REUSED`. If the original request is still running, return
   `409 IDEMPOTENCY_REQUEST_IN_PROGRESS` with `Retry-After`.
3. Lock `household_state`, compare `If-Match`, and return `412
   STALE_REVISION` with both revisions when they differ. A missing header returns
   `428 PRECONDITION_REQUIRED`.
4. Validate domain rules, append facts or plan versions, build the new read
   model, increment the household revision once, and persist the complete
   response in `idempotency_record` in one database transaction.

The service retains committed idempotency responses for at least seven days.
A client that loses the response retries the exact request with the same key
until it receives the original result. A user who edits the command creates a
new key. The client never retries a stale revision by silently replacing
`If-Match`; it refreshes the workspace and asks the user to reconcile the
conflict.

Bulk history imports, materializing a recurring flow, clearing data, and
committing a local JSON import are single transactions. A partial result is
never visible.

## Authorization matrix

Roles attach to household membership. `owner`, `editor`, and `viewer` are
household roles. Operations staff are not household members by default.

| Capability | Owner | Editor | Viewer | Operations admin |
| --- | :---: | :---: | :---: | :---: |
| Read financial data and calculations | Yes | Yes | Yes | No |
| Add or correct facts and plans | Yes | Yes | No | No |
| Import local JSON or account history | Yes | Yes | No | No |
| Export household data | Yes | Yes | Yes | No |
| Invite members or change roles | Yes | No | No | No |
| Remove another member | Yes | No | No | No |
| Delete financial data or the household | Yes, after recent sign-in | No | No | No |
| Change service configuration, inspect health, restore backups | No | No | No | Yes, without application data access |
| Read a household through support tooling | No | No | No | No standing access |

The last owner cannot leave or be removed. Membership changes revoke the
affected user's sessions for that household. Financial ownership has no row in
this matrix because it grants none of these capabilities.

There is no application impersonation or general administrator read role in
version 1. Emergency database access uses the production break-glass procedure,
requires an incident, named approval, a time limit, and an audit record. The
application will not build a quieter path around those controls.

## Authentication decisions

The consumer signs in through Google OIDC using Better Auth, following the
accepted platform default. Version 1 has no application password, so password
reset endpoints do not exist. Google owns credential recovery and multi-factor
authentication. A user links another provider only from a recently
authenticated session. Automatic linking by matching email address is
forbidden.

Better Auth stores opaque sessions in PostgreSQL. The browser receives a
`Secure`, `HttpOnly`, `SameSite=Lax` cookie scoped to the application. Sessions
expire after 30 days and rotate after a successful sign-in. Sensitive owner
operations require an authentication event from the previous 15 minutes.
Sign-out, identity unlinking, membership removal, and suspected compromise
revoke the relevant sessions.

Recovery from a lost Google account stays with Google's recovery process in
version 1. Operations staff cannot reassign an identity or read a household to
work around a failed recovery. A later recovery method needs explicit identity
proof, enrolment, revocation, and account-linking rules before implementation.
This is restrictive, but it is safer than an improvised support bypass for
financial data.

Preview environments remain behind Cloudflare Access. Access authenticates a
preview visitor or test client at the edge; it does not replace the consumer
session or household authorization checks.

## JSON migration and compatibility

Migration has a validation step and a commit step. Validation parses the
uploaded document with the current `AssetTrackerDataSchema`, calculates a
SHA-256 digest, and returns record counts, defaults applied, warnings, and a
short-lived import ID. It writes no financial records. Commit requires the
same digest, an idempotency key, and the expected empty-household revision.

The importer maps the document as follows:

| Local JSON | Shared model |
| --- | --- |
| `accounts` | `financial_account` plus initial `account_plan` version |
| `snapshots` | `financial_record` plus `balance_fact` |
| `capitalFlows` | `financial_record` plus `capital_flow_fact` |
| `incomeHistory` | `financial_record` plus `income_fact` |
| `transfers` | `financial_record` plus `transfer_fact` |
| `recurringFlows` | versioned `recurring_flow_plan` |
| `plannedExpenditures` | versioned `planned_expenditure_plan` |
| `instruments` | `instrument` |
| holding, price, and exchange-rate observations | typed `financial_record` children with their original valid and accepted times |
| `settings` | versioned `household_settings_plan` |

The migration records every local ID in `local_json_import_item`, so repeated
validation and a retried commit cannot duplicate records. Browser observations
that already carry `acceptedAt`, source, and correction links keep them. Older
snapshots and flows receive the import commit time as `accepted_at` and point
to one `legacy_json` source that carries the document digest. The importer does
not invent personal ownership from account names. It creates one household-pool
financial entity, assigns imported accounts to it, and marks those ownership
rows for review.

Before cutover, the client compares server and local counts plus the account,
net-worth, allocation, contribution, and financial-independence read models.
Any mismatch leaves local storage authoritative and leaves the server import
available for inspection or deletion.

During the first shared release, the client keeps the original JSON document
unchanged until a successful server read follows commit. It can then mark that
copy as migrated, but it does not delete it automatically. A feature flag can
return the client to local mode.

Rollback from shared mode freezes server writes, exports the latest effective
facts and plans to `assettracker:data:v1`, validates that export through
`AssetTrackerDataSchema`, and places it in browser storage before switching the
flag. Server data remains intact. Facts that the v1 JSON shape cannot express
block rollback rather than being dropped. The export reports the blocking
record types.

The `/api/v1` contract accepts additive response fields. Clients ignore fields
they do not know. Removing or changing a field, enum value, status code, or
write rule requires `/api/v2` or a proved compatibility migration. Database
migrations expand first, deploy readers and writers second, and remove old
columns only after rollback no longer depends on them.

## Review checklist

Implementation review must show that:

* PostgreSQL can apply the DDL to an empty database;
* the generated implementation contract matches the committed OpenAPI file;
* every browser command above has a route or the documented local-only rule;
* route tests cover idempotent replay, key reuse, uncertain-result retry,
  missing and stale `If-Match`, and cross-household denial;
* database tests reject cross-household foreign keys and preserve corrected
  facts and plan versions;
* calculation tests can reproduce a saved result from its recorded inputs; and
* migration tests compare read models before cutover and prove the rollback
  export parses as `AssetTrackerData`.
