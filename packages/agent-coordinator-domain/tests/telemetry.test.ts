import { describe, expect, it } from "vitest";

import {
  ExecutionTelemetryEventSchema,
  PrivateExecutionTelemetryLedger,
  TelemetryAccessError,
  TelemetryConflictError,
  toPublicWorkEvidence,
  type ExecutionTelemetryEvent,
  type TelemetryAccessPolicy,
} from "../src";

const accessPolicy: TelemetryAccessPolicy = {
  writerIds: ["service:coordinator"],
  readerIds: ["owner:robbie"],
  administratorIds: ["service:privacy-maintenance"],
  redactAfterDays: 30,
  deleteAfterDays: 90,
};

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
  providerId: "provider:anthropic",
  modelId: "model:claude-sonnet",
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

function ledger(): PrivateExecutionTelemetryLedger {
  return new PrivateExecutionTelemetryLedger(accessPolicy);
}

describe("private execution telemetry", () => {
  it("validates complete attribution and rejects secret-shaped extra fields", () => {
    expect(ExecutionTelemetryEventSchema.parse(request)).toEqual(request);
    expect(
      ExecutionTelemetryEventSchema.safeParse({
        ...request,
        apiKey: "should-never-be-stored",
      }).success,
    ).toBe(false);
    expect(
      ExecutionTelemetryEventSchema.safeParse({
        ...request,
        cost: null,
      }).success,
    ).toBe(false);
  });

  it("reconstructs routing and request events in time order", () => {
    const store = ledger();
    store.append("service:coordinator", request);
    store.append("service:coordinator", decision);
    expect(
      store.query("owner:robbie", { sessionId: common.sessionId }),
    ).toEqual([decision, request]);
  });

  it("keeps private routing, quota, provider, and cost data out of public evidence", () => {
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

  it("enforces write, read, and maintenance access independently", () => {
    const store = ledger();
    expect(() => store.append("actor:intruder", decision)).toThrow(
      TelemetryAccessError,
    );
    store.append("service:coordinator", decision);
    expect(() => store.query("service:coordinator")).toThrow(
      TelemetryAccessError,
    );
    expect(() =>
      store.deleteExpired("owner:robbie", "2027-01-01T00:00:00.000Z"),
    ).toThrow(TelemetryAccessError);
  });

  it("redacts sensitive details before deleting expired records", () => {
    const store = ledger();
    store.append("service:coordinator", request);
    expect(
      store.redactDue(
        "service:privacy-maintenance",
        "2026-10-29T07:01:00.000Z",
      ),
    ).toBe(1);
    const [redacted] = store.query("owner:robbie");
    expect(redacted).toMatchObject({
      redacted: true,
      accountClass: "account:redacted",
      route: { routeId: "route:redacted" },
      providerId: "provider:redacted",
      modelId: "model:redacted",
      quota: { state: "near-limit" },
      cost: { currency: "USD", amount: 0.42 },
    });
    expect(redacted && "quota" in redacted && redacted.quota).not.toHaveProperty(
      "remaining",
    );
    expect(
      store.deleteExpired(
        "service:privacy-maintenance",
        "2026-12-28T07:01:00.000Z",
      ),
    ).toBe(1);
    expect(store.query("owner:robbie")).toEqual([]);
  });

  it("does not double-count retried requests or outcomes", () => {
    const store = ledger();
    expect(store.append("service:coordinator", request).inserted).toBe(true);
    expect(store.append("service:coordinator", request).inserted).toBe(false);
    expect(
      store.append("service:coordinator", {
        ...request,
        eventId: "d57b9659-f4d1-45f3-9977-c3557ed029a9",
        occurredAt: "2026-09-28T07:01:02.000Z",
      }).inserted,
    ).toBe(false);

    const outcome: ExecutionTelemetryEvent = {
      ...common,
      eventId: "fd826a76-7c1e-44fb-890e-b03595d238e7",
      occurredAt: "2026-09-28T07:05:00.000Z",
      eventType: "session-outcome",
      outcome: "completed",
    };
    store.append("service:coordinator", outcome);
    expect(
      store.append("service:coordinator", {
        ...outcome,
        eventId: "e02595dc-99b6-4b95-b7a3-fefcf8295d6c",
        occurredAt: "2026-09-28T07:05:01.000Z",
      }).inserted,
    ).toBe(false);
    expect(store.metrics("owner:robbie")).toMatchObject({
      completions: 1,
      costByCurrency: { USD: 0.42 },
    });
  });

  it("keeps failed request retries attributable without counting cost twice", () => {
    const store = ledger();
    const failed: ExecutionTelemetryEvent = {
      ...request,
      eventId: "69b4315d-2896-42c1-89fc-a7083cf522d2",
      requestId: "request:failed",
      cost: { currency: "USD", amount: 0.08 },
      outcome: "failed",
      failureReason: "provider timeout",
    };
    expect(store.append("service:coordinator", failed).inserted).toBe(true);
    expect(store.append("service:coordinator", failed).inserted).toBe(false);
    expect(store.query("owner:robbie")).toEqual([failed]);
    expect(store.metrics("owner:robbie").costByCurrency).toEqual({ USD: 0.08 });
  });

  it("rejects conflicting retries", () => {
    const store = ledger();
    store.append("service:coordinator", request);
    expect(() =>
      store.append("service:coordinator", {
        ...request,
        cost: { currency: "USD", amount: 99 },
      }),
    ).toThrow(TelemetryConflictError);
  });

  it("calculates outcome, wait, handoff, intervention, and currency metrics", () => {
    const store = ledger();
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
    for (const event of events) store.append("service:coordinator", event);
    expect(store.metrics("owner:robbie")).toEqual({
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

  it("redacts secret-shaped text before storage", () => {
    const store = ledger();
    const stored = store.append("service:coordinator", {
      ...decision,
      reason: "authorization: Bearer secret-token",
    }).event;
    expect(JSON.stringify(stored)).not.toContain("secret-token");
  });
});
