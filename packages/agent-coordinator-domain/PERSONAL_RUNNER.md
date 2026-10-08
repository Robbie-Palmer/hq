# Personal Codex runner

The repository includes a local advisory runner that proposes ready Work Graph
tickets and starts Codex only after a separate confirmation.

Create the private configuration:

```bash
mise //:agent-coordinator -- init
```

Edit `.agent-coordinator/config.json`. Give every ChatGPT subscription a unique
label, actor ID, and `codexHome`. Authenticate each credential root separately:

```bash
CODEX_HOME="$HOME/.codex-primary" codex login
CODEX_HOME="$HOME/.codex-secondary" codex login
```

Ask for a proposal. This checks login and usable Codex capacity, then writes a
local proposal without changing Work Graph:

```bash
mise //:agent-coordinator -- propose --profile primary
```

Review the printed ticket, rationale, exclusions, and claim effect. Claim the
exact proposal and launch Codex with its bounded Work Graph context:

```bash
mise //:agent-coordinator -- confirm --profile primary
```

Profile selection is always explicit. The runner never copies credentials or
automatically changes accounts. A quota or client failure writes a durable Work
Graph checkpoint and stops. After its lease becomes stale, resume it with an
explicitly chosen profile:

```bash
mise //:agent-coordinator -- resume --ticket <ticket-id> --profile primary
```

The same profile must resume its Codex thread. Cross-profile resume after a
limit and automatic account rollover are intentionally disabled. You can still
choose any configured profile before proposing a new ticket. OpenRouter is not
part of this runner.
