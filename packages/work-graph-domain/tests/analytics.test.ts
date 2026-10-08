import { operationalReport, type OperationalEvent } from "../src/analytics";

const period = { start: "2026-10-01T01:00:00Z", end: "2026-10-01T03:00:00Z" };
const scopes = [
  { workItemId: "ticket", projectId: "project", initiativeId: "initiative" },
];
const event = (
  sequence: number,
  type: string,
  hour: number,
  data: Record<string, unknown>,
): OperationalEvent => ({
  sequence,
  type,
  workItemId: "ticket",
  occurredAt: `2026-10-01T0${hour}:00:00Z`,
  data,
});
const request = (sequence: number, hour: number, id: string, blocking = true) =>
  event(sequence, "attention.requested", hour, {
    attentionRequestId: id,
    kind: "access",
    blocking,
  });
const resolve = (sequence: number, hour: number, id: string) =>
  event(sequence, "attention.resolved", hour, { attentionRequestId: id });
const claim = (sequence: number, hour: number, id = "lease") =>
  event(sequence, "lease.claimed", hour, {
    leaseId: id,
    expiresAt: `2026-10-01T0${hour + 1}:00:00Z`,
  });
const ended = (
  sequence: number,
  hour: number,
  outcome = "expired",
  id = "lease",
) => event(sequence, "lease.ended", hour, { leaseId: id, outcome });

describe("operational analytics", () => {
  it("replays reordered and duplicate events without double counting", () => {
    const events = [request(1, 0, "a"), resolve(2, 2, "a"), request(3, 2, "b")];
    const result = operationalReport(events, scopes, period);
    expect(
      operationalReport([...events].reverse().concat(events), scopes, period),
    ).toEqual(result);
    expect(result.metrics[0]).toMatchObject({
      episodes: 2,
      recurringWorkItems: 1,
      waitMilliseconds: 7200000,
      openAtEnd: 1,
      interventionRequests: 1,
      resolutions: 1,
    });
  });
  it("deduplicates semantically identical JSON with different key order", () => {
    const first = request(1, 1, "a");
    const reordered = {
      ...first,
      data: Object.fromEntries(Object.entries(first.data).reverse()),
    };
    expect(operationalReport([first, reordered], scopes, period)).toEqual(
      operationalReport([first], scopes, period),
    );
  });
  it("recomputes history after late data arrives", () => {
    const first = operationalReport([request(1, 0, "a")], scopes, period);
    const late = operationalReport(
      [resolve(2, 2, "a"), request(1, 0, "a")],
      scopes,
      period,
    );
    expect(first.metrics[0]?.openAtEnd).toBe(1);
    expect(late.metrics[0]).toMatchObject({
      openAtEnd: 0,
      waitMilliseconds: 3600000,
    });
  });
  it("counts nonblocking demands without inventing wait time or human actors", () => {
    expect(
      operationalReport(
        [request(1, 1, "a", false), resolve(2, 2, "a")],
        scopes,
        period,
      ).metrics[0],
    ).toMatchObject({
      interventionRequests: 1,
      resolutions: 1,
      episodes: 0,
      waitMilliseconds: 0,
    });
  });
  it("measures expiry to takeover and flags missing durable notes", () => {
    const events = [claim(1, 0), ended(2, 2), claim(3, 2, "next")];
    expect(operationalReport(events, scopes, period).metrics[0]).toMatchObject({
      episodes: 1,
      waitMilliseconds: 3600000,
      staleTakeovers: 1,
      failedHandoffProxies: 1,
    });
    events.splice(
      1,
      0,
      event(2, "note.created", 1, { leaseId: "lease", kind: "work" }),
    );
    events[2] = ended(3, 2);
    events[3] = claim(4, 2, "next");
    expect(
      operationalReport(events, scopes, period).metrics[0]
        ?.failedHandoffProxies,
    ).toBe(0);
  });
  it("uses renewed expiry and counts open stale waits", () => {
    const events = [
      claim(1, 0),
      event(2, "lease.renewed", 0, {
        leaseId: "lease",
        expiresAt: "2026-10-01T02:00:00Z",
      }),
    ];
    expect(operationalReport(events, scopes, period).metrics[0]).toMatchObject({
      openAtEnd: 1,
      waitMilliseconds: 3600000,
      staleTakeovers: 0,
    });
    expect(
      operationalReport([...events, ended(3, 2, "released")], scopes, period)
        .metrics,
    ).toEqual([]);
  });
  it("excludes period end, preserves scoped aggregation, and buckets unknown categories", () => {
    const events = [
      event(1, "attention.requested", 1, {
        attentionRequestId: "secret-id",
        kind: "private prompt",
        question: "secret",
        blocking: true,
        tokens: 999,
        workerId: "secret-worker",
      }),
      request(2, 3, "end"),
    ];
    const report = operationalReport(events, scopes, period);
    expect(report.metrics[0]).toMatchObject({
      projectId: "project",
      initiativeId: "initiative",
      cause: "attention:other",
      interventionRequests: 1,
    });
    const serialized = JSON.stringify(report);
    for (const secret of [
      "private prompt",
      "secret",
      "tokens",
      "workerId",
      "question",
    ])
      expect(serialized).not.toContain(secret);
    expect(
      operationalReport(events, [], period).metrics[0]?.projectId,
    ).toBeNull();
  });
  it("rejects conflicting identities, invalid periods and malformed expiry", () => {
    expect(() =>
      operationalReport(
        [request(1, 0, "a"), request(1, 1, "b")],
        scopes,
        period,
      ),
    ).toThrow("Conflicting");
    expect(() =>
      operationalReport([], [], { start: "bad", end: period.end }),
    ).toThrow("period");
    expect(() =>
      operationalReport([event(0, "unknown", 1, {})], [], period),
    ).toThrow("identity");
    expect(() =>
      operationalReport(
        [event(1, "lease.claimed", 1, { leaseId: "lease" })],
        [],
        period,
      ),
    ).toThrow("expiry");
    expect(() =>
      operationalReport(
        [claim(1, 0), event(2, "lease.renewed", 1, { leaseId: "lease" })],
        [],
        period,
      ),
    ).toThrow("expiry");
  });
});
