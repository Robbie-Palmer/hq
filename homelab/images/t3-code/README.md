# t3-code runtime image

This image packages the headless t3-code server and its supported coding-agent
CLIs, mise, Doppler, and the native libraries required by headless browser
tests. Every base image uses a tag and immutable digest. npm and mise install
from committed lockfiles with artifact integrity data. The deployment uses the
release tag `0.0.38-agent-tools-16`. Increment that release suffix for every
image change.
After the first registry publish, replacing the tag in the manifests with its
registry digest adds another immutability check.

Runtime Debian packages and their exact Bookworm versions are declared in
`bindep.txt`. The image translates bindep's exact-version syntax directly to
apt syntax, so the final image does not need a Python and bindep installation
solely to resolve a Debian-only package list. Renovate uses its Debian
datasource to propose grouped updates to these pins.

The process runs as UID/GID `2000:2000`. Kubernetes mounts the encrypted data
volume at `/data`; t3 state and provider authentication live under
`/data/home`, while repositories and worktrees live under `/data/workspaces`.
Neither the image nor its build context contains credentials.

The deployment enables the OpenCode and Grok providers in T3's persisted
settings and adds a `codex2` instance backed by a separate `auth.json`. It
defaults new Codex threads and every Codex provider catalog to GPT-5.6-Sol with
high reasoning while keeping the other cached models available. The
remote-development overlay declares OpenRouter's GLM 5.3 Flash
model through `OPENCODE_CONFIG_CONTENT`. Doppler injects
`OPENROUTER_API_KEY`; the key never appears in the OpenCode configuration or
image. Grok's device-login state lives under `/data/home/.grok`.

The image installs the portable `packages/agent-auth-mcp` package. The
remote-development bootstrap registers it as Codex's `recipe-agent` MCP server.
It reuses the newest matching active connection before starting a new approval
flow. A
constrained capability request always starts the normal connection flow because
the pinned client does not persist enough constraint detail to prove a match.
Its state stays under
`/data/home/.codex/agent-auth/recipes`, and Codex forwards the
`AGENT_AUTH_ENCRYPTION_KEY` supplied by the remote K3s deployment. The home
overlay does not enable this MCP entry.

Run repository tasks with `mise run`. Mise installs versions declared by each
repository on first use and keeps them under `/data/home/.local/share/mise`.
For this repository, run `mise install --include-task-tools --monorepo` and
`mise run //:install` after cloning. The second command installs the locked
pnpm dependencies and activates the Husky hooks. Playwright downloads its
version-matched Chromium build into the persistent cache when
`mise run //ui:test:e2e:install` runs. System Chromium remains available to
Puppeteer and Lighthouse through `PUPPETEER_EXECUTABLE_PATH`.

The image also includes the pinned Docker CLI, Buildx, and Compose plugins.
The remote operator workspace connects them to its own rootless Docker daemon
through TCP on the pod's loopback interface. Docker data has a 10 GiB
ephemeral limit and survives a daemon-container restart, but not a pod
replacement. The daemon does not receive the host container-runtime socket or
any host path, and its API does not listen on the pod network.

Docker's rootless DinD image still needs a privileged container to create its
inner user namespace and relax seccomp, AppArmor, and mount masks. Keep this
exception on the dedicated `docker` sidecar. The T3 container remains
non-root, uses the runtime-default seccomp profile, drops every capability,
and has a read-only root filesystem. Kubernetes Pod Security Admission cannot
exempt one container, so the operator namespace enforces the `privileged`
profile while it continues to audit and warn against `restricted`. The pilot
namespace still enforces `restricted`. This exception is suitable for the
trusted operator workspace, not a hostile-tenant boundary. Do not add the
sidecar to an untrusted workspace without moving that workspace to a VM or a
runtime that supports nested containers without a privileged pod.

Build and inspect it with:

```bash
mise run //homelab:t3-image-build
mise run //homelab:t3-image-check
```

The `t3-code image` GitHub workflow publishes the checked image to GHCR from
`main` with repository-scoped package permission. During first commissioning,
or if GHCR is unavailable, load the checked local image directly into the
remote node with `mise run //homelab:t3-image-load-remote`.

To update the coding-agent CLIs, change `package.json` and refresh its lockfile.
Doppler is pinned in this directory's `mise.toml`; Vale is shared with the
repository through `.config/mise/config.toml`. The monorepo-wide mise bootstrap
version remains in `.github/actions/setup-mise/mise-version`; the image check
requires both the Dockerfile's tagged bootstrap image and this directory's
release-artifact pin to match it. Refresh the corresponding `mise.lock`,
increment the release suffix in the image tasks and manifests, then build and
test it. Renovate's native mise manager updates these tool declarations and
their associated lockfiles. Renovate auto-merges all image dependency updates
after the pull-request image build and runtime checks pass, including major
updates.
After publishing, deploy the new reference with the context-guarded task. A
rollback restores the previous image reference from Git and reapplies the
overlay; neither operation replaces the persistent volume.
