import { describe, expect, it, vi } from "vitest";
import {
  injectTraceContext,
  SpanKind,
  traceCarrierFromHeaders,
  traceCarrierFromSpan,
  traceIdentityFromHeaders,
  withPostHogRequest,
  withPostHogSpan,
} from "../src";

const exported = vi.hoisted(() => ({
  spans: [] as Array<Record<string, unknown>>,
  logs: [] as Array<Record<string, unknown>>,
  spanExportBatchSizes: [] as number[],
  traceExporterOptions: [] as Array<Record<string, unknown>>,
  logExporterOptions: [] as Array<Record<string, unknown>>,
  throwTraceExporterOnInit: false,
  rejectTraceExporterExport: false,
}));

vi.mock("@opentelemetry/exporter-trace-otlp-proto", () => ({
  OTLPTraceExporter: class {
    constructor(options: Record<string, unknown>) {
      if (exported.throwTraceExporterOnInit) {
        throw new Error("trace exporter setup failed");
      }
      exported.traceExporterOptions.push(options);
    }

    export(
      spans: Array<Record<string, unknown>>,
      callback: (result: { code: number; error?: Error }) => void,
    ) {
      if (exported.rejectTraceExporterExport) {
        callback({ code: 1, error: new Error("trace exporter failed") });
        return;
      }
      exported.spanExportBatchSizes.push(spans.length);
      exported.spans.push(...spans);
      callback({ code: 0 });
    }

    forceFlush() {
      return Promise.resolve();
    }

    shutdown() {
      return Promise.resolve();
    }
  },
}));

vi.mock("@opentelemetry/exporter-logs-otlp-proto", () => ({
  OTLPLogExporter: class {
    constructor(options: Record<string, unknown>) {
      exported.logExporterOptions.push(options);
    }

    export(
      logs: Array<Record<string, unknown>>,
      callback: (result: { code: number }) => void,
    ) {
      exported.logs.push(...logs);
      callback({ code: 0 });
    }

    forceFlush() {
      return Promise.resolve();
    }

    shutdown() {
      return Promise.resolve();
    }
  },
}));

const enabledEnv = {
  POSTHOG_KEY: " test-token ",
  POSTHOG_OTLP_BASE_URL: "https://telemetry.example.test////",
  DEPLOYMENT_ENV: "test",
};

describe("traceIdentityFromHeaders", () => {
  it("reads PostHog person and session correlation headers", () => {
    const headers = new Headers({
      "x-posthog-distinct-id": "person-123",
      "x-posthog-session-id": "session-456",
    });

    expect(traceIdentityFromHeaders(headers)).toEqual({
      posthogDistinctId: "person-123",
      sessionId: "session-456",
    });
  });

  it("omits missing correlation values", () => {
    expect(traceIdentityFromHeaders(new Headers())).toEqual({
      posthogDistinctId: undefined,
      sessionId: undefined,
    });
  });
});

describe("disabled telemetry", () => {
  it("runs request and span operations without exporting", async () => {
    const requestResponse = await withPostHogRequest(
      {
        env: {},
        serviceName: "test-service",
        spanName: "GET /disabled",
        request: new Request("https://example.test/disabled"),
      },
      async (span) => {
        expect(traceCarrierFromSpan(span)).toBeUndefined();
        return new Response("ok");
      },
    );
    const spanResult = await withPostHogSpan(
      {
        env: {},
        serviceName: "test-service",
        spanName: "disabled child",
      },
      async (span) => traceCarrierFromSpan(span),
    );

    expect(requestResponse.status).toBe(200);
    expect(spanResult).toBeUndefined();
    expect(exported.spans).toHaveLength(0);
    expect(exported.logs).toHaveLength(0);
  });
});

describe("enabled telemetry", () => {
  it("exports a correlated server span and log", async () => {
    const deferred: Promise<unknown>[] = [];
    const request = new Request("https://example.test/recipes?ignored=true", {
      headers: {
        traceparent:
          "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0be902b7-01",
        "x-posthog-distinct-id": "person-123",
        "x-posthog-session-id": "session-456",
      },
    });

    const response = await withPostHogRequest(
      {
        env: enabledEnv,
        serviceName: "test-service",
        spanName: "GET /recipes",
        request,
        waitUntil: {
          waitUntil(promise) {
            deferred.push(promise);
          },
        },
        attributes: { "test.attribute": "value" },
      },
      async (span) => {
        const carrier = traceCarrierFromSpan(span);
        expect(carrier?.traceparent).toContain(
          "4bf92f3577b34da6a3ce929d0e0e4736",
        );
        const headers = injectTraceContext(new Headers(), carrier);
        expect(headers.get("traceparent")).toBe(carrier?.traceparent);
        return Response.json({ ok: true }, { status: 201 });
      },
    );
    await Promise.all(deferred);

    expect(response.status).toBe(201);
    expect(exported.traceExporterOptions).toEqual([
      {
        url: "https://telemetry.example.test/i/v1/traces",
        headers: { Authorization: "Bearer test-token" },
      },
    ]);
    expect(exported.logExporterOptions).toEqual([
      {
        url: "https://telemetry.example.test/i/v1/logs",
        headers: { Authorization: "Bearer test-token" },
      },
    ]);

    const span = exported.spans.at(-1);
    expect(span).toMatchObject({
      name: "GET /recipes",
      kind: SpanKind.SERVER,
      attributes: {
        "http.request.method": "GET",
        "http.response.status_code": 201,
        "url.path": "/recipes",
        posthogDistinctId: "person-123",
        sessionId: "session-456",
        "test.attribute": "value",
      },
    });
    expect(exported.logs.at(-1)).toMatchObject({
      body: "GET /recipes",
      attributes: {
        "http.response.status_code": 201,
        "url.path": "/recipes",
      },
    });
  });

  it("marks server errors and thrown failures", async () => {
    const serverError = await withPostHogRequest(
      {
        env: enabledEnv,
        serviceName: "test-service",
        spanName: "GET /unavailable",
        request: new Request("https://example.test/unavailable"),
      },
      async () => new Response("unavailable", { status: 503 }),
    );

    expect(serverError.status).toBe(503);
    expect(exported.spans.at(-1)?.status).toMatchObject({
      code: 2,
      message: "HTTP 503",
    });

    await expect(
      withPostHogRequest(
        {
          env: enabledEnv,
          serviceName: "test-service",
          spanName: "GET /failure",
          request: new Request("https://example.test/failure"),
        },
        async () => {
          throw new TypeError("request failed");
        },
      ),
    ).rejects.toThrow("request failed");

    expect(exported.spans.at(-1)?.status).toMatchObject({
      code: 2,
      message: "request failed",
    });
    expect(exported.logs.at(-1)).toMatchObject({
      body: "request failed",
      attributes: {
        "error.type": "TypeError",
        "error.message": "request failed",
      },
    });
  });

  it("parents child spans explicitly and records failures", async () => {
    const parentCarrier = {
      traceparent:
        "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0be902b7-01",
      tracestate: "vendor=value",
    };

    const result = await withPostHogSpan(
      {
        env: enabledEnv,
        serviceName: "test-service",
        spanName: "workflow.start",
        traceCarrier: parentCarrier,
        kind: SpanKind.PRODUCER,
        attributes: { "recipe.import.job_id": "job-123" },
      },
      async (span) => traceCarrierFromSpan(span),
    );

    expect(result?.traceparent).toContain(
      "4bf92f3577b34da6a3ce929d0e0e4736",
    );
    expect(result?.tracestate).toBe("vendor=value");
    expect(exported.spans.at(-1)).toMatchObject({
      name: "workflow.start",
      kind: SpanKind.PRODUCER,
      attributes: { "recipe.import.job_id": "job-123" },
    });

    await expect(
      withPostHogSpan(
        {
          env: enabledEnv,
          serviceName: "test-service",
          spanName: "workflow.failure",
        },
        async () => {
          throw "non-error failure";
        },
      ),
    ).rejects.toBe("non-error failure");
    expect(exported.logs.at(-1)).toMatchObject({
      body: "non-error failure",
      attributes: {
        "error.type": "UnknownError",
        "error.message": "non-error failure",
      },
    });
  });

  it("exports a successful internal span without optional attributes", async () => {
    await expect(
      withPostHogSpan(
        {
          env: enabledEnv,
          serviceName: "test-service",
          spanName: "workflow.complete",
        },
        async () => "complete",
      ),
    ).resolves.toBe("complete");

    expect(exported.logs.at(-1)).toMatchObject({
      body: "workflow.complete",
      attributes: {},
    });
  });

  it("batches child spans until the explicit flush boundary", async () => {
    const spanCount = exported.spans.length;
    const logCount = exported.logs.length;

    await withPostHogSpan(
      {
        env: enabledEnv,
        serviceName: "test-service",
        spanName: "request.child",
        flush: false,
      },
      async () => undefined,
    );

    expect(exported.spans).toHaveLength(spanCount);
    expect(exported.logs).toHaveLength(logCount + 1);

    await withPostHogSpan(
      {
        env: enabledEnv,
        serviceName: "test-service",
        spanName: "request.boundary",
      },
      async () => undefined,
    );

    expect(exported.spans).toHaveLength(spanCount + 2);
    expect(exported.logs).toHaveLength(logCount + 2);
    expect(exported.spanExportBatchSizes.at(-1)).toBe(2);
  });

  it("keeps operations successful and reports exporter failures", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    exported.rejectTraceExporterExport = true;

    await expect(
      withPostHogSpan(
        {
          env: enabledEnv,
          serviceName: "test-service",
          spanName: "workflow.flush-failure",
        },
        async () => "application result",
      ),
    ).resolves.toBe("application result");

    exported.rejectTraceExporterExport = false;
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('"stage":"flush traces"'),
    );
    consoleError.mockRestore();
  });

  it("can defer flushing child spans to their request boundary", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    exported.rejectTraceExporterExport = true;

    await expect(
      withPostHogSpan(
        {
          env: enabledEnv,
          serviceName: "test-service",
          spanName: "request.child",
          flush: false,
        },
        async () => "application result",
      ),
    ).resolves.toBe("application result");

    exported.rejectTraceExporterExport = false;
    expect(consoleError).not.toHaveBeenCalledWith(
      expect.stringContaining('"stage":"flush traces"'),
    );
    consoleError.mockRestore();
  });

  it("fails open if a bundle requests a different service name", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await expect(
      withPostHogSpan(
        {
          env: enabledEnv,
          serviceName: "other-service",
          spanName: "invalid",
        },
        async () => undefined,
      ),
    ).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('"stage":"initialize"'),
    );
    consoleError.mockRestore();
  });

  it("uses PostHog's EU endpoint and production environment defaults", async () => {
    vi.resetModules();
    const freshObservability = await import("../src");

    await freshObservability.withPostHogSpan(
      {
        env: { POSTHOG_KEY: "default-token" },
        serviceName: "default-service",
        spanName: "default span",
      },
      async () => undefined,
    );

    expect(exported.traceExporterOptions.at(-1)).toMatchObject({
      url: "https://eu.i.posthog.com/i/v1/traces",
    });
    expect(exported.logExporterOptions.at(-1)).toMatchObject({
      url: "https://eu.i.posthog.com/i/v1/logs",
    });
  });

  it("runs the application operation once when telemetry setup fails", async () => {
    vi.resetModules();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    exported.throwTraceExporterOnInit = true;
    const operation = vi.fn(async () => new Response("ok"));
    const freshObservability = await import("../src");

    const response = await freshObservability.withPostHogRequest(
      {
        env: enabledEnv,
        serviceName: "setup-failure-service",
        spanName: "GET /setup-failure",
        request: new Request("https://example.test/setup-failure"),
      },
      operation,
    );

    exported.throwTraceExporterOnInit = false;
    expect(response.status).toBe(200);
    expect(operation).toHaveBeenCalledOnce();
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('"stage":"initialize"'),
    );
    consoleError.mockRestore();
  });

  it("uses URL parsing to reject a non-origin OTLP base URL", async () => {
    vi.resetModules();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const traceExporterCount = exported.traceExporterOptions.length;
    const freshObservability = await import("../src");

    await expect(
      freshObservability.withPostHogSpan(
        {
          env: {
            ...enabledEnv,
            POSTHOG_OTLP_BASE_URL:
              "https://telemetry.example.test/unexpected-path",
          },
          serviceName: "invalid-origin-service",
          spanName: "invalid origin",
        },
        async () => "application result",
      ),
    ).resolves.toBe("application result");

    expect(exported.traceExporterOptions).toHaveLength(traceExporterCount);
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining(
        "POSTHOG_OTLP_BASE_URL must be an HTTPS origin",
      ),
    );
    consoleError.mockRestore();
  });
});

describe("traceCarrierFromHeaders", () => {
  it("copies W3C trace context for explicit propagation", () => {
    const headers = new Headers({
      traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0be902b7-01",
      tracestate: "vendor=value",
    });

    expect(traceCarrierFromHeaders(headers)).toEqual({
      traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0be902b7-01",
      tracestate: "vendor=value",
    });
  });

  it("omits an absent trace context", () => {
    expect(traceCarrierFromHeaders(new Headers())).toBeUndefined();
  });

  it("supports trace context without optional tracestate", () => {
    const traceparent =
      "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0be902b7-01";
    const carrier = traceCarrierFromHeaders(new Headers({ traceparent }));
    const headers = new Headers();

    expect(carrier).toEqual({ traceparent });
    expect(injectTraceContext(headers)).toBe(headers);
  });
});
