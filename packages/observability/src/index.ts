import {
  propagation,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  trace,
  type Attributes,
  type Context,
  type Span,
} from "@opentelemetry/api";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-proto";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  LoggerProvider,
  SimpleLogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import {
  BasicTracerProvider,
  BatchSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import {
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
  ATTR_SERVICE_NAME,
} from "@opentelemetry/semantic-conventions";

const DEFAULT_OTLP_BASE_URL = "https://eu.i.posthog.com";

export type PostHogObservabilityEnv = {
  POSTHOG_KEY?: string;
  POSTHOG_OTLP_BASE_URL?: string;
  DEPLOYMENT_ENV?: string;
};

export type TraceCarrier = {
  traceparent: string;
  tracestate?: string;
};

export type TraceIdentity = {
  posthogDistinctId?: string;
  sessionId?: string;
};

type WaitUntilContext = {
  waitUntil(promise: Promise<unknown>): void;
};

type TelemetryState = {
  serviceName: string;
  traceProvider: BasicTracerProvider;
  logProvider: LoggerProvider;
};

let telemetryState: TelemetryState | undefined;
let globalsRegistered = false;

const headerGetter = {
  get(carrier: Headers, key: string): string | undefined {
    return carrier.get(key) ?? undefined;
  },
  keys(carrier: Headers): string[] {
    return Array.from(carrier.keys());
  },
};

const recordGetter = {
  get(carrier: TraceCarrier, key: string): string | undefined {
    if (key === "traceparent") return carrier.traceparent;
    if (key === "tracestate") return carrier.tracestate;
    return undefined;
  },
  keys(carrier: TraceCarrier): string[] {
    return carrier.tracestate
      ? ["traceparent", "tracestate"]
      : ["traceparent"];
  },
};

function normalizedBaseUrl(env: PostHogObservabilityEnv): string {
  const baseUrl = env.POSTHOG_OTLP_BASE_URL || DEFAULT_OTLP_BASE_URL;
  const url = new URL(baseUrl);
  const hasOnlyTrailingSlashes = Array.from(url.pathname).every(
    (character) => character === "/",
  );
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !hasOnlyTrailingSlashes ||
    url.search ||
    url.hash
  ) {
    throw new Error("POSTHOG_OTLP_BASE_URL must be an HTTPS origin");
  }
  return url.origin;
}

function registerGlobals(
  traceProvider: BasicTracerProvider,
  logProvider: LoggerProvider,
): void {
  if (globalsRegistered) return;

  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  trace.setGlobalTracerProvider(traceProvider);
  logs.setGlobalLoggerProvider(logProvider);
  globalsRegistered = true;
}

function getTelemetry(
  env: PostHogObservabilityEnv,
  serviceName: string,
): TelemetryState | undefined {
  const projectToken = env.POSTHOG_KEY?.trim();
  if (!projectToken) return undefined;

  if (telemetryState) {
    if (telemetryState.serviceName !== serviceName) {
      throw new Error(
        `OpenTelemetry already initialized for ${telemetryState.serviceName}; cannot reinitialize it for ${serviceName}`,
      );
    }
    return telemetryState;
  }

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: serviceName,
    [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]:
      env.DEPLOYMENT_ENV || "production",
  });
  const headers = { Authorization: `Bearer ${projectToken}` };
  const baseUrl = normalizedBaseUrl(env);

  const traceProvider = new BasicTracerProvider({
    resource,
    spanProcessors: [
      new BatchSpanProcessor(
        new OTLPTraceExporter({
          url: `${baseUrl}/i/v1/traces`,
          headers,
        }),
      ),
    ],
  });
  const logProvider = new LoggerProvider({
    resource,
    processors: [
      new SimpleLogRecordProcessor({
        exporter: new OTLPLogExporter({
          url: `${baseUrl}/i/v1/logs`,
          headers,
        }),
      }),
    ],
  });

  telemetryState = { serviceName, traceProvider, logProvider };
  registerGlobals(traceProvider, logProvider);
  return telemetryState;
}

function identityAttributes(identity: TraceIdentity): Attributes {
  return {
    posthogDistinctId: identity.posthogDistinctId,
    sessionId: identity.sessionId,
  };
}

function emitLog(
  state: TelemetryState,
  severityNumber: SeverityNumber,
  severityText: string,
  body: string,
  attributes: Attributes,
  logContext: Context,
): void {
  state.logProvider.getLogger(state.serviceName).emit({
    severityNumber,
    severityText,
    body,
    attributes,
    context: logContext,
  });
}

function recordFailure(
  span: Span,
  state: TelemetryState,
  error: unknown,
  attributes: Attributes,
  logContext: Context,
): void {
  const message = error instanceof Error ? error.message : String(error);
  const errorType =
    error instanceof Error && error.name ? error.name : "UnknownError";
  span.recordException(error instanceof Error ? error : new Error(message));
  span.setStatus({ code: SpanStatusCode.ERROR, message });
  emitLog(
    state,
    SeverityNumber.ERROR,
    "ERROR",
    message,
    {
      ...attributes,
      "error.type": errorType,
      "error.message": message,
    },
    logContext,
  );
}

function reportTelemetryFailure(stage: string, error: unknown): void {
  try {
    console.error(
      JSON.stringify({
        message: "PostHog telemetry failure",
        stage,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  } catch {
    // Telemetry reporting must remain fail-open, including its fallback log.
  }
}

function safelyRecordTelemetry(stage: string, operation: () => void): void {
  try {
    operation();
  } catch (error) {
    reportTelemetryFailure(stage, error);
  }
}

async function flushTelemetry(state: TelemetryState): Promise<void> {
  const results = await Promise.allSettled([
    Promise.resolve().then(() => state.traceProvider.forceFlush()),
    Promise.resolve().then(() => state.logProvider.forceFlush()),
  ]);
  for (const [index, result] of results.entries()) {
    if (result.status === "rejected") {
      reportTelemetryFailure(
        index === 0 ? "flush traces" : "flush logs",
        result.reason,
      );
    }
  }
}

async function flushAfter(
  state: TelemetryState,
  waitUntil?: WaitUntilContext,
): Promise<void> {
  const flush = flushTelemetry(state);
  if (waitUntil) {
    try {
      waitUntil.waitUntil(flush);
    } catch (error) {
      reportTelemetryFailure("schedule flush", error);
    }
  } else {
    await flush;
  }
}

async function runWithoutTelemetry<T>(
  serviceName: string,
  operation: (span: Span) => Promise<T> | T,
): Promise<T> {
  const span = trace.getTracer(serviceName).startSpan("noop");
  try {
    return await operation(span);
  } finally {
    safelyRecordTelemetry("end fallback span", () => span.end());
  }
}

function safelyGetTelemetry(
  env: PostHogObservabilityEnv,
  serviceName: string,
): TelemetryState | undefined {
  try {
    return getTelemetry(env, serviceName);
  } catch (error) {
    reportTelemetryFailure("initialize", error);
    return undefined;
  }
}

export function traceIdentityFromHeaders(headers: Headers): TraceIdentity {
  return {
    posthogDistinctId: headers.get("x-posthog-distinct-id") ?? undefined,
    sessionId: headers.get("x-posthog-session-id") ?? undefined,
  };
}

export function traceCarrierFromHeaders(
  headers: Headers,
): TraceCarrier | undefined {
  const traceparent = headers.get("traceparent");
  if (!traceparent) return undefined;

  const tracestate = headers.get("tracestate");
  return {
    traceparent,
    ...(tracestate ? { tracestate } : {}),
  };
}

export function injectTraceContext(
  headers: Headers,
  traceCarrier?: TraceCarrier,
): Headers {
  if (!traceCarrier) return headers;

  const carrierContext = propagation.extract(
    ROOT_CONTEXT,
    traceCarrier,
    recordGetter,
  );
  propagation.inject(carrierContext, headers, {
    set(carrier, key, value) {
      carrier.set(key, value);
    },
  });
  return headers;
}

export function traceCarrierFromSpan(span: Span): TraceCarrier | undefined {
  const carrier: Partial<TraceCarrier> = {};
  propagation.inject(trace.setSpan(ROOT_CONTEXT, span), carrier, {
    set(target, key, value) {
      if (key === "traceparent") target.traceparent = value;
      if (key === "tracestate") target.tracestate = value;
    },
  });
  return carrier.traceparent
    ? {
        traceparent: carrier.traceparent,
        ...(carrier.tracestate ? { tracestate: carrier.tracestate } : {}),
      }
    : undefined;
}

export async function withPostHogRequest<T extends Response>(
  options: {
    env: PostHogObservabilityEnv;
    serviceName: string;
    spanName: string;
    request: Request;
    waitUntil?: WaitUntilContext;
    attributes?: Attributes;
  },
  operation: (span: Span) => Promise<T> | T,
): Promise<T> {
  const state = safelyGetTelemetry(options.env, options.serviceName);
  if (!state) {
    return runWithoutTelemetry(options.serviceName, operation);
  }

  let attributes: Attributes;
  let span: Span;
  let spanContext: Context;
  try {
    const identity = traceIdentityFromHeaders(options.request.headers);
    attributes = {
      "http.request.method": options.request.method,
      "url.path": new URL(options.request.url).pathname,
      ...identityAttributes(identity),
      ...options.attributes,
    };
    const parentContext = propagation.extract(
      ROOT_CONTEXT,
      options.request.headers,
      headerGetter,
    );
    const tracer = state.traceProvider.getTracer(options.serviceName);
    span = tracer.startSpan(
      options.spanName,
      { kind: SpanKind.SERVER, attributes },
      parentContext,
    );
    spanContext = trace.setSpan(parentContext, span);
  } catch (error) {
    reportTelemetryFailure("start request span", error);
    return runWithoutTelemetry(options.serviceName, operation);
  }

  try {
    let response: T;
    try {
      response = await operation(span);
    } catch (error) {
      safelyRecordTelemetry("record request failure", () =>
        recordFailure(span, state, error, attributes, spanContext),
      );
      throw error;
    }

    safelyRecordTelemetry("record request success", () => {
      span.setAttribute("http.response.status_code", response.status);
      if (response.status >= 500) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: `HTTP ${response.status}`,
        });
      }
      emitLog(
        state,
        response.status >= 500 ? SeverityNumber.ERROR : SeverityNumber.INFO,
        response.status >= 500 ? "ERROR" : "INFO",
        `${options.request.method} ${new URL(options.request.url).pathname}`,
        { ...attributes, "http.response.status_code": response.status },
        spanContext,
      );
    });
    return response;
  } finally {
    safelyRecordTelemetry("end request span", () => span.end());
    try {
      await flushAfter(state, options.waitUntil);
    } catch (error) {
      reportTelemetryFailure("flush request telemetry", error);
    }
  }
}

export async function withPostHogSpan<T>(
  options: {
    env: PostHogObservabilityEnv;
    serviceName: string;
    spanName: string;
    traceCarrier?: TraceCarrier;
    kind?: SpanKind;
    waitUntil?: WaitUntilContext;
    attributes?: Attributes;
    /**
     * Set false only when an enclosing request or workflow span will flush.
     * @default true
     */
    flush?: boolean;
  },
  operation: (span: Span) => Promise<T> | T,
): Promise<T> {
  const state = safelyGetTelemetry(options.env, options.serviceName);
  if (!state) {
    return runWithoutTelemetry(options.serviceName, operation);
  }

  let span: Span;
  let spanContext: Context;
  try {
    const parentContext = options.traceCarrier
      ? propagation.extract(ROOT_CONTEXT, options.traceCarrier, recordGetter)
      : ROOT_CONTEXT;
    const tracer = state.traceProvider.getTracer(options.serviceName);
    span = tracer.startSpan(
      options.spanName,
      {
        kind: options.kind ?? SpanKind.INTERNAL,
        attributes: options.attributes,
      },
      parentContext,
    );
    spanContext = trace.setSpan(parentContext, span);
  } catch (error) {
    reportTelemetryFailure("start span", error);
    return runWithoutTelemetry(options.serviceName, operation);
  }

  try {
    let result: T;
    try {
      result = await operation(span);
    } catch (error) {
      safelyRecordTelemetry("record span failure", () =>
        recordFailure(
          span,
          state,
          error,
          options.attributes ?? {},
          spanContext,
        ),
      );
      throw error;
    }

    safelyRecordTelemetry("record span success", () =>
      emitLog(
        state,
        SeverityNumber.INFO,
        "INFO",
        options.spanName,
        options.attributes ?? {},
        spanContext,
      ),
    );
    return result;
  } finally {
    safelyRecordTelemetry("end span", () => span.end());
    if (options.flush !== false) {
      try {
        await flushAfter(state, options.waitUntil);
      } catch (error) {
        reportTelemetryFailure("flush span telemetry", error);
      }
    }
  }
}

export { SpanKind };
