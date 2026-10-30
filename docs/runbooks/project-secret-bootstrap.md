# Project secret and identity bootstrap

Use a versioned bootstrap plan after the bootstrap Terraform state has created
the project's empty Doppler configs and protected GitHub environments. The
plan is separate from the project profile and Terraform variables. It contains
names and routing data, never credential values.

The example at
`infra/project-modules/examples/secret-bootstrap.yaml` records the complete
secret inventory for a small Worker service. Each secret declares:

- its Doppler config and key as the system of record;
- every protected GitHub environment or Worker binding that consumes it;
- the person or team responsible for rotation; and
- whether a human supplies it, the bootstrap generates it, or an installed
  source extension supplies it.

The plan also lists the credentials used to perform the handoff. Give each
Doppler token read/write access to exactly one named config. Declare the token's
environment variable beside that config. The parser rejects one credential
environment variable reused across multiple configs. Limit the GitHub token to
environment-secret administration for the named repository.
The ordinary Cloudflare handoff token needs Workers Scripts Write for the named
account. Token provisioning uses the separate identity described below. Keep
these operator credentials in a supervised shell or a dedicated Doppler config.
They are not project runtime secrets.

## Plan and apply

Inspect the redacted plan first:

```bash
mise //:project:secret-bootstrap:plan -- \
  infra/project-modules/examples/secret-bootstrap.yaml
```

The output names every destination and reports each secret as `waiting`,
`ready`, or `complete`. It does not read the value environment variables.

Complete the provider action, then acknowledge its checkpoint while applying.
For a `manual` source, export the value under `creation.value_env` first. An
extension obtains its value from the provider without an intermediate export:

```bash
mise //:project:secret-bootstrap:apply -- \
  infra/project-modules/examples/secret-bootstrap.yaml \
  --acknowledge create-cloudflare-deploy-token
```

The command passes values to Doppler and GitHub on standard input. Worker
bindings use Cloudflare's HTTPS API. Values do not appear in arguments,
output, the plan, or the resume file. Provider failures report the command or
HTTP status without including a response body.

The default resume file is
`.project-bootstrap/<project-id>.json`. Git ignores this directory. The file
has mode `0600` and contains only the plan digest, acknowledged checkpoint
IDs, and completed secret IDs. A later run skips complete secrets. If a
provider fails midway through one secret, the next run sends that secret to
all destinations again so the copies converge.

## Network and scope controls

The executor accepts only the canonical Doppler, GitHub, and Cloudflare API
origins. It rejects a changed origin before reading or sending a value. The
plan parser also rejects a Doppler config, GitHub environment, or Worker that
is not in the matching identity allowlist.

The built-in `cloudflare-account-token` extension creates
[account-owned API tokens](https://developers.cloudflare.com/api/resources/accounts/subresources/tokens/).
It calls `POST /accounts/{account_id}/tokens`; it never uses the user-owned
`POST /user/tokens` endpoint. Cloudflare's
[token creation guide](https://developers.cloudflare.com/fundamentals/api/how-to/create-via-api/)
requires `Account API Tokens Write`, scoped to the one declared account.
Cloudflare calls the same dashboard permission `Account API Tokens Edit`. Do
not add Workers, DNS, zone, or account-settings permissions to this credential.

Create the first bootstrap token in the Cloudflare dashboard. This human action
is the resumable checkpoint in the plan. Store the value as the masked
`CLOUDFLARE_TOKEN_PROVISIONER_TOKEN` secret in
`cloudflare-token-bootstrap/ops_provisioner`. Store
`CLOUDFLARE_ACCOUNT_ID` unmasked in the same config. The
`production-cloudflare-token-bootstrap` GitHub environment requires review,
blocks administrator bypass, and accepts only `main`.
Routine deployment, Terraform, drift, and application environments do not
receive either value.

Declare this credential under `identities.cloudflare_token_provisioner`. The
ordinary `identities.cloudflare` token remains a different credential for
writing Worker secrets. A bootstrap plan that needs both operations can name
both identities, but neither token receives the other's permissions.

The protected environment also needs the config-scoped Doppler writer tokens
declared by the plan and `GH_BOOTSTRAP_TOKEN`. Create each Doppler token from
the destination config's Access page with read/write access. A single-config
plan may use the legacy `token_env` form, but a multi-config plan must name one
distinct token environment variable per config. Scope the GitHub credential to
secret administration for this repository's environments named by the plan.
Store the Doppler writer tokens masked in
`cloudflare-token-bootstrap/ops_provisioner`, then sync the dedicated config
only after its environment protection has been applied and checked:

```bash
mise //infra/account-foundation:cloudflare-token-bootstrap:credentials:sync
```

## Cloudflare token checks

Declare every downstream permission by its immutable 32-character ID and its
current display name. The plan output shows both, the token name, the account ID
environment variable, and any expiry. It does not contact Cloudflare or read a
credential:

```bash
mise //:project:secret-bootstrap:plan -- path/to/plan.yaml
```

Run the read-only live check before an apply:

```bash
mise //:project:secret-bootstrap:conformance -- path/to/plan.yaml
```

The check uses Cloudflare's account token permission-group, verify, and detail
endpoints. It rejects a bootstrap token unless it is active, has one allow
policy, grants only `Account API Tokens Write`, and names exactly the declared
account resource. It also rejects a downstream permission ID if Cloudflare has
renamed it, marked it unselectable, or does not report it as account-scoped.

The apply repeats those checks, creates the token, and passes the one-time value
straight to the existing Doppler and GitHub stdin adapters. The value is absent
from command arguments, output, the resume file, Terraform configuration,
plans, outputs, and state. API failures report only the operation and HTTP
status. The executor never includes the response body in an error.

Use the `Cloudflare Token Bootstrap` workflow for reviewed remote execution.
Its default `apply: false` run prints only the redacted plan. An apply runs only
from `main`, crosses the protected environment review, performs conformance,
then resumes the named checkpoint.

After the generated credential works from every declared consumer, revoke the
old downstream token. Keep the bootstrap token disabled or revoked between
provisioning sessions when the operating process permits it. Recovery starts
in the Cloudflare owner account: create a replacement account-owned bootstrap
token with the same one permission and account scope, replace the masked
Doppler value, sync the protected environment, run conformance, and resume the
unchanged plan. If token creation succeeded but distribution failed, revoke the
orphan by its reviewed token name before retrying. The resume file deliberately
stores no token ID or value.

### Provisioner rotation and parking

Use
`infra/account-foundation/cloudflare-token-plans/token-provisioner.yaml` to
rotate the account token that can create other account-owned tokens. The plan
uses the config-scoped Doppler writer for
`cloudflare-token-bootstrap/ops_provisioner`; it does not need a writer for any
runtime project.

Before applying, verify that the old provisioner is active and record its token
ID from the Cloudflare verify endpoint. Cloudflare marks Account API Tokens
Write as unselectable through the token API, so the existing provisioner cannot
mint its replacement. The Cloudflare owner must create the replacement in the
dashboard with that one permission and the declared account scope.

In a supervised shell, read the replacement without echoing it, export it as
`NEW_CLOUDFLARE_TOKEN_PROVISIONER_TOKEN`, and apply the reviewed plan with the
`rotate-cloudflare-token-provisioner` checkpoint. The built-in authority
handoff validates the candidate's active status, exact permission, and account
scope before it writes the value to Doppler and GitHub through standard input.
Unset the variable immediately after the command. Start a fresh shell from the
updated Doppler config, run conformance, and only then delete the old token by
its recorded ID.

Park the authority after the last provisioning operation by revoking the active
provisioner token. Leave its revoked value in Doppler and GitHub. Conformance
and apply then fail closed because Cloudflare rejects the credential. To restore
access, the Cloudflare owner creates one account-owned token with only Account
API Tokens Write for the declared account, writes it to the masked Doppler key
through standard input, syncs the protected environment, and runs conformance
before approving another apply. Never pass the token as an argument or print a
provider response body.

Identity-provider consoles often require a consent screen, callback URI, or
human approval. Record that action as a checkpoint and make the issued secret
depend on it. The acknowledgement remains in the resume file, so the next run
continues without repeating completed provider work.
