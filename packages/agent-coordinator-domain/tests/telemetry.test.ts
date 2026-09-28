import { ROOT_CONTEXT, trace } from "@opentelemetry/api";
import { SeverityNumber } from "@opentelemetry/api-logs";
import {
  InMemoryLogRecordExporter,
  LoggerProvider,
  SimpleLogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import { afterEach, describe, expect, it } from "vitest";

import {
  EXECUTION_TELEMETRY_SCOPE,
  ExecutionTelemetryEventSchema,
  ExecutionTelemetryRecorder,
  TelemetryConflictError,
  executionTelemetryMetrics,
  queryExecutionTelemetry,
  toPublicWorkEvidence,
  type ExecutionTelemetryEvent,
} from "../src";

const common = {
  schemaVersion: 1 as const,
  recordType: "execution-telemetry" as const,
  occurredAt: "2026-09-28T07:00:00.000Z",
  workItemId: "work:telemetry",
  leaseId: "641da305-0f50-4c15-a080-81c5d687c0ab",
  leaseEpoch: 3,
  sessionId: "session:primary",
  policy: { policyId: "policy:personal", revision: 7 },
  adapter: { adapterId: "adapter:openrouter", adapterVersion: "1.4.0" },
  accountClass: "account:metered-personal",
  route: { kind: "api-gateway" as const, routeId: "route:openrouter" },
};

const decision: ExecutionTelemetryEvent = {
  ...common,
  eventId: "0d4c85e9-413a-4eb0-83ed-5feb7a6502c6",
  eventType: "routing-decision",
  decisionId: "decision:primary",
  decision: "selected",
  reason: "Best eligible adapter under policy revision 7.",
};

const request: ExecutionTelemetryEvent = {
  ...common,
  eventId: "4afeb22f-12ab-4691-bc63-92f005576801",
  occurredAt: "2026-09-28T07:01:00.000Z",
  eventType: "provider-request",
  requestId: "request:provider-1",
  providerId: "anthropic",
  modelId: "claude-sonnet",
  quota: {
    state: "near-limit",
    observedAt: "2026-09-28T07:00:59.000Z",
    remaining: 12,
    unit: "requests",
    resetsAt: "2026-09-28T08:00:00.000Z",
  },
  funding: "metered",
  cost: { currency: "USD", amount: 0.42 },
  outcome: "completed",
};

type Harness = ReturnType<typeof createHarness>;
const providers: LoggerProvider[] = [];

function createHarness() {
  const exporter = new InMemoryLogRecordExporter();
  const provider = new LoggerProvider({
    processors: [new SimpleLogRecordProcessor({ exporter })],
  });
  providers.push(provider);
  return {
    exporter,
    recorder: new ExecutionTelemetryRecorder(
      provider.getLogger(EXECUTION_TELEMETRY_SCOPE),
    ),
  };
}

function records(harness: Harness) {
  return harness.exporter.getFinishedLogRecords();
}

afterEach(async () => {
  await Promise.all(providers.splice(0).map((provider) => provider.shutdown()));
});

describe("private execution telemetry", () => {
  it("validates attribution and rejects unknown credential fields", () => {
    expect(ExecutionTelemetryEventSchema.parse(request)).toEqual(request);
    expect(
      ExecutionTelemetryEventSchema.safeParse({
        ...request,
        apiKey: "should-never-be-exported",
      }).success,
    ).toBe(false);
    expect(
      ExecutionTelemetryEventSchema.safeParse({ ...request, cost: null }).success,
    ).toBe(false);
  });

  it("exports a named OTel event with domain and GenAI attributes", () => {
    const harness = createHarness();
    harness.recorder.record(request);

    expect(records(harness)).toHaveLength(1);
    expect(records(harness)[0]).toMatchObject({
      eventName: "agent_coordinator.provider.request",
      severityNumber: SeverityNumber.INFO,
      instrumentationScope: { name: EXECUTION_TELEMETRY_SCOPE },
      attributes: {
        "agent_coordinator.event.id": request.eventId,
        "agent_coordinator.work_item.id": request.workItemId,
        "agent_coordinator.lease.id": request.leaseId,
        "agent_coordinator.lease.epoch": request.leaseEpoch,
        "agent_coordinator.session.id": request.sessionId,
        "agent_coordinator.request.id": request.requestId,
        "gen_ai.provider.name": request.providerId,
        "gen_ai.request.model": request.modelId,
        "agent_coordinator.cost.amount": request.cost?.amount,
      },
    });
  });

  it("associates emitted events with an active trace context", () => {
    const harness = createHarness();
    const spanContext = {
      traceId: "0af7651916cd43dd8448eb211c80319c",
      spanId: "b7ad6b7169203331",
      traceFlags: 1,
    };
    const context = trace.setSpanContext(ROOT_CONTEXT, spanContext);

    harness.recorder.record(decision, context);

    expect(records(harness)[0]?.spanContext).toEqual(spanContext);
  });

  it("reconstructs routing and request events in occurrence order", () => {
    const harness = createHarness();
    harness.recorder.record(request);
    harness.recorder.record(decision);

    expect(
      queryExecutionTelemetry(records(harness), {
        sessionId: common.sessionId,
      }),
    ).toEqual([decision, request]);
  });

  it("deduplicates identical exported retries by event ID", () => {
    const harness = createHarness();
    harness.recorder.record(request);
    harness.recorder.record(request);

    expect(records(harness)).toHaveLength(2);
    expect(queryExecutionTelemetry(records(harness))).toEqual([request]);
    expect(executionTelemetryMetrics(records(harness)).costByCurrency).toEqual({
      USD: 0.42,
    });
  });

  it("rejects conflicting records with the same event ID", () => {
    const harness = createHarness();
    harness.recorder.record(request);
    harness.recorder.record({
      ...request,
      cost: { currency: "USD", amount: 99 },
    });

    expect(() => queryExecutionTelemetry(records(harness))).toThrow(
      TelemetryConflictError,
    );
  });

  it("exports failures at error severity with attributable reasons", () => {
    const harness = createHarness();
    const failed: ExecutionTelemetryEvent = {
      ...request,
      eventId: "69b4315d-2896-42c1-89fc-a7083cf522d2",
      requestId: "request:failed",
      outcome: "failed",
      failureReason: "provider timeout",
    };
    harness.recorder.record(failed);

    expect(records(harness)[0]).toMatchObject({
      severityNumber: SeverityNumber.ERROR,
      attributes: {
        "agent_coordinator.request.id": "request:failed",
        "agent_coordinator.outcome": "failed",
        "agent_coordinator.failure.reason": "provider timeout",
        "error.type": "provider_request_failed",
      },
    });
    expect(queryExecutionTelemetry(records(harness))).toEqual([failed]);
  });

  it("calculates outcome, wait, handoff, intervention, and cost metrics", () => {
    const harness = createHarness();
    const events: ExecutionTelemetryEvent[] = [
      request,
      {
        ...common,
        eventId: "49774ba2-4e21-4d04-90e6-cb7a30448331",
        eventType: "session-outcome",
        outcome: "reassigned",
      },
      {
        ...common,
        eventId: "ed4ff9bf-da36-4602-9789-997088df84bf",
        sessionId: "session:completed",
        eventType: "session-outcome",
        outcome: "completed",
      },
      {
        ...common,
        eventId: "26a740c1-56b4-4ca5-848a-eb3355048b46",
        sessionId: "session:abandoned",
        eventType: "session-outcome",
        outcome: "abandoned",
      },
      {
        ...common,
        eventId: "64a51615-b6fb-416d-aebe-2f66ff7bfb08",
        sessionId: "session:failed",
        eventType: "session-outcome",
        outcome: "failed",
        reason: "Worker exited before checkpointing.",
      },
      {
        ...common,
        eventId: "a33dd178-1f4e-4767-8a9a-c37146c32d1c",
        eventType: "wait",
        waitId: "wait:quota-reset",
        durationMs: 45_000,
        reason: "Waiting for supported capacity.",
      },
      {
        ...common,
        eventId: "750ac11c-f37d-4ffd-902d-2ac199f85669",
        eventType: "handoff",
        successorSessionId: "session:successor",
        reason: "Native client quota exhausted.",
      },
      {
        ...common,
        eventId: "fcf55c38-78ea-472f-bb26-8a2a28e2c9f4",
        eventType: "intervention",
        interventionId: "intervention:manual-review",
        outcome: "requested",
        reason: "Owner approval is required.",
      },
    ];
    for (const event of events) harness.recorder.record(event);

    expect(executionTelemetryMetrics(records(harness))).toEqual({
      completions: 1,
      abandonments: 1,
      reassignments: 1,
      failures: 1,
      waits: 1,
      waitDurationMs: 45_000,
      handoffs: 1,
      interventions: 1,
      costByCurrency: { USD: 0.42 },
    });
  });

  it("redacts secret-shaped text before export", () => {
    const harness = createHarness();
    harness.recorder.record({
      ...decision,
      reason: "authorization: Bearer secret-token",
    });

    const encoded = JSON.stringify(records(harness)[0]?.attributes);
    expect(encoded).not.toContain("secret-token");
    expect(queryExecutionTelemetry(records(harness))[0]).toMatchObject({
      reason: "authorization: Bearer [REDACTED]",
    });
  });

  it("keeps private attributes out of public Work Graph evidence", () => {
    const publicEvidence = toPublicWorkEvidence(request);
    expect(publicEvidence).toEqual({
      schemaVersion: 1,
      recordType: "coordinator-work-evidence",
      evidenceId: request.eventId,
      occurredAt: request.occurredAt,
      workItemId: request.workItemId,
      leaseId: request.leaseId,
      leaseEpoch: request.leaseEpoch,
      adapterId: request.adapter.adapterId,
      adapterVersion: request.adapter.adapterVersion,
      kind: "provider-request",
      outcome: "completed",
    });
    const encoded = JSON.stringify(publicEvidence);
    for (const privateValue of [
      common.sessionId,
      common.accountClass,
      common.route.routeId,
      request.providerId,
      request.modelId,
      "near-limit",
      "0.42",
    ]) {
      expect(encoded).not.toContain(privateValue);
    }
  });
});
