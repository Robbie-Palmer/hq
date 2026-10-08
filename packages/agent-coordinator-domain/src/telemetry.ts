import type { Context } from "@opentelemetry/api";
import {
  logs,
  SeverityNumber,
  type LogAttributes,
  type Logger,
} from "@opentelemetry/api-logs";
import { ATTR_ERROR_TYPE } from "@opentelemetry/semantic-conventions";
import { z } from "zod";

import { redactAdapterText } from "./native-client";
import {
  AGENT_COORDINATOR_CONTRACT_VERSION,
  IdentifierSchema,
  MoneySchema,
} from "./vocabulary";

const TimestampSchema = z.iso.datetime();
const ReasonSchema = z.string().trim().min(1).max(2_000);
// These attributes now live in the standalone OpenTelemetry GenAI conventions.
const ATTR_GEN_AI_PROVIDER_NAME = "gen_ai.provider.name";
const ATTR_GEN_AI_REQUEST_MODEL = "gen_ai.request.model";

const TelemetryBaseSchema = z
  .object({
    schemaVersion: z.literal(AGENT_COORDINATOR_CONTRACT_VERSION),
    recordType: z.literal("execution-telemetry"),
    eventId: z.uuid(),
    occurredAt: TimestampSchema,
    workItemId: IdentifierSchema,
    leaseId: z.uuid(),
    leaseEpoch: z.number().int().positive(),
    sessionId: IdentifierSchema,
    policy: z
      .object({
        policyId: IdentifierSchema,
        revision: z.number().int().positive(),
      })
      .strict(),
    adapter: z
      .object({
        adapterId: IdentifierSchema,
        adapterVersion: z.string().trim().min(1).max(80),
      })
      .strict(),
    accountClass: IdentifierSchema,
    route: z
      .object({
        kind: z.enum(["native-client", "direct-api", "api-gateway"]),
        routeId: IdentifierSchema,
      })
      .strict(),
  })
  .strict();

export const QuotaObservationSchema = z
  .object({
    state: z.enum(["available", "near-limit", "exhausted", "unknown"]),
    observedAt: TimestampSchema,
    remaining: z.number().nonnegative().optional(),
    unit: IdentifierSchema.optional(),
    resetsAt: TimestampSchema.optional(),
  })
  .strict();

const RoutingDecisionEventSchema = TelemetryBaseSchema.extend({
  eventType: z.literal("routing-decision"),
  decisionId: IdentifierSchema,
  decision: z.enum(["selected", "declined"]),
  reason: ReasonSchema,
}).strict();

const ProviderRequestEventSchema = TelemetryBaseSchema.extend({
  eventType: z.literal("provider-request"),
  requestId: IdentifierSchema,
  providerId: IdentifierSchema,
  modelId: IdentifierSchema,
  quota: QuotaObservationSchema,
  funding: z.enum(["prepaid", "metered"]),
  cost: z.union([MoneySchema, z.null()]),
  outcome: z.enum(["completed", "failed", "cancelled"]),
  failureReason: ReasonSchema.optional(),
})
  .strict()
  .superRefine((event, context) => {
    if (event.funding === "metered" && event.cost === null) {
      context.addIssue({
        code: "custom",
        message: "A metered request must record its cost",
        path: ["cost"],
      });
    }
    if (event.funding === "prepaid" && event.cost !== null) {
      context.addIssue({
        code: "custom",
        message: "A prepaid request cannot record metered cost",
        path: ["cost"],
      });
    }
    if (event.outcome === "failed" && !event.failureReason) {
      context.addIssue({
        code: "custom",
        message: "A failed request must record its reason",
        path: ["failureReason"],
      });
    }
  });

const SessionOutcomeEventSchema = TelemetryBaseSchema.extend({
  eventType: z.literal("session-outcome"),
  outcome: z.enum(["completed", "abandoned", "reassigned", "failed"]),
  reason: ReasonSchema.optional(),
}).strict();

const HandoffEventSchema = TelemetryBaseSchema.extend({
  eventType: z.literal("handoff"),
  successorSessionId: IdentifierSchema,
  reason: ReasonSchema,
})
  .strict()
  .refine((event) => event.successorSessionId !== event.sessionId, {
    message: "A handoff must select a different session",
    path: ["successorSessionId"],
  });

const WaitEventSchema = TelemetryBaseSchema.extend({
  eventType: z.literal("wait"),
  waitId: IdentifierSchema,
  durationMs: z.number().int().nonnegative(),
  reason: ReasonSchema,
}).strict();

const InterventionEventSchema = TelemetryBaseSchema.extend({
  eventType: z.literal("intervention"),
  interventionId: IdentifierSchema,
  outcome: z.enum(["requested", "resolved", "declined"]),
  reason: ReasonSchema,
}).strict();

export const ExecutionTelemetryEventSchema = z.discriminatedUnion(
  "eventType",
  [
    RoutingDecisionEventSchema,
    ProviderRequestEventSchema,
    SessionOutcomeEventSchema,
    HandoffEventSchema,
    WaitEventSchema,
    InterventionEventSchema,
  ],
);
export type ExecutionTelemetryEvent = z.infer<
  typeof ExecutionTelemetryEventSchema
>;

export const EXECUTION_TELEMETRY_SCOPE = "agent-coordinator-domain";

const eventNames = {
  "routing-decision": "agent_coordinator.routing.decision",
  "provider-request": "agent_coordinator.provider.request",
  "session-outcome": "agent_coordinator.session.outcome",
  handoff: "agent_coordinator.session.handoff",
  wait: "agent_coordinator.session.wait",
  intervention: "agent_coordinator.intervention",
} as const satisfies Record<ExecutionTelemetryEvent["eventType"], string>;

const eventTypes = Object.fromEntries(
  Object.entries(eventNames).map(([eventType, eventName]) => [
    eventName,
    eventType,
  ]),
) as Record<string, ExecutionTelemetryEvent["eventType"]>;

export interface ExecutionTelemetryLogRecord {
  eventName?: string;
  attributes: LogAttributes;
}

export interface TelemetryQuery {
  workItemId?: string;
  sessionId?: string;
  eventTypes?: readonly ExecutionTelemetryEvent["eventType"][];
  from?: string;
  to?: string;
}

export interface TelemetryMetrics {
  completions: number;
  abandonments: number;
  reassignments: number;
  failures: number;
  waits: number;
  waitDurationMs: number;
  handoffs: number;
  interventions: number;
  costByCurrency: Readonly<Record<string, number>>;
}

export class TelemetryConflictError extends Error {
  readonly code = "telemetry-conflict";

  constructor(readonly key: string) {
    super(`Telemetry contains different events for ${key}`);
    this.name = "TelemetryConflictError";
  }
}

export class ExecutionTelemetryRecorder {
  readonly #logger: Logger;

  constructor(logger: Logger = logs.getLogger(EXECUTION_TELEMETRY_SCOPE)) {
    this.#logger = logger;
  }

  record(
    candidate: ExecutionTelemetryEvent,
    context?: Context,
  ): ExecutionTelemetryEvent {
    const event = sanitizeEvent(ExecutionTelemetryEventSchema.parse(candidate));
    const failed = isFailure(event);
    this.#logger.emit({
      eventName: eventNames[event.eventType],
      timestamp: new Date(event.occurredAt),
      observedTimestamp: new Date(),
      severityNumber: failed ? SeverityNumber.ERROR : SeverityNumber.INFO,
      severityText: failed ? "ERROR" : "INFO",
      body: `Agent Coordinator ${event.eventType}`,
      attributes: eventAttributes(event),
      context,
    });
    return event;
  }
}

export function queryExecutionTelemetry(
  records: readonly ExecutionTelemetryLogRecord[],
  query: TelemetryQuery = {},
): readonly ExecutionTelemetryEvent[] {
  const eventTypesFilter = query.eventTypes && new Set(query.eventTypes);
  const from = query.from
    ? Date.parse(TimestampSchema.parse(query.from))
    : undefined;
  const to = query.to ? Date.parse(TimestampSchema.parse(query.to)) : undefined;
  const events = records
    .map(parseExecutionTelemetryLogRecord)
    .filter((event): event is ExecutionTelemetryEvent => event !== undefined)
    .filter(
      (event) =>
        (!query.workItemId || event.workItemId === query.workItemId) &&
        (!query.sessionId || event.sessionId === query.sessionId) &&
        (!eventTypesFilter || eventTypesFilter.has(event.eventType)) &&
        (from === undefined || Date.parse(event.occurredAt) >= from) &&
        (to === undefined || Date.parse(event.occurredAt) <= to),
    );
  return deduplicateEvents(events).sort(
    (left, right) =>
      left.occurredAt.localeCompare(right.occurredAt, "en") ||
      left.eventId.localeCompare(right.eventId, "en"),
  );
}

export function executionTelemetryMetrics(
  records: readonly ExecutionTelemetryLogRecord[],
  query: TelemetryQuery = {},
): TelemetryMetrics {
  const costByCurrency: Record<string, number> = {};
  const metrics: TelemetryMetrics = {
    completions: 0,
    abandonments: 0,
    reassignments: 0,
    failures: 0,
    waits: 0,
    waitDurationMs: 0,
    handoffs: 0,
    interventions: 0,
    costByCurrency,
  };
  for (const event of queryExecutionTelemetry(records, query)) {
    recordEventMetrics(metrics, event);
  }
  return metrics;
}

export const PublicWorkEvidenceSchema = z
  .object({
    schemaVersion: z.literal(AGENT_COORDINATOR_CONTRACT_VERSION),
    recordType: z.literal("coordinator-work-evidence"),
    evidenceId: z.uuid(),
    occurredAt: TimestampSchema,
    workItemId: IdentifierSchema,
    leaseId: z.uuid(),
    leaseEpoch: z.number().int().positive(),
    adapterId: IdentifierSchema,
    adapterVersion: z.string().trim().min(1).max(80),
    kind: z.enum([
      "routing-decision",
      "provider-request",
      "session-outcome",
      "handoff",
      "wait",
      "intervention",
    ]),
    outcome: IdentifierSchema.optional(),
  })
  .strict();
export type PublicWorkEvidence = z.infer<typeof PublicWorkEvidenceSchema>;

export function toPublicWorkEvidence(
  event: ExecutionTelemetryEvent,
): PublicWorkEvidence {
  const outcome = publicOutcome(event);
  return PublicWorkEvidenceSchema.parse({
    schemaVersion: AGENT_COORDINATOR_CONTRACT_VERSION,
    recordType: "coordinator-work-evidence",
    evidenceId: event.eventId,
    occurredAt: event.occurredAt,
    workItemId: event.workItemId,
    leaseId: event.leaseId,
    leaseEpoch: event.leaseEpoch,
    adapterId: event.adapter.adapterId,
    adapterVersion: event.adapter.adapterVersion,
    kind: event.eventType,
    ...(outcome ? { outcome } : {}),
  });
}

function sanitizeEvent(event: ExecutionTelemetryEvent): ExecutionTelemetryEvent {
  const redact = (value: string): string => redactAdapterText(value);
  if (event.eventType === "routing-decision") {
    return { ...event, reason: redact(event.reason) };
  }
  if (event.eventType === "provider-request" && event.failureReason) {
    return { ...event, failureReason: redact(event.failureReason) };
  }
  if (event.eventType === "session-outcome" && event.reason) {
    return { ...event, reason: redact(event.reason) };
  }
  if (
    event.eventType === "handoff" ||
    event.eventType === "wait" ||
    event.eventType === "intervention"
  ) {
    return { ...event, reason: redact(event.reason) };
  }
  return event;
}

function eventAttributes(event: ExecutionTelemetryEvent): LogAttributes {
  const attributes: LogAttributes = {
    "agent_coordinator.schema.version": event.schemaVersion,
    "agent_coordinator.event.id": event.eventId,
    "agent_coordinator.event.type": event.eventType,
    "agent_coordinator.event.occurred_at": event.occurredAt,
    "agent_coordinator.work_item.id": event.workItemId,
    "agent_coordinator.lease.id": event.leaseId,
    "agent_coordinator.lease.epoch": event.leaseEpoch,
    "agent_coordinator.session.id": event.sessionId,
    "agent_coordinator.policy.id": event.policy.policyId,
    "agent_coordinator.policy.revision": event.policy.revision,
    "agent_coordinator.adapter.id": event.adapter.adapterId,
    "agent_coordinator.adapter.version": event.adapter.adapterVersion,
    "agent_coordinator.account.class": event.accountClass,
    "agent_coordinator.route.kind": event.route.kind,
    "agent_coordinator.route.id": event.route.routeId,
  };
  addEventAttributes(attributes, event);
  return attributes;
}

function addEventAttributes(
  attributes: LogAttributes,
  event: ExecutionTelemetryEvent,
): void {
  switch (event.eventType) {
    case "routing-decision":
      attributes["agent_coordinator.decision.id"] = event.decisionId;
      attributes["agent_coordinator.decision.outcome"] = event.decision;
      attributes["agent_coordinator.decision.reason"] = event.reason;
      return;
    case "provider-request":
      addProviderRequestAttributes(attributes, event);
      return;
    case "session-outcome":
      attributes["agent_coordinator.outcome"] = event.outcome;
      if (event.reason) {
        attributes["agent_coordinator.outcome.reason"] = event.reason;
      }
      return;
    case "handoff":
      attributes["agent_coordinator.handoff.successor_session_id"] =
        event.successorSessionId;
      attributes["agent_coordinator.handoff.reason"] = event.reason;
      return;
    case "wait":
      attributes["agent_coordinator.wait.id"] = event.waitId;
      attributes["agent_coordinator.wait.duration_ms"] = event.durationMs;
      attributes["agent_coordinator.wait.reason"] = event.reason;
      return;
    case "intervention":
      attributes["agent_coordinator.intervention.id"] = event.interventionId;
      attributes["agent_coordinator.intervention.outcome"] = event.outcome;
      attributes["agent_coordinator.intervention.reason"] = event.reason;
  }
}

function addProviderRequestAttributes(
  attributes: LogAttributes,
  event: Extract<ExecutionTelemetryEvent, { eventType: "provider-request" }>,
): void {
  attributes["agent_coordinator.request.id"] = event.requestId;
  attributes["agent_coordinator.provider.id"] = event.providerId;
  attributes[ATTR_GEN_AI_PROVIDER_NAME] = event.providerId;
  attributes[ATTR_GEN_AI_REQUEST_MODEL] = event.modelId;
  attributes["agent_coordinator.quota.state"] = event.quota.state;
  attributes["agent_coordinator.quota.observed_at"] = event.quota.observedAt;
  if (event.quota.remaining !== undefined) {
    attributes["agent_coordinator.quota.remaining"] = event.quota.remaining;
  }
  if (event.quota.unit) {
    attributes["agent_coordinator.quota.unit"] = event.quota.unit;
  }
  if (event.quota.resetsAt) {
    attributes["agent_coordinator.quota.resets_at"] = event.quota.resetsAt;
  }
  attributes["agent_coordinator.funding"] = event.funding;
  if (event.cost) {
    attributes["agent_coordinator.cost.amount"] = event.cost.amount;
    attributes["agent_coordinator.cost.currency"] = event.cost.currency;
  }
  attributes["agent_coordinator.outcome"] = event.outcome;
  if (event.failureReason) {
    attributes[ATTR_ERROR_TYPE] = "provider_request_failed";
    attributes["agent_coordinator.failure.reason"] = event.failureReason;
  }
}

function parseExecutionTelemetryLogRecord(
  record: ExecutionTelemetryLogRecord,
): ExecutionTelemetryEvent | undefined {
  const eventType = record.eventName && eventTypes[record.eventName];
  if (!eventType) return undefined;
  const attributes = record.attributes;
  const base = {
    schemaVersion: numberAttribute(attributes, "agent_coordinator.schema.version"),
    recordType: "execution-telemetry",
    eventId: stringAttribute(attributes, "agent_coordinator.event.id"),
    occurredAt: stringAttribute(attributes, "agent_coordinator.event.occurred_at"),
    workItemId: stringAttribute(attributes, "agent_coordinator.work_item.id"),
    leaseId: stringAttribute(attributes, "agent_coordinator.lease.id"),
    leaseEpoch: numberAttribute(attributes, "agent_coordinator.lease.epoch"),
    sessionId: stringAttribute(attributes, "agent_coordinator.session.id"),
    policy: {
      policyId: stringAttribute(attributes, "agent_coordinator.policy.id"),
      revision: numberAttribute(attributes, "agent_coordinator.policy.revision"),
    },
    adapter: {
      adapterId: stringAttribute(attributes, "agent_coordinator.adapter.id"),
      adapterVersion: stringAttribute(
        attributes,
        "agent_coordinator.adapter.version",
      ),
    },
    accountClass: stringAttribute(attributes, "agent_coordinator.account.class"),
    route: {
      kind: stringAttribute(attributes, "agent_coordinator.route.kind"),
      routeId: stringAttribute(attributes, "agent_coordinator.route.id"),
    },
  };
  return ExecutionTelemetryEventSchema.parse({
    ...base,
    ...specificEventFields(eventType, attributes),
  });
}

function specificEventFields(
  eventType: ExecutionTelemetryEvent["eventType"],
  attributes: LogAttributes,
): Record<string, unknown> {
  switch (eventType) {
    case "routing-decision":
      return {
        eventType,
        decisionId: stringAttribute(attributes, "agent_coordinator.decision.id"),
        decision: stringAttribute(
          attributes,
          "agent_coordinator.decision.outcome",
        ),
        reason: stringAttribute(attributes, "agent_coordinator.decision.reason"),
      };
    case "provider-request":
      return providerRequestFields(attributes);
    case "session-outcome":
      return {
        eventType,
        outcome: stringAttribute(attributes, "agent_coordinator.outcome"),
        ...optionalStringField(
          attributes,
          "agent_coordinator.outcome.reason",
          "reason",
        ),
      };
    case "handoff":
      return {
        eventType,
        successorSessionId: stringAttribute(
          attributes,
          "agent_coordinator.handoff.successor_session_id",
        ),
        reason: stringAttribute(attributes, "agent_coordinator.handoff.reason"),
      };
    case "wait":
      return {
        eventType,
        waitId: stringAttribute(attributes, "agent_coordinator.wait.id"),
        durationMs: numberAttribute(
          attributes,
          "agent_coordinator.wait.duration_ms",
        ),
        reason: stringAttribute(attributes, "agent_coordinator.wait.reason"),
      };
    case "intervention":
      return {
        eventType,
        interventionId: stringAttribute(
          attributes,
          "agent_coordinator.intervention.id",
        ),
        outcome: stringAttribute(
          attributes,
          "agent_coordinator.intervention.outcome",
        ),
        reason: stringAttribute(
          attributes,
          "agent_coordinator.intervention.reason",
        ),
      };
  }
}

function providerRequestFields(attributes: LogAttributes): Record<string, unknown> {
  const funding = stringAttribute(attributes, "agent_coordinator.funding");
  return {
    eventType: "provider-request",
    requestId: stringAttribute(attributes, "agent_coordinator.request.id"),
    providerId: stringAttribute(attributes, "agent_coordinator.provider.id"),
    modelId: stringAttribute(attributes, ATTR_GEN_AI_REQUEST_MODEL),
    quota: {
      state: stringAttribute(attributes, "agent_coordinator.quota.state"),
      observedAt: stringAttribute(
        attributes,
        "agent_coordinator.quota.observed_at",
      ),
      ...optionalNumberField(
        attributes,
        "agent_coordinator.quota.remaining",
        "remaining",
      ),
      ...optionalStringField(attributes, "agent_coordinator.quota.unit", "unit"),
      ...optionalStringField(
        attributes,
        "agent_coordinator.quota.resets_at",
        "resetsAt",
      ),
    },
    funding,
    cost: providerRequestCost(attributes, funding),
    outcome: stringAttribute(attributes, "agent_coordinator.outcome"),
    ...optionalStringField(
      attributes,
      "agent_coordinator.failure.reason",
      "failureReason",
    ),
  };
}

function providerRequestCost(
  attributes: LogAttributes,
  funding: string,
): Record<string, unknown> | null {
  if (funding !== "metered") return null;
  return {
    amount: numberAttribute(attributes, "agent_coordinator.cost.amount"),
    currency: stringAttribute(attributes, "agent_coordinator.cost.currency"),
  };
}

function stringAttribute(attributes: LogAttributes, key: string): string {
  const value = attributes[key];
  if (typeof value !== "string") {
    throw new TypeError(`Missing string attribute ${key}`);
  }
  return value;
}

function numberAttribute(attributes: LogAttributes, key: string): number {
  const value = attributes[key];
  if (typeof value !== "number") {
    throw new TypeError(`Missing number attribute ${key}`);
  }
  return value;
}

function optionalStringField(
  attributes: LogAttributes,
  attribute: string,
  field: string,
): Record<string, string> {
  const value = attributes[attribute];
  return typeof value === "string" ? { [field]: value } : {};
}

function optionalNumberField(
  attributes: LogAttributes,
  attribute: string,
  field: string,
): Record<string, number> {
  const value = attributes[attribute];
  return typeof value === "number" ? { [field]: value } : {};
}

function deduplicateEvents(
  events: readonly ExecutionTelemetryEvent[],
): ExecutionTelemetryEvent[] {
  const byEventId = new Map<string, ExecutionTelemetryEvent>();
  for (const event of events) {
    const existing = byEventId.get(event.eventId);
    if (!existing) {
      byEventId.set(event.eventId, event);
      continue;
    }
    if (JSON.stringify(existing) !== JSON.stringify(event)) {
      throw new TelemetryConflictError(event.eventId);
    }
  }
  return [...byEventId.values()];
}

function isFailure(event: ExecutionTelemetryEvent): boolean {
  return (
    (event.eventType === "provider-request" && event.outcome === "failed") ||
    (event.eventType === "session-outcome" && event.outcome === "failed")
  );
}

function publicOutcome(event: ExecutionTelemetryEvent): string | undefined {
  if (event.eventType === "routing-decision") return event.decision;
  if (
    event.eventType === "provider-request" ||
    event.eventType === "session-outcome" ||
    event.eventType === "intervention"
  ) {
    return event.outcome;
  }
  return undefined;
}

function recordEventMetrics(
  metrics: TelemetryMetrics,
  event: ExecutionTelemetryEvent,
): void {
  switch (event.eventType) {
    case "session-outcome":
      recordSessionOutcome(metrics, event.outcome);
      return;
    case "provider-request":
      if (event.cost) {
        const costs = metrics.costByCurrency as Record<string, number>;
        costs[event.cost.currency] =
          (costs[event.cost.currency] ?? 0) + event.cost.amount;
      }
      return;
    case "wait":
      metrics.waits += 1;
      metrics.waitDurationMs += event.durationMs;
      return;
    case "handoff":
      metrics.handoffs += 1;
      return;
    case "intervention":
      metrics.interventions += 1;
      return;
    case "routing-decision":
      return;
  }
}

function recordSessionOutcome(
  metrics: TelemetryMetrics,
  outcome: Extract<
    ExecutionTelemetryEvent,
    { eventType: "session-outcome" }
  >["outcome"],
): void {
  const fieldByOutcome = {
    completed: "completions",
    abandoned: "abandonments",
    reassigned: "reassignments",
    failed: "failures",
  } as const;
  metrics[fieldByOutcome[outcome]] += 1;
}
