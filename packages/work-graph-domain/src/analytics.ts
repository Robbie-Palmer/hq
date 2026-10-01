/** Only work-state fields cross the analytics boundary. Never spread event data. */
export interface OperationalEvent {
  readonly sequence: number;
  readonly type: string;
  readonly workItemId: string | null;
  readonly occurredAt: string;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface AnalyticsScope {
  readonly workItemId: string;
  readonly projectId: string | null;
  readonly initiativeId: string | null;
}

const categories = new Set([
  "decision",
  "ambiguity",
  "authority",
  "access",
  "failure",
  "review",
  "approval",
  "scope",
]);

export interface OperationalMetric {
  readonly projectId: string | null;
  readonly initiativeId: string | null;
  readonly cause: string;
  episodes: number;
  recurringWorkItems: number;
  waitMilliseconds: number;
  openAtEnd: number;
  interventionRequests: number;
  resolutions: number;
  staleTakeovers: number;
  failedHandoffProxies: number;
}

interface AttentionWait {
  item: string;
  cause: string;
  began: number;
  blocking: boolean;
}
interface LeaseWait {
  item: string;
  expires: number;
  noted: boolean;
}
interface MetricGroup {
  row: OperationalMetric;
  itemCounts: Map<string, number>;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, field]) => `${JSON.stringify(key)}:${canonicalJson(field)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function orderedEvents(events: readonly OperationalEvent[]) {
  const identities = new Map<number, OperationalEvent>();
  for (const event of events) {
    if (
      !Number.isSafeInteger(event.sequence) ||
      event.sequence < 1 ||
      !Number.isFinite(Date.parse(event.occurredAt))
    ) {
      throw new Error("Invalid operational event identity or timestamp.");
    }
    const previous = identities.get(event.sequence);
    if (previous && canonicalJson(previous) !== canonicalJson(event)) {
      throw new Error("Conflicting immutable event identity.");
    }
    identities.set(event.sequence, event);
  }
  return [...identities.values()].sort((a, b) => a.sequence - b.sequence);
}

function leaseExpiry(event: OperationalEvent, at: number) {
  const expires =
    typeof event.data.expiresAt === "string"
      ? Date.parse(event.data.expiresAt)
      : NaN;
  if (!Number.isFinite(expires) || expires < at)
    throw new Error("Invalid lease expiry.");
  return expires;
}

class ReportProjection {
  private readonly groups = new Map<string, MetricGroup>();
  private readonly requests = new Map<string, AttentionWait>();
  private readonly leases = new Map<string, LeaseWait>();
  private readonly scopeByItem: Map<string, AnalyticsScope>;

  constructor(
    scopes: readonly AnalyticsScope[],
    private readonly start: number,
    private readonly end: number,
  ) {
    this.scopeByItem = new Map(
      scopes.map((scope) => [scope.workItemId, scope]),
    );
  }

  private metric(item: string, cause: string): MetricGroup {
    const scope = this.scopeByItem.get(item);
    const projectId = scope?.projectId ?? null;
    const initiativeId = scope?.initiativeId ?? null;
    const key = JSON.stringify([projectId, initiativeId, cause]);
    const existing = this.groups.get(key);
    if (existing) return existing;
    const group = {
      row: {
        projectId,
        initiativeId,
        cause,
        episodes: 0,
        recurringWorkItems: 0,
        waitMilliseconds: 0,
        openAtEnd: 0,
        interventionRequests: 0,
        resolutions: 0,
        staleTakeovers: 0,
        failedHandoffProxies: 0,
      },
      itemCounts: new Map<string, number>(),
    };
    this.groups.set(key, group);
    return group;
  }

  private wait(
    item: string,
    cause: string,
    began: number,
    finished: number | null,
  ) {
    const until = finished ?? this.end;
    if (began >= this.end || until <= this.start) return;
    const { row, itemCounts } = this.metric(item, cause);
    row.episodes++;
    itemCounts.set(item, (itemCounts.get(item) ?? 0) + 1);
    row.waitMilliseconds += Math.max(
      0,
      Math.min(until, this.end) - Math.max(began, this.start),
    );
    if (finished === null || finished >= this.end) row.openAtEnd++;
  }

  private request(event: OperationalEvent, item: string, at: number) {
    if (typeof event.data.attentionRequestId !== "string") return;
    const kind = event.data.kind;
    const cause = `attention:${typeof kind === "string" && categories.has(kind) ? kind : "other"}`;
    this.requests.set(event.data.attentionRequestId, {
      item,
      cause,
      began: at,
      blocking: event.data.blocking === true,
    });
    if (at >= this.start) this.metric(item, cause).row.interventionRequests++;
  }

  private resolve(event: OperationalEvent, item: string, at: number) {
    if (typeof event.data.attentionRequestId !== "string") return;
    const request = this.requests.get(event.data.attentionRequestId);
    if (!request || request.item !== item) return;
    if (request.blocking) this.wait(item, request.cause, request.began, at);
    if (at >= this.start) this.metric(item, request.cause).row.resolutions++;
    this.requests.delete(event.data.attentionRequestId);
  }

  private leaseEvent(event: OperationalEvent, item: string, at: number) {
    if (typeof event.data.leaseId !== "string") return;
    const id = event.data.leaseId;
    if (event.type === "lease.claimed") {
      this.leases.set(id, {
        item,
        expires: leaseExpiry(event, at),
        noted: false,
      });
      return;
    }
    const lease = this.leases.get(id);
    if (!lease || lease.item !== item) return;
    switch (event.type) {
      case "lease.renewed":
        lease.expires = leaseExpiry(event, at);
        break;
      case "note.created":
        lease.noted ||= event.data.kind === "work";
        break;
      case "lease.ended":
        this.endLease(event, lease, at);
        this.leases.delete(id);
        break;
    }
  }

  private endLease(event: OperationalEvent, lease: LeaseWait, at: number) {
    if (event.data.outcome !== "expired") return;
    this.wait(lease.item, "stale_lease", lease.expires, at);
    if (at < this.start) return;
    const row = this.metric(lease.item, "stale_lease").row;
    row.staleTakeovers++;
    if (!lease.noted) row.failedHandoffProxies++;
  }

  replay(event: OperationalEvent) {
    const at = Date.parse(event.occurredAt);
    if (at >= this.end || !event.workItemId) return;
    switch (event.type) {
      case "attention.requested":
        this.request(event, event.workItemId, at);
        break;
      case "attention.resolved":
        this.resolve(event, event.workItemId, at);
        break;
      default:
        this.leaseEvent(event, event.workItemId, at);
    }
  }

  finish() {
    for (const request of this.requests.values()) {
      if (request.blocking)
        this.wait(request.item, request.cause, request.began, null);
    }
    for (const lease of this.leases.values()) {
      if (lease.expires < this.end)
        this.wait(lease.item, "stale_lease", lease.expires, null);
    }
    return [...this.groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, { row, itemCounts }]) => ({
        ...row,
        recurringWorkItems: [...itemCounts.values()].filter(
          (count) => count > 1,
        ).length,
      }));
  }
}

/** Replay complete history, then clip waits to the half-open reporting period. */
export function operationalReport(
  events: readonly OperationalEvent[],
  scopes: readonly AnalyticsScope[],
  period: { readonly start: string; readonly end: string },
) {
  const start = Date.parse(period.start);
  const end = Date.parse(period.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
    throw new Error(
      "Reporting period must have valid timestamps with start before end.",
    );
  }
  const ordered = orderedEvents(events);
  const projection = new ReportProjection(scopes, start, end);
  for (const event of ordered) projection.replay(event);
  return {
    version: 1,
    period: {
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
    },
    scopeBasis: "current_assignment" as const,
    watermark: ordered.at(-1)?.sequence ?? 0,
    metrics: projection.finish(),
  };
}
