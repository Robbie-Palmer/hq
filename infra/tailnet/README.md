# Tailnet infrastructure

This Terraform root owns the Tailscale policy file and global DNS settings for
the `hq-tailnet` workspace. The baseline mirrors the live policy, adds policy
and SSH regression tests, and keeps private identities and addresses outside
Git.

## Ownership

Terraform owns tailnet-wide authorization policy and global DNS configuration.
NixOS and Ansible continue to own client installation, device enrollment,
requested tags, host-local settings, and `tailscale serve`. This root must not
manage auth keys or use broad device data sources to discover private addresses.

The baseline preserves the existing permissive network grants and restricted
SSH rules. Authorization hardening belongs in a follow-up change after this
baseline is imported and reviewed.

## Private values

Local stateful commands run through Doppler project `homelab`:

| Mode | Default config | Access |
| --- | --- | --- |
| Values | `prd_tailnet_values` | Private policy and DNS substitutions only |
| Plan and import | `prd_tailnet_values_infra_plan` | Inherits values and adds Terraform workspace plus read-only Tailscale API access |
| Apply | `prd_tailnet_values_infra` | Inherits values and adds narrowly scoped policy and DNS write access |

The plan credential has `policy_file:read`, `dns:read`, `devices:core:read`,
and posture read access only. The apply credential adds policy and DNS writes
plus the required device-core read and posture prerequisite. It has no auth-key,
user-administration, device-core write, route, or unrelated scope.

The wrapper reads the standard provider variables
`TAILSCALE_OAUTH_CLIENT_ID`, `TAILSCALE_OAUTH_CLIENT_SECRET`, and
`TAILSCALE_TAILNET`. It maps only these root-owned prefixes into sensitive
Terraform maps:

| Doppler name | Terraform map |
| --- | --- |
| `TAILNET_USER_LOGIN_<ROLE>` | `var.user_logins["<role>"]` |
| `TAILNET_PRIVATE_ADDRESS_<PURPOSE>` | `var.private_addresses["<purpose>"]` |

The wrapper lowercases map keys. Store every login or address as a separate
masked Doppler value so GitHub can mask an individual value if a provider error
includes it. Do not commit real logins, private addresses, credentials, or a
rendered policy.

Local plan, import, and apply commands refuse to run without the Doppler CLI.
CI may inject the same values through a protected GitHub environment.

## Commands

Run Terraform through the root's mise tasks:

```bash
mise run //infra/tailnet:format
mise run //infra/tailnet:validate
mise run //infra/tailnet:lint:tflint
mise run //infra/tailnet:test
mise run //infra/tailnet:validate:policy
mise run //infra/tailnet:import:baseline
mise run //infra/tailnet:plan:refresh-only
mise run //infra/tailnet:plan
mise run //infra/tailnet:plan:drift
mise run //infra/tailnet:import -- tailscale_acl.tailnet acl
TAILNET_APPLY_CONFIRM='apply hq-tailnet' mise run //infra/tailnet:apply
mise run //infra/tailnet:credentials:sync
```

`validate`, TFLint, and the script tests need no tailnet credentials.
`validate:policy` uses read-only API access to validate the rendered policy and
run its tests without changing the tailnet. A normal `plan` runs it first.
`import:baseline` is idempotent and imports both live resources before the
first normal plan. `plan:refresh-only` proves that the imported state can be
refreshed without changing the tailnet. `plan` writes the ignored `.planfile`.
The baseline plan may add aliases and regression tests, but it must not change
the effective grants, tag ownership, SSH authorization, or DNS behavior.
`apply` requires that saved file and the exact confirmation value shown above.

## Delivery

Pull requests always run secretless formatting, validation, lint, and script
tests. A second same-repository job waits for approval on
`production-tailnet-infra-plan` before branch code receives private values and
the read-only credential. Fork pull requests cannot start that job.

The drift workflow runs from `main` every six hours with the read-only
credential and no reviewer gate. It opens or updates one issue with a link to
the protected run when Terraform detects drift, and closes that issue after a
clean plan. It never posts plan output. Drift and apply share a non-cancelling
concurrency group, so a drift plan waits for an active apply instead of reading
the tailnet while Terraform is changing it.

Apply is manual, runs only from `main`, and waits for approval on
`production-tailnet-infra`. The workflow deletes any stale plan, creates a
fresh plan with the write credential, applies that plan, and removes the local
file even when an earlier step fails. Saved plans and rendered policy are never
uploaded or posted to pull requests.
