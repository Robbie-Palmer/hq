import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  describeSatelliteSwarmEvent,
  parseSatelliteSwarmSimulation,
} from "@/lib/api/satellite-swarm-simulation";

const validRecord = {
  schemaVersion: 6,
  traceVersion: 5,
  scenario: "test",
  source: "portable C++ SimulationTrace",
  sourceRevision: "0123456789abcdef0123456789abcdef01234567",
  positionModel: "scripted",
  objective: { longitudeDegrees: 0, latitudeDegrees: -90 },
  frames: [
    {
      timeMs: 0,
      nodes: [
        {
          id: 0,
          bootEpoch: 1,
          state: "leading",
          position: { longitudeDegrees: 0, latitudeDegrees: 10 },
          orbitalRadiusMetres: 6_750_000,
          candidacyScore: 81,
          telemetryDrops: 0,
          missionKey: { bootEpoch: 1, originNode: 0, sequence: 1 },
          assignedNode: null,
        },
      ],
    },
  ],
  events: [
    {
      type: "message-sent",
      timeMs: 0,
      nodeId: 0,
      message: {
        type: "candidacy",
        sender: 0,
        target: 1,
        missionKey: { bootEpoch: 1, originNode: 0, sequence: 1 },
        score: 81,
      },
    },
  ],
} as const;

describe("satellite swarm simulation records", () => {
  it("accepts the committed native fixture", () => {
    const fixture = JSON.parse(
      readFileSync(
        "public/simulations/autonomic-satellite-swarm/demonstration.v6.json",
        "utf8",
      ),
    );

    expect(
      parseSatelliteSwarmSimulation({
        ...fixture,
        sourceRevision: validRecord.sourceRevision,
      }).events.some((event) => event.type === "controller-telemetry"),
    ).toBe(true);
  });

  it("accepts the versioned portable trace contract", () => {
    const parsed = parseSatelliteSwarmSimulation(validRecord);
    const event = parsed.events[0];
    if (!event) throw new Error("Expected one simulation event");

    expect(parsed.frames[0]?.nodes[0]?.candidacyScore).toBe(81);
    expect(describeSatelliteSwarmEvent(event)).toBe(
      "Node 0 sent score 81 to node 1.",
    );
  });

  it("rejects unknown versions and invalid coordinates", () => {
    expect(() =>
      parseSatelliteSwarmSimulation({ ...validRecord, schemaVersion: 1 }),
    ).toThrow();
    expect(() =>
      parseSatelliteSwarmSimulation({
        ...validRecord,
        objective: { longitudeDegrees: 0, latitudeDegrees: -91 },
      }),
    ).toThrow();
  });

  it("describes deterministic network fault evidence", () => {
    const record = parseSatelliteSwarmSimulation({
      ...validRecord,
      events: [
        {
          message: {
            missionKey: { bootEpoch: 1, originNode: 0, sequence: 1 },
            score: 0,
            sender: 0,
            target: 1,
            type: "mission-assignment",
          },
          nodeId: 0,
          reason: "scripted-drop",
          recipientNode: 1,
          timeMs: 100,
          type: "message-dropped",
        },
      ],
    });
    const [event] = record.events;
    if (!event) throw new Error("Expected one simulation event");

    expect(describeSatelliteSwarmEvent(event)).toBe(
      "Node 0's mission-assignment to node 1 was dropped by the fault schedule.",
    );
  });

  it("describes every replay event variant", () => {
    const message = {
      missionKey: { bootEpoch: 1, originNode: 0, sequence: 1 },
      score: 0,
      sender: 0,
      target: 1,
      type: "mission-assignment",
    } as const;
    const record = parseSatelliteSwarmSimulation({
      ...validRecord,
      events: [
        {
          accepted: false,
          nodeId: 0,
          objective: validRecord.objective,
          timeMs: 0,
          type: "mission-command",
        },
        {
          accepted: true,
          nodeId: 1,
          timeMs: 5,
          type: "mission-completion",
        },
        {
          currentState: "idle",
          nodeId: 1,
          previousState: "safe-disabled",
          timeMs: 10,
          type: "node-reset",
        },
        {
          connected: false,
          nodeId: 0,
          recipientNode: 1,
          timeMs: 20,
          type: "link-changed",
        },
        {
          connected: true,
          nodeId: 0,
          recipientNode: 1,
          timeMs: 30,
          type: "link-changed",
        },
        {
          message,
          nodeId: 0,
          reason: "link-unavailable",
          recipientNode: 1,
          timeMs: 40,
          type: "message-dropped",
        },
        {
          deliverAtMs: 60,
          message,
          nodeId: 0,
          recipientNode: 1,
          timeMs: 50,
          type: "message-delayed",
        },
        {
          message,
          nodeId: 0,
          recipientNode: 1,
          timeMs: 60,
          type: "message-duplicated",
        },
        {
          message,
          nodeId: 0,
          recipientNode: 1,
          timeMs: 70,
          type: "delayed-message-delivered",
        },
        {
          currentState: "active",
          nodeId: 1,
          previousState: "awaiting assignment",
          timeMs: 80,
          type: "state-changed",
        },
        {
          message: {
            ...message,
            sender: 1,
            score: 72,
            target: 0,
            type: "candidacy",
          },
          nodeId: 1,
          timeMs: 90,
          type: "message-sent",
        },
        {
          message: { ...message, type: "acknowledgement" },
          nodeId: 0,
          timeMs: 100,
          type: "message-sent",
        },
        {
          message,
          nodeId: 0,
          timeMs: 110,
          type: "message-sent",
        },
        {
          message: { ...message, target: null, type: "mission-request" },
          nodeId: 0,
          timeMs: 120,
          type: "message-sent",
        },
        {
          bootEpoch: 1,
          currentState: "active",
          droppedBefore: 2,
          event: "mission-assigned",
          missionKey: message.missionKey,
          nodeId: 1,
          previousState: "idle",
          priority: "critical",
          reason: "assignment-received",
          relatedNode: 1,
          sequence: 7,
          timeMs: 130,
          type: "controller-telemetry",
          value: 0,
        },
      ],
    });

    expect(
      record.events.map((event) => describeSatelliteSwarmEvent(event)),
    ).toEqual([
      "Node 0 rejected the mission command.",
      "Node 1 completed its active mission.",
      "Node 1 reset from safe-disabled to idle.",
      "Link 0 to node 1 disconnected.",
      "Link 0 to node 1 connected.",
      "Node 0's mission-assignment to node 1 was dropped because the link was unavailable.",
      "Node 0's mission-assignment to node 1 was delayed until 60 ms.",
      "Node 0's mission-assignment was delivered twice to node 1.",
      "Node 0's delayed mission-assignment reached node 1.",
      "Node 1 changed from awaiting assignment to active.",
      "Node 1 sent score 72 to node 0.",
      "Node 0 acknowledged node 1.",
      "Node 0 assigned mission 0:1:1 to node 1.",
      "Node 0 broadcast mission 0:1:1.",
      "Telemetry 1:1:7 records mission 0:1:1 assigned to node 1. 2 earlier records had been dropped.",
    ]);
  });

  it("accepts only mission requests as broadcasts", () => {
    const messageEvent = validRecord.events[0];

    expect(() =>
      parseSatelliteSwarmSimulation({
        ...validRecord,
        events: [
          {
            ...messageEvent,
            message: { ...messageEvent.message, target: null },
          },
        ],
      }),
    ).toThrow();

    expect(() =>
      parseSatelliteSwarmSimulation({
        ...validRecord,
        events: [
          {
            ...messageEvent,
            message: {
              ...messageEvent.message,
              target: 1,
              type: "mission-request",
            },
          },
        ],
      }),
    ).toThrow();

    expect(
      parseSatelliteSwarmSimulation({
        ...validRecord,
        events: [
          {
            ...messageEvent,
            message: {
              ...messageEvent.message,
              target: null,
              type: "mission-request",
            },
          },
        ],
      }).events,
    ).toHaveLength(1);
  });

  it("describes every controller telemetry variant", () => {
    const missionKey = { bootEpoch: 1, originNode: 0, sequence: 1 };
    const telemetry = {
      bootEpoch: 1,
      currentState: "idle",
      droppedBefore: 0,
      missionKey: null,
      nodeId: 1,
      previousState: "idle",
      priority: "operational",
      reason: "none",
      relatedNode: null,
      sequence: 1,
      timeMs: 0,
      type: "controller-telemetry",
      value: 0,
    } as const;
    const record = parseSatelliteSwarmSimulation({
      ...validRecord,
      events: [
        { ...telemetry, event: "state-transition", reason: "health-recovered" },
        { ...telemetry, event: "mission-proposed", missionKey, sequence: 2 },
        {
          ...telemetry,
          event: "candidacy-sent",
          missionKey,
          relatedNode: 0,
          sequence: 3,
          value: 72,
        },
        {
          ...telemetry,
          event: "candidacy-accepted",
          missionKey,
          relatedNode: 2,
          sequence: 4,
          value: 61,
        },
        {
          ...telemetry,
          event: "mission-assigned",
          missionKey,
          relatedNode: 1,
          sequence: 5,
        },
        { ...telemetry, event: "mission-completed", missionKey, sequence: 6 },
        {
          ...telemetry,
          event: "mission-failed",
          missionKey,
          reason: "retry-limit-reached",
          sequence: 7,
        },
        {
          ...telemetry,
          event: "health-changed",
          reason: "health-quiescent",
          sequence: 8,
        },
        { ...telemetry, event: "transport-failure", missionKey, sequence: 9 },
        {
          ...telemetry,
          event: "safe-state-requested",
          priority: "critical",
          reason: "health-fatal",
          relatedNode: 1,
          sequence: 10,
        },
        {
          ...telemetry,
          event: "safe-state-result",
          priority: "critical",
          reason: "health-fatal",
          relatedNode: 1,
          sequence: 11,
          value: 0,
        },
        {
          ...telemetry,
          event: "safe-state-result",
          priority: "critical",
          reason: "retry-limit-reached",
          relatedNode: 1,
          sequence: 12,
          value: 1,
        },
        {
          ...telemetry,
          event: "safe-state-execution-result",
          priority: "critical",
          reason: "health-fatal",
          relatedNode: 1,
          sequence: 13,
          value: 1,
        },
        {
          ...telemetry,
          event: "safe-state-execution-result",
          priority: "critical",
          reason: "retry-limit-reached",
          relatedNode: 1,
          sequence: 14,
          value: 2,
        },
      ],
    });

    expect(
      record.events.map((event) => describeSatelliteSwarmEvent(event)),
    ).toEqual([
      "Telemetry 1:1:1 records idle to idle because of health-recovered.",
      "Telemetry 1:1:2 records proposed mission 0:1:1.",
      "Telemetry 1:1:3 records score 72 sent to node 0 for mission 0:1:1.",
      "Telemetry 1:1:4 records score 61 from node 2 for mission 0:1:1.",
      "Telemetry 1:1:5 records mission 0:1:1 assigned to node 1.",
      "Telemetry 1:1:6 records mission 0:1:1 completed.",
      "Telemetry 1:1:7 records mission 0:1:1 failed because of retry-limit-reached.",
      "Telemetry 1:1:8 records health change health-quiescent.",
      "Telemetry 1:1:9 records a send failure for mission 0:1:1.",
      "Telemetry 1:1:10 requests platform safe state because of health-fatal.",
      "Telemetry 1:1:11 records that the platform rejected its safe-state request.",
      "Telemetry 1:1:12 records that the platform accepted its safe-state request.",
      "Telemetry 1:1:13 records that the platform safe-state action succeeded.",
      "Telemetry 1:1:14 records that the platform safe-state action failed.",
    ]);

    expect(() =>
      parseSatelliteSwarmSimulation({
        ...validRecord,
        events: [{ ...telemetry, droppedBefore: 4_294_967_296 }],
      }),
    ).toThrow();

    for (const event of [
      "mission-proposed",
      "candidacy-sent",
      "candidacy-accepted",
      "mission-assigned",
      "mission-completed",
      "mission-failed",
      "transport-failure",
    ] as const) {
      expect(() =>
        parseSatelliteSwarmSimulation({
          ...validRecord,
          events: [{ ...telemetry, event, missionKey: null }],
        }),
      ).toThrow();
    }

    for (const event of [
      "candidacy-sent",
      "candidacy-accepted",
      "mission-assigned",
    ] as const) {
      expect(() =>
        parseSatelliteSwarmSimulation({
          ...validRecord,
          events: [{ ...telemetry, event, missionKey, relatedNode: null }],
        }),
      ).toThrow();
    }

    for (const event of ["candidacy-sent", "candidacy-accepted"] as const) {
      expect(() =>
        parseSatelliteSwarmSimulation({
          ...validRecord,
          events: [
            { ...telemetry, event, missionKey, relatedNode: 0, value: 101 },
          ],
        }),
      ).toThrow();
    }

    for (const event of [
      "safe-state-requested",
      "safe-state-result",
      "safe-state-execution-result",
    ] as const) {
      expect(() =>
        parseSatelliteSwarmSimulation({
          ...validRecord,
          events: [{ ...telemetry, event, relatedNode: null }],
        }),
      ).toThrow();
    }

    expect(() =>
      parseSatelliteSwarmSimulation({
        ...validRecord,
        events: [
          {
            ...telemetry,
            event: "safe-state-result",
            relatedNode: 1,
            value: 2,
          },
        ],
      }),
    ).toThrow();

    for (const value of [0, 3]) {
      expect(() =>
        parseSatelliteSwarmSimulation({
          ...validRecord,
          events: [
            {
              ...telemetry,
              event: "safe-state-execution-result",
              relatedNode: 1,
              value,
            },
          ],
        }),
      ).toThrow();
    }

    expect(() =>
      parseSatelliteSwarmSimulation({
        ...validRecord,
        events: [
          {
            ...telemetry,
            event: "safe-state-requested",
            relatedNode: 1,
          },
        ],
      }),
    ).toThrow();
  });

  it("bounds per-node telemetry drops to an unsigned 32-bit counter", () => {
    const frame = validRecord.frames[0];
    const node = frame.nodes[0];

    expect(() =>
      parseSatelliteSwarmSimulation({
        ...validRecord,
        frames: [
          {
            ...frame,
            nodes: [{ ...node, telemetryDrops: 4_294_967_296 }],
          },
        ],
      }),
    ).toThrow();
  });
});
