import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const posthog = vi.hoisted(() => ({
  init: vi.fn(),
  get_distinct_id: vi.fn(() => "person-123"),
  get_session_id: vi.fn(() => "session-456"),
}));

vi.mock("posthog-js", () => ({ default: posthog }));

function exception(message: string) {
  return {
    event: "$exception",
    properties: { $exception_list: [{ type: "Error", value: message }] },
  };
}

describe("PostHog browser instrumentation", () => {
  let originalFetch: typeof window.fetch;

  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    posthog.init.mockClear();
    posthog.get_distinct_id.mockClear();
    posthog.get_session_id.mockClear();
    originalFetch = window.fetch;
  });

  afterEach(() => {
    window.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  it("does not initialize without a project token", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "");

    await import("../instrumentation-client");

    expect(posthog.init).not.toHaveBeenCalled();
  });

  it("adds PostHog identity to same-origin API requests only", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test");
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "https://eu.posthog.com");
    vi.stubEnv("NODE_ENV", "development");
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response("ok"),
    );
    window.fetch = fetchMock as typeof window.fetch;

    await import("../instrumentation-client");

    expect(posthog.init).toHaveBeenCalledWith("phc_test", {
      api_host: "/ingest",
      ui_host: "https://eu.posthog.com",
      defaults: "2025-11-30",
      capture_exceptions: true,
      before_send: expect.any(Function),
      debug: true,
    });

    await window.fetch("/api/recipes", {
      headers: { "x-existing": "value" },
    });
    const apiInit = fetchMock.mock.calls[0]?.[1];
    const apiHeaders = new Headers(apiInit?.headers);
    expect(apiHeaders.get("x-existing")).toBe("value");
    expect(apiHeaders.get("x-posthog-distinct-id")).toBe("person-123");
    expect(apiHeaders.get("x-posthog-session-id")).toBe("session-456");

    await window.fetch("https://example.test/api/recipes");
    expect(fetchMock.mock.calls[1]).toEqual([
      "https://example.test/api/recipes",
      undefined,
    ]);
  });

  it("preserves Request headers and omits unavailable identity values", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test");
    posthog.get_distinct_id.mockReturnValueOnce("");
    posthog.get_session_id.mockReturnValueOnce("");
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response("ok"),
    );
    window.fetch = fetchMock as typeof window.fetch;

    await import("../instrumentation-client");
    await window.fetch(
      new Request(`${window.location.origin}/api/recipes`, {
        headers: { "x-existing": "value" },
      }),
    );

    const apiHeaders = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(apiHeaders.get("x-existing")).toBe("value");
    expect(apiHeaders.has("x-posthog-distinct-id")).toBe(false);
    expect(apiHeaders.has("x-posthog-session-id")).toBe(false);
  });

  it("drops ResizeObserver loop noise before it reaches error tracking", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test");

    await import("../instrumentation-client");
    const beforeSend = posthog.init.mock.calls[0]?.[1]?.before_send;

    expect(
      beforeSend(
        exception(
          "ResizeObserver loop completed with undelivered notifications.",
        ),
      ),
    ).toBeNull();
    expect(
      beforeSend(exception("ResizeObserver loop limit exceeded")),
    ).toBeNull();
  });

  it("keeps real exceptions and every other event", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test");

    await import("../instrumentation-client");
    const beforeSend = posthog.init.mock.calls[0]?.[1]?.before_send;

    const chunkError = exception("Loading chunk 42 failed.");
    expect(beforeSend(chunkError)).toBe(chunkError);

    const pageview = { event: "$pageview", properties: {} };
    expect(beforeSend(pageview)).toBe(pageview);

    const exceptionWithoutList = { event: "$exception", properties: {} };
    expect(beforeSend(exceptionWithoutList)).toBe(exceptionWithoutList);

    expect(beforeSend(null)).toBeNull();
  });

  it("drops all analytics events while the private wedding planner is open", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test");
    await import("../instrumentation-client");
    const beforeSend = posthog.init.mock.calls[0]?.[1]?.before_send;
    const previous = window.location.pathname;
    window.history.pushState({}, "", "/wedding-planner");
    try {
      expect(
        beforeSend({ event: "$autocapture", properties: { text: "guest" } }),
      ).toBeNull();
      expect(
        beforeSend({ event: "$snapshot", properties: { text: "guest" } }),
      ).toBeNull();
      expect(beforeSend(exception("guest-related error"))).toBeNull();
    } finally {
      window.history.replaceState({}, "", previous);
    }
  });

  describe("before_send exception filter", () => {
    type CaptureResult = {
      event: string;
      properties?: Record<string, unknown>;
    };

    async function getBeforeSend() {
      vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test");
      window.fetch = vi.fn(
        async () => new Response("ok"),
      ) as typeof window.fetch;
      await import("../instrumentation-client");
      return posthog.init.mock.calls[0]?.[1]?.before_send as (
        event: CaptureResult | null,
      ) => CaptureResult | null;
    }

    function exceptionEvent(filenames: (string | undefined)[]): CaptureResult {
      return {
        event: "$exception",
        properties: {
          $exception_list: [
            {
              stacktrace: {
                frames: filenames.map((filename) => ({ filename })),
              },
            },
          ],
        },
      };
    }

    it("drops exceptions whose frames all come from masked or extension URLs", async () => {
      const beforeSend = await getBeforeSend();

      for (const scheme of [
        "webkit-masked-url://hidden/",
        "safari-extension://abc/inject.js",
        "chrome-extension://abc/inject.js",
        "moz-extension://abc/inject.js",
      ]) {
        expect(beforeSend(exceptionEvent([scheme, scheme]))).toBeNull();
      }
    });

    it("keeps exceptions with at least one frame from the site bundle", async () => {
      const beforeSend = await getBeforeSend();

      const event = exceptionEvent([
        "webkit-masked-url://hidden/",
        "https://example.test/_next/static/chunk.js",
      ]);
      expect(beforeSend(event)).toBe(event);
    });

    it("keeps exceptions whose frames have no resolvable filename", async () => {
      const beforeSend = await getBeforeSend();

      const event = exceptionEvent([undefined]);
      expect(beforeSend(event)).toBe(event);
    });

    it("keeps exceptions that carry no stack frames", async () => {
      const beforeSend = await getBeforeSend();

      const event = exceptionEvent([]);
      expect(beforeSend(event)).toBe(event);
    });

    it("leaves non-exception events untouched", async () => {
      const beforeSend = await getBeforeSend();

      const event: CaptureResult = { event: "$pageview" };
      expect(beforeSend(event)).toBe(event);
      expect(beforeSend(null)).toBeNull();
    });
  });

  it("keeps API requests working when an identity lookup fails", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test");
    posthog.get_distinct_id.mockImplementationOnce(() => {
      throw new Error("PostHog is not ready");
    });
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response("ok"),
    );
    window.fetch = fetchMock as typeof window.fetch;

    await import("../instrumentation-client");
    const response = await window.fetch("/api/recipes");

    expect(response.status).toBe(200);
    const apiHeaders = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(apiHeaders.has("x-posthog-distinct-id")).toBe(false);
    expect(apiHeaders.get("x-posthog-session-id")).toBe("session-456");
  });
});
