# Cloudflare Pages Functions

[Cloudflare Pages Functions][pages-functions] run at the edge alongside the
static site. Pages detects and deploys them from this directory with no extra
configuration.

## Functions

### `/api/auth/*` - Recipe Authentication Proxy

**File:** `api/auth/[[path]].ts`

Proxies same-origin Better Auth requests to the recipe API Worker. Keeping the
browser-facing auth URL on `robbiepalmer.me` means OAuth callbacks and session
cookies use the site origin even though the auth handler runs in a separate
Worker. `RECIPE_API_URL` configures the deployed Worker URL.

### `/api/profile/diet` - Recipe Profile Diet Proxy

**File:** `api/profile/diet.ts`

Proxies same-origin diet profile reads and writes to the recipe API Worker so
the browser can use the same session cookies and CSRF origin checks as auth.

### `/api/notifications/*` - Recipe Notifications Proxy

**File:** `api/notifications/[[path]].ts`

Proxies notification archive, read-state, and dismissal requests to the recipe
API Worker using the same-origin session cookie.

### `/api/wedding-playlists/*` - Collaborative wedding playlist

Stores the playlist snapshot and append-only guest events in a dedicated KV
namespace, so concurrent suggestions and votes never overwrite one another.
Guest links use an invite token for suggestions and votes. The private planner
keeps a separate admin token for moderation and syncing. The function hashes
both tokens before storage, keeps guest identifiers out of guest responses, and
uses Cloudflare edge rules plus a per-contributor cap for abuse control.

### `_middleware.ts` - Markdown Content Negotiation

Serves each page's agent-friendly Markdown twin from its canonical URL
when the client requests `Accept: text/markdown`, or has an agent/CLI user
agent without asking for HTML. Browsers are unaffected. Agents can also
fetch Markdown explicitly by appending `.md` to any page URL, or start
from the index at `/llms.txt`.

The root middleware also proxies `/.well-known/agent-configuration` to the
Worker. Cloudflare Pages ignores dot-prefixed directories in `functions/`, so
the canonical Agent Auth discovery route cannot use file-based routing.

### `/ingest/*` - PostHog Reverse Proxy

**File:** `ingest/[[path]].ts`

Proxies analytics requests to PostHog's EU servers. This allows the site to
send analytics through our own domain (`/ingest/*`) rather than directly to
`posthog.com`, which helps avoid ad blockers.

Routes:

- `/ingest/static/*` → `https://eu-assets.i.posthog.com/static/*`
  (JS assets, session recording code)
- `/ingest/*` → `https://eu.i.posthog.com/*` (event ingestion API)

The client-side PostHog initialization in `ui/instrumentation-client.ts` uses
`api_host: "/ingest"` to send requests through this proxy.

**Environment Variables (optional, for testing):**

- `POSTHOG_API_HOST` - Override the API endpoint
  (default: `https://eu.i.posthog.com`)
- `POSTHOG_ASSETS_HOST` - Override the assets endpoint
  (default: `https://eu-assets.i.posthog.com`)

### API distributed tracing

The root middleware creates an OpenTelemetry server span for `/api/*` Pages
Function requests. The API proxy injects W3C `traceparent` and `tracestate`
headers into the request to `recipe-api`, and the browser supplies PostHog
person/session IDs so correlated backend logs can link to session replay.

Pages Functions export OTLP/protobuf traces and logs directly to PostHog using:

- `POSTHOG_KEY` - the `phc_…` project token
- `POSTHOG_OTLP_BASE_URL` - regional ingestion origin
  (default: `https://eu.i.posthog.com`)

## Future Migration

When migrating to Cloudflare Workers (SSR support, subdomain routing), delete
this directory and add equivalent routes in the Worker configuration; the
proxy logic is nearly identical.

[pages-functions]: https://developers.cloudflare.com/pages/functions/
