import {
  injectTraceContext,
  SpanKind,
  traceCarrierFromHeaders,
  traceCarrierFromSpan,
  withPostHogSpan,
  type PostHogObservabilityEnv,
  type TraceCarrier,
} from "observability";

export type AuthProxyRoutingEnv = {
  RECIPE_API_PREVIEW_ORIGIN_TEMPLATE?: string;
  CF_PAGES_HOST?: string;
};

export type RecipeApiProxyEnv = AuthProxyRoutingEnv &
  PostHogObservabilityEnv & {
    RECIPE_API_URL?: string;
  };

export type RecipeApiProxyContext = {
  request: Request;
  env: RecipeApiProxyEnv;
  waitUntil?: (promise: Promise<unknown>) => void;
  data?: {
    posthogTraceCarrier?: TraceCarrier;
  };
};

export function proxyLeaf(
  segment: string,
  label: string,
  description: string,
): (context: RecipeApiProxyContext) => Promise<Response> {
  const pagesPrefix = `/api/${segment}`;
  const workerPrefix = `/${segment}`;

  return (context) =>
    proxyRecipeApiRequest(
      context,
      `${description} are available on the canonical PR preview URL only`,
      label,
      (path) =>
        path === pagesPrefix || path.startsWith(`${pagesPrefix}/`)
          ? `${workerPrefix}${path.slice(pagesPrefix.length)}`
          : "",
    );
}

const MAX_PROXY_PATH_LENGTH = 2_048;
const ENCODED_PATH_OCTET = /%[0-9a-f]{2}/i;

function isUnsafePathSegment(segment: string): boolean {
  const decoded = decodeURIComponent(segment);
  return (
    decoded === "." ||
    decoded === ".." ||
    decoded.includes("/") ||
    decoded.includes("\\") ||
    decoded.includes("\0") ||
    // A residual encoded byte means the input was nested-encoded. Reject it
    // instead of repeatedly decoding attacker-controlled input.
    ENCODED_PATH_OCTET.test(decoded)
  );
}

function resolveDestinationPath(
  pathname: string,
  rewritePath?: (path: string) => string,
): string | null {
  const destinationPath = rewritePath?.(pathname) ?? pathname;
  if (
    !destinationPath.startsWith("/") ||
    destinationPath.length > MAX_PROXY_PATH_LENGTH
  )
    return null;

  try {
    const segments = destinationPath.split("/");
    const hasEmptyMiddleSegment = segments.slice(1, -1).includes("");
    const hasUnsafeSegment = segments.some(isUnsafePathSegment);
    return hasEmptyMiddleSegment || hasUnsafeSegment ? null : destinationPath;
  } catch {
    return null;
  }
}

const FORWARDED_REQUEST_HEADERS = [
  "accept",
  "authorization",
  "cf-access-jwt-assertion",
  "cf-connecting-ip",
  "content-type",
  "cookie",
  "idempotency-key",
  "origin",
  "traceparent",
  "tracestate",
  "referer",
  "sec-websocket-protocol",
  "user-agent",
  "upgrade",
  "x-posthog-distinct-id",
  "x-posthog-session-id",
  "x-forwarded-for",
] as const;

export function previewApiBase(
  requestURL: URL,
  env: AuthProxyRoutingEnv,
): string | null | undefined {
  if (!env.CF_PAGES_HOST || !env.RECIPE_API_PREVIEW_ORIGIN_TEMPLATE) {
    return undefined;
  }

  const pagesHost = env.CF_PAGES_HOST.toLowerCase();
  const requestHost = requestURL.hostname.toLowerCase();
  if (requestHost === pagesHost || !requestHost.endsWith(`.${pagesHost}`)) {
    return undefined;
  }

  const alias = requestHost.slice(0, -(pagesHost.length + 1));
  const match = /^pr-(\d+)$/.exec(alias);
  const prNumber = match?.[1];
  if (!prNumber) return null;

  const candidate = env.RECIPE_API_PREVIEW_ORIGIN_TEMPLATE.replace(
    "{pr}",
    prNumber,
  );
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

function logProxyRequest(
  logLabel: string | undefined,
  request: Request,
  path: string,
  destination: string,
): void {
  if (!logLabel) return;
  console.log(
    JSON.stringify({
      message: `${logLabel} proxy request`,
      method: request.method,
      path,
      destination,
    }),
  );
}

function logProxyFailure(logLabel: string | undefined, error: unknown): void {
  if (!logLabel) return;
  console.error(
    JSON.stringify({
      message: `${logLabel} proxy request failed`,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
}

function logProxyResponse(
  logLabel: string | undefined,
  response: Response,
): void {
  if (!logLabel) return;
  console.log(
    JSON.stringify({
      message: `${logLabel} proxy response`,
      status: response.status,
    }),
  );
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing function predates the complexity limit; new violations remain prohibited.
export async function proxyRecipeApiRequest(
  context: RecipeApiProxyContext,
  invalidPreviewMessage: string,
  logLabel?: string,
  rewritePath?: (path: string) => string,
): Promise<Response> {
  const url = new URL(context.request.url);
  const previewBase = previewApiBase(url, context.env);
  if (previewBase === null) {
    return Response.json({ error: invalidPreviewMessage }, { status: 503 });
  }

  const apiBase = previewBase || context.env.RECIPE_API_URL;
  if (!apiBase) {
    return Response.json(
      { error: "Recipe API URL is not configured" },
      { status: 503 },
    );
  }

  const destinationPath = resolveDestinationPath(url.pathname, rewritePath);
  if (!destinationPath) {
    return Response.json({ error: "Invalid API path" }, { status: 400 });
  }

  let destinationUrl: URL;
  try {
    destinationUrl = new URL(apiBase);
  } catch {
    return Response.json({ error: "Invalid Recipe API URL" }, { status: 503 });
  }
  if (destinationUrl.protocol !== "https:") {
    return Response.json(
      { error: "Recipe API URL must use HTTPS" },
      { status: 503 },
    );
  }
  destinationUrl.pathname = destinationPath;
  destinationUrl.search = url.search;
  const destination = destinationUrl.toString();
  const headers = new Headers();
  const isWebSocketUpgrade =
    context.request.method === "GET" &&
    context.request.headers.get("upgrade")?.toLowerCase() === "websocket";
  for (const name of FORWARDED_REQUEST_HEADERS) {
    if (
      !isWebSocketUpgrade &&
      (name === "upgrade" || name === "sec-websocket-protocol")
    ) {
      continue;
    }
    const value = context.request.headers.get(name);
    if (value) headers.set(name, value);
  }

  logProxyRequest(
    logLabel,
    context.request,
    url.pathname,
    `${apiBase}${destinationPath}`,
  );

  const body = ["GET", "HEAD"].includes(context.request.method)
    ? undefined
    : await context.request.arrayBuffer();

  let response: Response;
  try {
    response = await withPostHogSpan(
      {
        env: context.env,
        serviceName: "recipe-pages",
        spanName: `HTTP ${context.request.method} recipe-api`,
        kind: SpanKind.CLIENT,
        traceCarrier:
          context.data?.posthogTraceCarrier ??
          traceCarrierFromHeaders(context.request.headers),
        attributes: {
          "http.request.method": context.request.method,
          "server.address": destinationUrl.hostname,
          "url.path": destinationPath,
        },
        waitUntil: context.waitUntil
          ? {
              waitUntil: (promise) => context.waitUntil?.(promise),
            }
          : undefined,
      },
      async (span) =>
        fetch(
          new Request(destination, {
            method: context.request.method,
            headers: injectTraceContext(
              headers,
              traceCarrierFromSpan(span),
            ),
            body,
            redirect: "manual",
          }),
        ),
    );
  } catch (error) {
    logProxyFailure(logLabel, error);
    return Response.json(
      { error: "Failed to reach the recipe API" },
      { status: 502 },
    );
  }

  logProxyResponse(logLabel, response);

  return response;
}
