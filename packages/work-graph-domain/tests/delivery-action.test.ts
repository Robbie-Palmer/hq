import { describe, expect, it } from "vitest";
import {
  normalizeDeliveryActionRequest,
  normalizeDeliveryRecoveryDelivery,
  type DeliveryActionRequest,
} from "../src";

const request = (): DeliveryActionRequest => ({
  id: "10000000-0000-4000-8000-000000000001",
  workItemId: "ticket",
  kind: "deployment",
  provider: "github",
  evidenceKind: "deployment",
  evidenceExternalId: "example/site/deployments/20",
  repository: "Example/Site",
  commitSha: "A".repeat(40),
  policyId: "site-production",
  policyRevision: 2,
  initiatingSessionId: "session:initiator",
  unavailableSessionFallback: "launch_replacement",
  requestedAt: "2026-11-04T20:00:00Z",
});

describe("delivery action requests", () => {
  it("normalizes the immutable GitHub, policy, and session identity", () => {
    expect(normalizeDeliveryActionRequest(request())).toMatchObject({
      repository: "example/site",
      commitSha: "a".repeat(40),
      initiatingSessionId: "session:initiator",
      requestedAt: "2026-11-04T20:00:00.000Z",
    });
  });

  it("requires the evidence kind to match the requested action", () => {
    expect(() =>
      normalizeDeliveryActionRequest({
        ...request(),
        kind: "merge",
      }),
    ).toThrow("invalid");
  });
});

describe("delivery recovery reservations", () => {
  it("targets push delivery to one explicit session", () => {
    expect(
      normalizeDeliveryRecoveryDelivery({
        id: "20000000-0000-4000-8000-000000000001",
        recoveryId: "30000000-0000-4000-8000-000000000001",
        kind: "push",
        targetSessionId: "session:initiator",
        reservedAt: "2026-11-04T20:05:00Z",
      }),
    ).toMatchObject({ targetSessionId: "session:initiator" });
  });

  it("keeps replacement launches session-free until launch succeeds", () => {
    expect(() =>
      normalizeDeliveryRecoveryDelivery({
        id: "20000000-0000-4000-8000-000000000001",
        recoveryId: "30000000-0000-4000-8000-000000000001",
        kind: "replacement_launch",
        targetSessionId: "session:wrong",
        reservedAt: "2026-11-04T20:05:00Z",
      }),
    ).toThrow("invalid");
  });
});
