# Authenticated preview tests

These Playwright tests run against a deployed pull-request preview. Each test
gets fresh browser contexts, while API setup puts shared preview data into a
known state before the browser assertions begin. Cleanup restores any data the
test changes, so a retry or a later workflow run does not inherit half-finished
state.

The Agent Auth test registers an agent, approves its delegated capabilities
through the real settings UI, reads seeded private data, and revokes the agent.
Agent calls use a separate browser context with no Better Auth user session.
The pantry tests use two isolated browser contexts so the household owner and
member have separate sessions. Each test changes a different pantry item, so
the files can run in parallel. The recipe PWA tests wait for a controlled page
reload and verify both private caches before disabling the network.

The preview deployment pipeline separately runs a direct Worker smoke test for
the realtime protocol, including the event resource, revision, operation ID,
and change kind. Keeping those checks out of this suite avoids making browser
QA the only evidence that the backend fan-out works.

The Agent Auth test leaves a revoked test agent and host in the disposable
preview database. The pantry and household-equipment tests restore the records
they change. The PWA tests only change browser-local storage and network
emulation. Do not point this suite at production.

## Run

Run the suite with the canonical preview URL and inject the preview-only
Cloudflare Access service-token credentials from Doppler:

```sh
PREVIEW_SITE_URL=https://pr-123.example.pages.dev \
doppler run --project personal-site --config dev_agent -- \
  mise //ui:test:e2e:preview
```

The mise task installs the required Chromium build when needed.

PRs with a backend preview run this suite from a trusted follow-up workflow
after both the isolated backend and canonical Pages frontend finish deploying.
The workflow checks out the PR's merge base, so it uses trusted default-branch
tests that match the contracts inherited by that PR. The PR code runs only
inside the browser at the preview origin. The test process receives only the
preview Access credentials from the scoped `preview-agent-access` GitHub
environment. A failed run uploads screenshots and DOM snapshots for seven days.
Traces stay on the ephemeral runner because they can contain authentication
cookies.

Remote agent runtimes that already inject `dev_agent` can run the mise task
directly with only `PREVIEW_SITE_URL` set. Local T3 Code agents use the explicit
`doppler run` form above.

The suite validates that the URL is the canonical PR alias for the configured
Pages host. It sends the Access credentials only on an exact-origin priming
request; subsequent page and WebSocket requests use the resulting Access
cookie, so the service-token headers cannot accompany third-party requests.

The preview must have its backend enabled and seeded preview scenarios. The
suite is not part of the generic UI check because it requires a deployed,
authenticated, mutable preview environment.
