import posthog, { type CaptureResult } from "posthog-js";

const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;

// Browsers raise these as window ErrorEvents when a ResizeObserver callback
// changes the layout it just measured. The browser recovers on the next frame,
// so they are noise that would otherwise sit in error tracking next to real
// faults with no stack to act on.
const BROWSER_NOISE_MESSAGES = [
  "ResizeObserver loop completed with undelivered notifications",
  "ResizeObserver loop limit exceeded",
];

function isBrowserNoise(event: CaptureResult): boolean {
  const exceptions: unknown = event.properties?.$exception_list;
  if (!Array.isArray(exceptions)) return false;
  return exceptions.some(({ value }: { value?: unknown }) =>
    BROWSER_NOISE_MESSAGES.some(
      (message) => typeof value === "string" && value.startsWith(message),
    ),
  );
}

// URL schemes a browser uses to hide or tag code it injected into the page:
// Safari's mask for injected scripts, plus the three extension schemes. An
// exception whose frames all come from one of these is thrown by an extension
// or a host webview, not by our bundle.
const INJECTED_SCRIPT_SCHEMES = [
  "webkit-masked-url://",
  "safari-extension://",
  "chrome-extension://",
  "moz-extension://",
];

function isInjectedScriptException(event: CaptureResult): boolean {
  const exceptions = event.properties?.$exception_list;
  if (!Array.isArray(exceptions)) return false;

  const frames = exceptions.flatMap(
    (exception) => exception?.stacktrace?.frames ?? [],
  );
  if (frames.length === 0) return false;

  return frames.every(
    (frame) =>
      typeof frame?.filename === "string" &&
      INJECTED_SCRIPT_SCHEMES.some((scheme) =>
        frame.filename.startsWith(scheme),
      ),
  );
}

// Drop unactionable exceptions before they reach Error Tracking: browser engine
// quirks, and exceptions thrown entirely by injected third-party code.
function dropNoiseExceptions(
  event: CaptureResult | null,
): CaptureResult | null {
  if (event?.event !== "$exception") return event;
  return isBrowserNoise(event) || isInjectedScriptException(event)
    ? null
    : event;
}

function dropPrivatePlannerEvents(
  event: CaptureResult | null,
): CaptureResult | null {
  if (window.location.pathname.startsWith("/wedding-planner")) return null;
  return dropNoiseExceptions(event);
}

function setIdentityHeader(
  headers: Headers,
  name: string,
  identity: () => string,
): void {
  try {
    const value = identity();
    if (value) headers.set(name, value);
  } catch {
    // Correlation is best-effort and must never break the application request.
  }
}

if (posthogKey) {
  posthog.init(posthogKey, {
    api_host: "/ingest",
    ui_host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
    defaults: "2025-11-30",
    // Enables capturing unhandled exceptions via Error Tracking
    capture_exceptions: true,
    // Filters out unactionable exception noise
    before_send: dropPrivatePlannerEvents,
    // Turn on debug in development mode
    debug: process.env.NODE_ENV === "development",
  });

  // Attach PostHog identity to same-origin API requests so backend OTLP logs
  // can link directly to the person and session replay that produced them.
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const requestUrl = new URL(
      input instanceof Request ? input.url : input.toString(),
      window.location.origin,
    );
    if (
      requestUrl.origin !== window.location.origin ||
      !requestUrl.pathname.startsWith("/api/")
    ) {
      return originalFetch(input, init);
    }

    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    setIdentityHeader(headers, "x-posthog-distinct-id", () =>
      posthog.get_distinct_id(),
    );
    setIdentityHeader(headers, "x-posthog-session-id", () =>
      posthog.get_session_id(),
    );

    return originalFetch(input, { ...init, headers });
  };
}
