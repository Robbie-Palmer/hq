import { z } from "zod";

import { redactAdapterText } from "./native-client";
import {
  AGENT_COORDINATOR_CONTRACT_VERSION,
  IdentifierSchema,
  MoneySchema,
} from "./vocabulary";

const TimestampSchema = z.iso.datetime();
const ReasonSchema = z.string().trim().min(1).max(2_000);

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
    redacted: z.boolean().optional(),
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

export const TelemetryAccessPolicySchema = z
  .object({
    writerIds: z.array(IdentifierSchema).min(1),
    readerIds: z.array(IdentifierSchema).min(1),
    administratorIds: z.array(IdentifierSchema).min(1),
    redactAfterDays: z.number().int().positive(),
    deleteAfterDays: z.number().int().positive(),
  })
  .strict()
  .refine(
    ({ redactAfterDays, deleteAfterDays }) =>
      redactAfterDays < deleteAfterDays,
    {
      message: "Telemetry must be redacted before it is deleted",
      path: ["redactAfterDays"],
    },
  );
export type TelemetryAccessPolicy = z.infer<
  typeof TelemetryAccessPolicySchema
>;

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

export class TelemetryAccessError extends Error {
  readonly code = "telemetry-access-denied";

  constructor(readonly actorId: string, readonly operation: string) {
    super(`${actorId} cannot ${operation} private execution telemetry`);
    this.name = "TelemetryAccessError";
  }
}

export class TelemetryConflictError extends Error {
  readonly code = "telemetry-conflict";

  constructor(readonly key: string) {
    super(`Telemetry already contains a different event for ${key}`);
    this.name = "TelemetryConflictError";
  }
}

export interface AppendTelemetryResult {
  inserted: boolean;
  event: ExecutionTelemetryEvent;
}

export class PrivateExecutionTelemetryLedger {
  readonly #policy: TelemetryAccessPolicy;
  readonly #events = new Map<string, ExecutionTelemetryEvent>();
  readonly #semanticKeys = new Map<string, string>();

  constructor(policy: TelemetryAccessPolicy) {
    this.#policy = TelemetryAccessPolicySchema.parse(policy);
  }

  append(actorId: string, candidate: ExecutionTelemetryEvent): AppendTelemetryResult {
    this.#require(actorId, "write", this.#policy.writerIds);
    const event = sanitizeEvent(ExecutionTelemetryEventSchema.parse(candidate));
    const existingById = this.#events.get(event.eventId);
    if (existingById) return this.#replay(existingById, event, event.eventId);

    const semanticKey = eventSemanticKey(event);
    const existingId = this.#semanticKeys.get(semanticKey);
    const existing = existingId ? this.#events.get(existingId) : undefined;
    if (existing) return this.#replay(existing, event, semanticKey, true);

    this.#events.set(event.eventId, event);
    this.#semanticKeys.set(semanticKey, event.eventId);
    return { inserted: true, event };
  }

  query(
    actorId: string,
    query: TelemetryQuery = {},
  ): readonly ExecutionTelemetryEvent[] {
    this.#require(actorId, "read", this.#policy.readerIds);
    const eventTypes = query.eventTypes && new Set(query.eventTypes);
    const from = query.from
      ? Date.parse(TimestampSchema.parse(query.from))
      : undefined;
    const to = query.to
      ? Date.parse(TimestampSchema.parse(query.to))
      : undefined;
    return [...this.#events.values()]
      .filter(
        (event) =>
          (!query.workItemId || event.workItemId === query.workItemId) &&
          (!query.sessionId || event.sessionId === query.sessionId) &&
          (!eventTypes || eventTypes.has(event.eventType)) &&
          (from === undefined || Date.parse(event.occurredAt) >= from) &&
          (to === undefined || Date.parse(event.occurredAt) <= to),
      )
      .sort(
        (left, right) =>
          left.occurredAt.localeCompare(right.occurredAt, "en") ||
          left.eventId.localeCompare(right.eventId, "en"),
      );
  }

  metrics(actorId: string, query: TelemetryQuery = {}): TelemetryMetrics {
    const events = this.query(actorId, query);
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
    for (const event of events) {
      recordEventMetrics(metrics, event);
    }
    return metrics;
  }

  redactDue(actorId: string, now: string): number {
    this.#require(actorId, "redact", this.#policy.administratorIds);
    const cutoff = retentionCutoff(now, this.#policy.redactAfterDays);
    let count = 0;
    for (const [eventId, event] of this.#events) {
      if (event.redacted || Date.parse(event.occurredAt) > cutoff) continue;
      this.#events.set(eventId, redactEvent(event));
      count += 1;
    }
    return count;
  }

  deleteExpired(actorId: string, now: string): number {
    this.#require(actorId, "delete", this.#policy.administratorIds);
    const cutoff = retentionCutoff(now, this.#policy.deleteAfterDays);
    let count = 0;
    for (const [eventId, event] of this.#events) {
      if (Date.parse(event.occurredAt) > cutoff) continue;
      this.#events.delete(eventId);
      this.#semanticKeys.delete(eventSemanticKey(event));
      count += 1;
    }
    return count;
  }

  #replay(
    existing: ExecutionTelemetryEvent,
    candidate: ExecutionTelemetryEvent,
    key: string,
    ignoreEventIdentity = false,
  ): AppendTelemetryResult {
    if (!equivalentEvents(existing, candidate, ignoreEventIdentity)) {
      throw new TelemetryConflictError(key);
    }
    return { inserted: false, event: existing };
  }

  #require(actorId: string, operation: string, allowed: readonly string[]): void {
    if (
      !allowed.includes(actorId) &&
      !this.#policy.administratorIds.includes(actorId)
    ) {
      throw new TelemetryAccessError(actorId, operation);
    }
  }
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
  const outcome =
    event.eventType === "routing-decision"
      ? event.decision
      : event.eventType === "provider-request" ||
          event.eventType === "session-outcome" ||
          event.eventType === "intervention"
        ? event.outcome
        : undefined;
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
  if (
    event.eventType === "session-outcome" &&
    event.reason
  ) {
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

function eventSemanticKey(event: ExecutionTelemetryEvent): string {
  if (event.eventType === "provider-request") {
    return `${event.sessionId}:request:${event.requestId}`;
  }
  if (event.eventType === "routing-decision") {
    return `${event.sessionId}:decision:${event.decisionId}`;
  }
  if (event.eventType === "session-outcome") {
    return `${event.sessionId}:outcome`;
  }
  if (event.eventType === "handoff") {
    return `${event.sessionId}:handoff:${event.successorSessionId}`;
  }
  if (event.eventType === "wait") {
    return `${event.sessionId}:wait:${event.waitId}`;
  }
  return `${event.sessionId}:intervention:${event.interventionId}:${event.outcome}`;
}

function equivalentEvents(
  existing: ExecutionTelemetryEvent,
  candidate: ExecutionTelemetryEvent,
  ignoreEventIdentity: boolean,
): boolean {
  const omitIdentity = (event: ExecutionTelemetryEvent): unknown => {
    if (!ignoreEventIdentity) return event;
    const { eventId: _eventId, occurredAt: _occurredAt, ...rest } = event;
    return rest;
  };
  return JSON.stringify(omitIdentity(existing)) === JSON.stringify(omitIdentity(candidate));
}

function retentionCutoff(now: string, days: number): number {
  return Date.parse(TimestampSchema.parse(now)) - days * 86_400_000;
}

function redactEvent(event: ExecutionTelemetryEvent): ExecutionTelemetryEvent {
  const privacyFields = {
    accountClass: "account:redacted",
    route: { ...event.route, routeId: "route:redacted" },
    redacted: true as const,
  };
  if (event.eventType === "routing-decision") {
    return ExecutionTelemetryEventSchema.parse({
      ...event,
      ...privacyFields,
      reason: "[redacted]",
    });
  }
  if (event.eventType === "provider-request") {
    return ExecutionTelemetryEventSchema.parse({
      ...event,
      ...privacyFields,
      providerId: "provider:redacted",
      modelId: "model:redacted",
      quota: {
        state: event.quota.state,
        observedAt: event.quota.observedAt,
      },
      ...(event.failureReason ? { failureReason: "[redacted]" } : {}),
    });
  }
  if (event.eventType === "session-outcome") {
    return ExecutionTelemetryEventSchema.parse({
      ...event,
      ...privacyFields,
      ...(event.reason ? { reason: "[redacted]" } : {}),
    });
  }
  if (event.eventType === "handoff") {
    return ExecutionTelemetryEventSchema.parse({
      ...event,
      ...privacyFields,
      reason: "[redacted]",
    });
  }
  if (event.eventType === "wait") {
    return ExecutionTelemetryEventSchema.parse({
      ...event,
      ...privacyFields,
      reason: "[redacted]",
    });
  }
  return ExecutionTelemetryEventSchema.parse({
    ...event,
    ...privacyFields,
    reason: "[redacted]",
  });
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
