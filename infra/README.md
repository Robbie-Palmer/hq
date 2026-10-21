# Infrastructure

This directory groups independently stateful Terraform root modules. The
directory itself is organisational and is not a Terraform root.

| Root | Responsibility | Lifecycle |
| --- | --- | --- |
| [`account-foundation/`](account-foundation/README.md) | Provider administrative containers and delivery boundaries | Security-sensitive account administration |
| [`bootstrap/`](bootstrap/README.md) | Foundational IAM and GitHub identity trust | Rare, security-sensitive changes |
| [`cloudflare-access/`](cloudflare-access/README.md) | Shared Zero Trust organization, identity, and Access policy | Reviewed identity and access changes |
| [`public-platform/`](public-platform/README.md) | Cloudflare, Neon, PostHog, Pages, DNS, and public service infrastructure | Production and preview service changes |
| [`remote-development/`](remote-development/README.md) | Remote agent-development infrastructure | Development-host provisioning and recovery |
| [`work-graph/`](work-graph/README.md) | Work Graph service and workload-specific Access resources | Production service changes |

Each root must use its own Terraform Cloud workspace and state. Do not couple
plans or applies across roots. Run root-specific tasks through mise, for example:

```bash
mise run //infra/public-platform:plan
mise run //infra/cloudflare-access:plan
mise run //infra/bootstrap:plan
```

Provider credentials remain in Doppler and are injected only into the root that
requires them.
