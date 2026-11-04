import { describe, expect, it } from "vitest";
import { routeDeliveryRecovery } from "../src/delivery-recovery";

const recovery = {
  id: "00000000-0000-4000-8000-000000000001",
  workItemId: "ticket",
  initiatingSessionId: "session:initiator",
  unavailableSessionFallback: "request_owner_attention" as const,
};

describe("delivery recovery routing", () => {
  it("pushes to the exact initiating session when inbound delivery exists", () => {
    expect(
      routeDeliveryRecovery(recovery, {
        resumableSessionIds: ["session:initiator", "session:current-owner"],
        inboundSessionIds: ["session:initiator"],
      }),
    ).toEqual({
      kind: "push",
      recoveryId: recovery.id,
      targetSessionId: "session:initiator",
      dedupeKey: recovery.id,
    });
  });

  it("leaves recovery for the initiating session to pull without inbound delivery", () => {
    expect(
      routeDeliveryRecovery(recovery, {
        resumableSessionIds: ["session:initiator"],
        inboundSessionIds: [],
      }),
    ).toMatchObject({
      kind: "pull",
      targetSessionId: "session:initiator",
    });
  });

  it("does not infer a mutable current owner when the initiator is gone", () => {
    expect(
      routeDeliveryRecovery(recovery, {
        resumableSessionIds: ["session:current-owner"],
        inboundSessionIds: ["session:current-owner"],
      }),
    ).toMatchObject({ kind: "owner_attention", targetSessionId: null });
  });

  it("launches one replacement only when the recorded policy permits it", () => {
    expect(
      routeDeliveryRecovery(
        {
          ...recovery,
          initiatingSessionId: null,
          unavailableSessionFallback: "launch_replacement",
        },
        { resumableSessionIds: [], inboundSessionIds: [] },
      ),
    ).toMatchObject({
      kind: "replacement_launch",
      dedupeKey: recovery.id,
    });
  });
});
