# Worker adapter runtime

`WorkerAdapterRuntime` is the session boundary between Agent Coordinator and a
provider client. It discovers availability, starts or resumes a session, keeps
the session identity stable, and exposes checkpoint, quota, cost, stop, and
failure signals.

The runtime checks `AuthenticationAllowlist` before availability discovery and
again before every launch or resume. Each entry names the provider, route type,
account class, documentation or written approval, review time, and enabled
state. Disabling an entry blocks new processes immediately. Running sessions
keep their existing identity so the coordinator can checkpoint and stop them.

## Native clients

`codexNativeClientDefinition` and `claudeCodeNativeClientDefinition` describe
the unmodified Codex and Claude Code commands. `createNodeNativeProcessLauncher`
starts them without a shell. The child receives only a short list of ordinary
process variables such as `HOME`, `PATH`, and locale settings. API keys, OAuth
values, cookies, and session tokens are not copied into the child environment.
The native executable reads its own account-owner login from its supported
credential store.

Native output and checkpoints redact bearer tokens, key-shaped values, and
secret-named fields before the adapter returns them. A checkpoint can retain a
provider session identifier for the documented resume command. Treat that
identifier as private operational data even when it is not a credential.

## OpenRouter

`createOpenRouterAdapter` accepts a transport that owns the API credential. The
coordinator never receives that credential. Every request reserves a maximum
cost before the transport runs. Concurrent reservations count against the same
session budget, so a request that could exceed the budget fails before an API
call.

The transport must enforce the supplied `maximumCostUsd` and return the actual
metered cost, provider, and model. The adapter attaches those fields to the
request ID and stable session ID. This keeps model or provider fallback inside
one API-funded session while preserving cost attribution.
