import { z } from "zod";
import { IdentifierSchema } from "./vocabulary";

export const CoordinatorDeliveryRecoverySchema = z
  .object({
    id: z.uuid(),
    workItemId: IdentifierSchema,
    initiatingSessionId: z.union([IdentifierSchema, z.null()]),
    unavailableSessionFallback: z.enum([
      "request_owner_attention",
      "launch_replacement",
    ]),
  })
  .strict();
export type CoordinatorDeliveryRecovery = z.infer<
  typeof CoordinatorDeliveryRecoverySchema
>;

export const DeliveryRecoveryRoutingStateSchema = z
  .object({
    resumableSessionIds: z.array(IdentifierSchema),
    inboundSessionIds: z.array(IdentifierSchema),
  })
  .strict();
export type DeliveryRecoveryRoutingState = z.infer<
  typeof DeliveryRecoveryRoutingStateSchema
>;

export type DeliveryRecoveryRoute =
  | {
      readonly kind: "push" | "pull";
      readonly recoveryId: string;
      readonly targetSessionId: string;
      readonly dedupeKey: string;
    }
  | {
      readonly kind: "replacement_launch";
      readonly recoveryId: string;
      readonly targetSessionId: null;
      readonly dedupeKey: string;
    }
  | {
      readonly kind: "owner_attention";
      readonly recoveryId: string;
      readonly targetSessionId: null;
      readonly dedupeKey: string;
    };

export function routeDeliveryRecovery(
  recoveryInput: CoordinatorDeliveryRecovery,
  stateInput: DeliveryRecoveryRoutingState,
): DeliveryRecoveryRoute {
  const recovery = CoordinatorDeliveryRecoverySchema.parse(recoveryInput);
  const state = DeliveryRecoveryRoutingStateSchema.parse(stateInput);
  const initiatingSessionId = recovery.initiatingSessionId;
  if (
    initiatingSessionId !== null &&
    state.resumableSessionIds.includes(initiatingSessionId)
  ) {
    return {
      kind: state.inboundSessionIds.includes(initiatingSessionId)
        ? "push"
        : "pull",
      recoveryId: recovery.id,
      targetSessionId: initiatingSessionId,
      dedupeKey: recovery.id,
    };
  }
  if (recovery.unavailableSessionFallback === "launch_replacement") {
    return {
      kind: "replacement_launch",
      recoveryId: recovery.id,
      targetSessionId: null,
      dedupeKey: recovery.id,
    };
  }
  return {
    kind: "owner_attention",
    recoveryId: recovery.id,
    targetSessionId: null,
    dedupeKey: recovery.id,
  };
}
