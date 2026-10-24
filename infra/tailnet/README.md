# Tailnet infrastructure

This Terraform root owns the Tailscale policy file and global DNS settings for
the `hq-tailnet` workspace. The initial root defines the provider, private input
boundary, and policy structure. It does not import or change the live tailnet.

## Ownership

Terraform owns tailnet-wide authorization policy and global DNS configuration.
NixOS and Ansible continue to own client installation, device enrollment,
requested tags, host-local settings, and `tailscale serve`. This root must not
manage auth keys or use broad device data sources to discover private addresses.

The policy resource, current policy values, tests, and imports arrive in the
baseline change. Do not add `tailscale_acl` until that change can represent the
effective policy and prove a no-change plan after import.

## Private values

Local stateful commands run through Doppler project `homelab`:

| Mode | Default config | Access |
| --- | --- | --- |
| Plan and import | `prd_tailnet_infra_plan` | Terraform workspace plus read-only Tailscale API access |
| Apply | `prd_tailnet_infra` | Terraform workspace plus narrowly scoped policy and DNS write access |

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
mise run //infra/tailnet:plan
mise run //infra/tailnet:import -- tailscale_acl.tailnet acl
TAILNET_APPLY_CONFIRM='apply hq-tailnet' mise run //infra/tailnet:apply
```

`validate`, TFLint, and the script tests need no tailnet credentials. `plan`
writes the ignored `.planfile`. `apply` requires that saved file and the exact
confirmation value shown above. Never apply this bootstrap alone. Wait for the
baseline ticket to add the imported resource and produce a reviewed no-change
plan.
