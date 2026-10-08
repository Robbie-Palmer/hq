import { z } from "zod";

const coordinateSchema = z.object({
  latitudeDegrees: z.number().min(-90).max(90),
  longitudeDegrees: z.number().min(-180).max(180),
});

const uint32Schema = z.number().int().min(0).max(4_294_967_295);
const candidacyScoreSchema = z.number().int().min(0).max(100);
const cartesianIntegerSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  z: z.number().int(),
});

const controllerStateSchema = z.enum([
  "idle",
  "leading",
  "awaiting acknowledgement",
  "awaiting assignment",
  "active",
  "quiescent",
  "safe-disabled",
]);

const missionKeySchema = z.object({
  bootEpoch: z.number().int().min(1).max(4_294_967_295),
  originNode: z.number().int().min(0).max(15),
  sequence: z.number().int().min(1).max(65_535),
});

const nodeSchema = z.object({
  assignedNode: z.number().int().min(0).max(15).nullable(),
  bootEpoch: z.number().int().min(1).max(4_294_967_295),
  candidacyScore: candidacyScoreSchema,
  earthFixedPositionMetres: cartesianIntegerSchema,
  earthFixedVelocityMillimetresPerSecond: cartesianIntegerSchema,
  epochUnixMilliseconds: z.number().int(),
  id: z.number().int().min(0).max(15),
  missionKey: missionKeySchema.nullable(),
  orbitalRadiusMetres: z.number().positive(),
  position: coordinateSchema,
  state: controllerStateSchema,
  telemetryDrops: uint32Schema,
});

const missionCommandEventSchema = z.object({
  accepted: z.boolean(),
  nodeId: z.number().int().min(0).max(15),
  objective: coordinateSchema,
  timeMs: z.number().int().nonnegative(),
  type: z.literal("mission-command"),
});

const missionCompletionEventSchema = z.object({
  accepted: z.boolean(),
  nodeId: z.number().int().min(0).max(15),
  timeMs: z.number().int().nonnegative(),
  type: z.literal("mission-completion"),
});

const messageFields = {
  missionKey: missionKeySchema,
  score: candidacyScoreSchema,
  sender: z.number().int().min(0).max(15),
};

const messageSchema = z.discriminatedUnion("type", [
  z.object({
    ...messageFields,
    target: z.null(),
    type: z.literal("mission-request"),
  }),
  z.object({
    ...messageFields,
    target: z.number().int().min(0).max(15),
    type: z.literal("candidacy"),
  }),
  z.object({
    ...messageFields,
    target: z.number().int().min(0).max(15),
    type: z.literal("acknowledgement"),
  }),
  z.object({
    ...messageFields,
    target: z.number().int().min(0).max(15),
    type: z.literal("mission-assignment"),
  }),
]);

const messageSentEventSchema = z.object({
  message: messageSchema,
  nodeId: z.number().int().min(0).max(15),
  timeMs: z.number().int().nonnegative(),
  type: z.literal("message-sent"),
});

const deliveryEventFields = {
  message: messageSchema,
  nodeId: z.number().int().min(0).max(15),
  recipientNode: z.number().int().min(0).max(15),
  timeMs: z.number().int().nonnegative(),
};

const messageDroppedEventSchema = z.object({
  ...deliveryEventFields,
  reason: z.enum(["link-unavailable", "scripted-drop"]),
  type: z.literal("message-dropped"),
});

const messageDelayedEventSchema = z.object({
  ...deliveryEventFields,
  deliverAtMs: z.number().int().nonnegative(),
  type: z.literal("message-delayed"),
});

const messageDuplicatedEventSchema = z.object({
  ...deliveryEventFields,
  type: z.literal("message-duplicated"),
});

const delayedMessageDeliveredEventSchema = z.object({
  ...deliveryEventFields,
  type: z.literal("delayed-message-delivered"),
});

const linkChangedEventSchema = z.object({
  connected: z.boolean(),
  nodeId: z.number().int().min(0).max(15),
  recipientNode: z.number().int().min(0).max(15),
  timeMs: z.number().int().nonnegative(),
  type: z.literal("link-changed"),
});

const stateChangedEventSchema = z.object({
  currentState: controllerStateSchema,
  nodeId: z.number().int().min(0).max(15),
  previousState: controllerStateSchema,
  timeMs: z.number().int().nonnegative(),
  type: z.literal("state-changed"),
});

const nodeResetEventSchema = z.object({
  currentState: controllerStateSchema,
  nodeId: z.number().int().min(0).max(15),
  previousState: controllerStateSchema,
  timeMs: z.number().int().nonnegative(),
  type: z.literal("node-reset"),
});

const controllerTelemetryEventFields = {
  bootEpoch: z.number().int().min(1).max(4_294_967_295),
  currentState: controllerStateSchema,
  droppedBefore: uint32Schema,
  missionKey: missionKeySchema.nullable(),
  nodeId: z.number().int().min(0).max(15),
  previousState: controllerStateSchema,
  priority: z.enum(["routine", "operational", "critical"]),
  reason: z.enum([
    "none",
    "mission-initiated",
    "mission-request-accepted",
    "acknowledgement-received",
    "assignment-received",
    "assignment-broadcast",
    "assignment-window-expired",
    "retry-limit-reached",
    "mission-completed",
    "health-quiescent",
    "health-recovered",
    "health-fatal",
    "send-failed",
    "invalid-configuration",
  ]),
  relatedNode: z.number().int().min(0).max(15).nullable(),
  sequence: z.number().int().min(1).max(4_294_967_295),
  timeMs: z.number().int().nonnegative(),
  type: z.literal("controller-telemetry"),
  value: z.number().int().min(0).max(255),
};

const safeStateTelemetryEventFields = {
  ...controllerTelemetryEventFields,
  priority: z.literal("critical"),
  reason: z.enum([
    "health-fatal",
    "invalid-configuration",
    "retry-limit-reached",
  ]),
  relatedNode: z.number().int().min(0).max(15),
};

const controllerTelemetryEventSchema = z.discriminatedUnion("event", [
  z.object({
    ...controllerTelemetryEventFields,
    event: z.literal("state-transition"),
  }),
  z.object({
    ...controllerTelemetryEventFields,
    event: z.literal("mission-proposed"),
    missionKey: missionKeySchema,
  }),
  z.object({
    ...controllerTelemetryEventFields,
    event: z.literal("candidacy-sent"),
    missionKey: missionKeySchema,
    relatedNode: z.number().int().min(0).max(15),
    value: candidacyScoreSchema,
  }),
  z.object({
    ...controllerTelemetryEventFields,
    event: z.literal("candidacy-accepted"),
    missionKey: missionKeySchema,
    relatedNode: z.number().int().min(0).max(15),
    value: candidacyScoreSchema,
  }),
  z.object({
    ...controllerTelemetryEventFields,
    event: z.literal("mission-assigned"),
    missionKey: missionKeySchema,
    relatedNode: z.number().int().min(0).max(15),
  }),
  z.object({
    ...controllerTelemetryEventFields,
    event: z.literal("mission-completed"),
    missionKey: missionKeySchema,
  }),
  z.object({
    ...controllerTelemetryEventFields,
    event: z.literal("mission-failed"),
    missionKey: missionKeySchema,
  }),
  z.object({
    ...controllerTelemetryEventFields,
    event: z.literal("health-changed"),
  }),
  z.object({
    ...controllerTelemetryEventFields,
    event: z.literal("transport-failure"),
    missionKey: missionKeySchema,
  }),
  z.object({
    ...safeStateTelemetryEventFields,
    event: z.literal("safe-state-requested"),
    value: z.literal(0),
  }),
  z.object({
    ...safeStateTelemetryEventFields,
    event: z.literal("safe-state-result"),
    value: z.union([z.literal(0), z.literal(1)]),
  }),
  z.object({
    ...safeStateTelemetryEventFields,
    event: z.literal("safe-state-execution-result"),
    value: z.union([z.literal(1), z.literal(2)]),
  }),
]);

const simulationSchema = z.object({
  events: z.array(
    z.union([
      missionCommandEventSchema,
      missionCompletionEventSchema,
      messageSentEventSchema,
      messageDroppedEventSchema,
      messageDelayedEventSchema,
      messageDuplicatedEventSchema,
      delayedMessageDeliveredEventSchema,
      linkChangedEventSchema,
      nodeResetEventSchema,
      stateChangedEventSchema,
      controllerTelemetryEventSchema,
    ]),
  ),
  frames: z
    .array(
      z.object({
        nodes: z.array(nodeSchema).min(1).max(16),
        playbackMultiplier: z.number().positive(),
        timeMs: z.number().int().nonnegative(),
      }),
    )
    .min(1),
  objective: coordinateSchema,
  positionModel: z.string().min(1),
  propagationFrame: z.literal("TEME"),
  renderingFrame: z.string().min(1),
  scenario: z.string().min(1),
  scenarioEpochUnixMilliseconds: z.number().int(),
  schemaVersion: z.literal(7),
  source: z.literal("portable C++ SimulationTrace"),
  sourceRevision: z.string().regex(/^[0-9a-f]{40}$/),
  traceVersion: z.literal(5),
});

export type SatelliteSwarmSimulation = z.infer<typeof simulationSchema>;
export type SatelliteSwarmFrame = SatelliteSwarmSimulation["frames"][number];
export type SatelliteSwarmEvent = SatelliteSwarmSimulation["events"][number];

export function parseSatelliteSwarmSimulation(
  input: unknown,
): SatelliteSwarmSimulation {
  return simulationSchema.parse(input);
}

export function describeSatelliteSwarmEvent(
  event: SatelliteSwarmEvent,
): string {
  switch (event.type) {
    case "mission-command":
      return `Node ${event.nodeId} ${event.accepted ? "accepted" : "rejected"} the mission command.`;
    case "mission-completion":
      return `Node ${event.nodeId} ${event.accepted ? "completed its active mission" : "rejected the completion command"}.`;
    case "state-changed":
      return `Node ${event.nodeId} changed from ${event.previousState} to ${event.currentState}.`;
    case "node-reset":
      return `Node ${event.nodeId} reset from ${event.previousState} to ${event.currentState}.`;
    case "link-changed":
      return `Link ${event.nodeId} to node ${event.recipientNode} ${event.connected ? "connected" : "disconnected"}.`;
    case "message-dropped": {
      const reason =
        event.reason === "link-unavailable"
          ? "because the link was unavailable"
          : "by the fault schedule";
      return `Node ${event.nodeId}'s ${event.message.type} to node ${event.recipientNode} was dropped ${reason}.`;
    }
    case "message-delayed":
      return `Node ${event.nodeId}'s ${event.message.type} to node ${event.recipientNode} was delayed until ${event.deliverAtMs} ms.`;
    case "message-duplicated":
      return `Node ${event.nodeId}'s ${event.message.type} was delivered twice to node ${event.recipientNode}.`;
    case "delayed-message-delivered":
      return `Node ${event.nodeId}'s delayed ${event.message.type} reached node ${event.recipientNode}.`;
    case "controller-telemetry":
      return describeControllerTelemetryEvent(event);
    case "message-sent":
      return describeMessageSentEvent(event);
  }
}

function describeControllerTelemetryEvent(
  event: Extract<SatelliteSwarmEvent, { type: "controller-telemetry" }>,
): string {
  const sequence = `Telemetry ${event.nodeId}:${event.bootEpoch}:${event.sequence}`;
  const mission = event.missionKey
    ? ` mission ${formatMissionKey(event.missionKey)}`
    : "";
  const dropped =
    event.droppedBefore > 0
      ? ` ${event.droppedBefore} earlier records had been dropped.`
      : "";

  switch (event.event) {
    case "state-transition":
      return `${sequence} records ${event.previousState} to ${event.currentState} because of ${event.reason}.${dropped}`;
    case "mission-proposed":
      return `${sequence} records proposed${mission}.${dropped}`;
    case "candidacy-sent":
      return `${sequence} records score ${event.value} sent to node ${event.relatedNode} for${mission}.${dropped}`;
    case "candidacy-accepted":
      return `${sequence} records score ${event.value} from node ${event.relatedNode} for${mission}.${dropped}`;
    case "mission-assigned":
      return `${sequence} records${mission} assigned to node ${event.relatedNode}.${dropped}`;
    case "mission-completed":
      return `${sequence} records${mission} completed.${dropped}`;
    case "mission-failed":
      return `${sequence} records${mission} failed because of ${event.reason}.${dropped}`;
    case "health-changed":
      return `${sequence} records health change ${event.reason}.${dropped}`;
    case "transport-failure":
      return `${sequence} records a send failure for${mission}.${dropped}`;
    case "safe-state-requested":
      return `${sequence} requests platform safe state because of ${event.reason}.${dropped}`;
    case "safe-state-result": {
      const result = event.value === 1 ? "accepted" : "rejected";
      return `${sequence} records that the platform ${result} its safe-state request.${dropped}`;
    }
    case "safe-state-execution-result": {
      const result = event.value === 1 ? "succeeded" : "failed";
      return `${sequence} records that the platform safe-state action ${result}.${dropped}`;
    }
  }
}

function describeMessageSentEvent(
  event: Extract<SatelliteSwarmEvent, { type: "message-sent" }>,
): string {
  switch (event.message.type) {
    case "mission-request":
      return `Node ${event.nodeId} broadcast mission ${formatMissionKey(event.message.missionKey)}.`;
    case "candidacy":
      return `Node ${event.nodeId} sent score ${event.message.score} to node ${event.message.target}.`;
    case "acknowledgement":
      return `Node ${event.nodeId} acknowledged node ${event.message.target}.`;
    case "mission-assignment":
      return `Node ${event.nodeId} assigned mission ${formatMissionKey(event.message.missionKey)} to node ${event.message.target}.`;
  }
}

function formatMissionKey(
  missionKey: z.infer<typeof missionKeySchema>,
): string {
  return `${missionKey.originNode}:${missionKey.bootEpoch}:${missionKey.sequence}`;
}
