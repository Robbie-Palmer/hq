import { describe, expect, it, vi } from "vitest";

import {
  AdvisoryDecisionSchema,
  type AdvisoryMatchingError,
  confirmAdvisoryDecision,
  createAdvisoryDecision,
  declineAdvisoryDecision,
  requestAnotherAdvisoryDecision,
  type ActorProfile,
  type AdvisoryMatchingInput,
  type AdvisoryTaskCandidate,
  type AdvisoryWorkerCandidate,
  type WorkGraphWorkItem,
} from "../src";
import {
  actor as actorFixture,
  adapter as adapterFixture,
  complexityScale,
  policy,
  task as taskFixture,
} from "./fixtures";

const NOW = Date.parse("2026-09-27T12:05:00.000Z");
const OBSERVED_AT = "2026-09-27T12:00:00.000Z";
const VALID_UNTIL = "2026-09-27T12:10:00.000Z";

const workItem = (
  id: string,
  overrides: Partial<WorkGraphWorkItem> = {},
): WorkGraphWorkItem => ({
  id,
  title: `Work ${id}`,
  lifecycle: "open",
  parentId: "outcome:coordinator",
  rank: 1_024,
  priorityRank: null,
  schedulingInitiativeId: "initiative:agents",
  schedulingProjectId: "project:coordinator",
  expedited: false,
  expediteReason: null,
  stage: "ready",
  currentLease: null,
  priority: {
    initiativeRank: 1,
    projectRank: 2,
    ticketRank: 3,
    expedited: false,
    effectiveExpedited: false,
    donatedFromWorkItemId: null,
  },
  ...overrides,
});

const taskCandidate = (
  id: string,
  options: {
    expectedValue?: number;
    priority?: Partial<WorkGraphWorkItem["priority"]>;
  } = {},
): AdvisoryTaskCandidate => ({
  workItem: workItem(id, {
    priority: {
      ...workItem(id).priority,
      ...options.priority,
    },
  }),
  task: { ...taskFixture, taskId: id },
  contextSummary: `Implement ${id} and return its required evidence.`,
  expectedValue: {
    value: options.expectedValue ?? 80,
    basis: "Owner impact estimate",
    observedAt: OBSERVED_AT,
  },
});

const workerCandidate = (
  actorId: string,
  options: {
    declaredLevel?: number;
    observedLevel?: number;
    cost?: number;
    providerContext?: number;
    handoffCost?: number;
    funding?: ActorProfile["cost"]["funding"];
    resetsAt?: string;
    access?: string[];
  } = {},
): AdvisoryWorkerCandidate => {
  const workerActor: ActorProfile = {
    ...actorFixture,
    actorId,
    access: options.access ?? actorFixture.access,
    declaredCapabilities: actorFixture.declaredCapabilities.map(
      (capability) => ({
        ...capability,
        level: options.declaredLevel ?? capability.level,
      }),
    ),
    observedCapabilities: actorFixture.observedCapabilities.map(
      (capability) => ({
        ...capability,
        level: options.observedLevel ?? capability.level,
      }),
    ),
    cost: {
      funding: options.funding ?? actorFixture.cost.funding,
      estimatedSessionCost: {
        currency: "USD",
        amount: options.cost ?? actorFixture.cost.estimatedSessionCost.amount,
      },
    },
    resourceAvailability: actorFixture.resourceAvailability.map((resource) =>
      resource.resource === "provider-context"
        ? {
            ...resource,
            amount: options.providerContext ?? resource.amount,
            ...(options.resetsAt ? { resetsAt: options.resetsAt } : {}),
          }
        : resource,
    ),
  };
  return {
    actor: workerActor,
    adapter: {
      ...adapterFixture,
      actorId,
      adapterId: `adapter:${actorId.replace("actor:", "")}`,
    },
    activeSessions: 1,
    activeSessionsForActor: 0,
    activeSessionsByWorkClass: [
      { workClass: "code.change", activeSessions: 1 },
    ],
    handoffCost: {
      value: options.handoffCost ?? 5,
      basis: "Expected context reconstruction effort",
      observedAt: OBSERVED_AT,
    },
  };
};

const input = (
  options: {
    tasks?: AdvisoryTaskCandidate[];
    workers?: AdvisoryWorkerCandidate[];
    minimumExpectedValue?: number;
    validUntil?: string;
  } = {},
): AdvisoryMatchingInput => ({
  queue: {
    revision: "ready:42",
    observedAt: OBSERVED_AT,
    validUntil: options.validUntil ?? VALID_UNTIL,
    items: options.tasks ?? [taskCandidate("work:matching")],
  },
  workerInventory: {
    revision: "workers:17",
    observedAt: OBSERVED_AT,
    workers: options.workers ?? [workerCandidate("actor:alpha")],
  },
  complexityScales: [complexityScale],
  policy,
  settings: {
    minimumExpectedValue: options.minimumExpectedValue ?? 10,
    leaseDurationSeconds: 900,
    rankingCurrency: "USD",
  },
});

const suggested = (matchingInput: AdvisoryMatchingInput) => {
  const decision = createAdvisoryDecision(matchingInput, { now: NOW });
  if (decision.status !== "suggested") {
    throw new Error(`Expected a suggestion, got ${decision.reason}`);
  }
  return decision;
};

describe("advisory matching", () => {
  it("returns the same explainable decision for the same snapshot and observations", () => {
    const matchingInput = input();
    const first = createAdvisoryDecision(matchingInput, { now: NOW });
    const second = createAdvisoryDecision(matchingInput, { now: NOW });

    expect(first).toEqual(second);
    expect(AdvisoryDecisionSchema.parse(first)).toEqual(first);
    expect(first).toMatchObject({
      status: "suggested",
      basis: {
        queueRevision: "ready:42",
        workerInventoryRevision: "workers:17",
        policy: { revision: 1 },
      },
      proposal: {
        task: {
          id: "work:matching",
          contextSummary:
            "Implement work:matching and return its required evidence.",
        },
        worker: { actorId: "actor:alpha" },
        scoreInputs: {
          expectedValue: 80,
          declaredCapabilityMargin: 1,
          observedCapabilityMargin: 0,
          declaredSessionCost: { currency: "USD", amount: 2 },
          handoffCost: 5,
        },
        budget: {
          maximumPerSession: { currency: "USD", amount: 5 },
          remaining: { currency: "USD", amount: 20 },
        },
        claimEffect: {
          currentStage: "ready",
          claimedStage: "in_progress",
          leaseDurationSeconds: 900,
        },
      },
    });
  });

  it("does not let queue or inventory order change the decision", () => {
    const tasks = [
      taskCandidate("work:alpha"),
      taskCandidate("work:beta"),
    ];
    const workers = [
      workerCandidate("actor:alpha"),
      workerCandidate("actor:beta"),
    ];
    const first = createAdvisoryDecision(input({ tasks, workers }), {
      now: NOW,
    });
    const reordered = createAdvisoryDecision(
      input({ tasks: [...tasks].reverse(), workers: [...workers].reverse() }),
      { now: NOW },
    );

    expect(reordered).toEqual(first);
  });

  it("records hard exclusions before ranking and never scores an unsafe pair", () => {
    const decision = createAdvisoryDecision(
      input({
        workers: [workerCandidate("actor:no-access", { access: [] })],
      }),
      { now: NOW },
    );

    expect(decision).toMatchObject({
      status: "idle",
      reason: "no-eligible-pair",
      evaluations: [
        {
          eligible: false,
          suitable: false,
          suitabilityReason: "hard-exclusion",
          scoreInputs: null,
          hardExclusions: [{ code: "required-access-missing" }],
        },
      ],
      exclusions: [{ pairing: { actorId: "actor:no-access" } }],
    });
  });

  it("orders eligible work by graph priority, then expected value", () => {
    const lowerPriority = taskCandidate("work:lower-priority", {
      expectedValue: 100,
      priority: { ticketRank: 4 },
    });
    const higherPriority = taskCandidate("work:higher-priority", {
      expectedValue: 20,
      priority: { ticketRank: 2 },
    });
    expect(
      suggested(input({ tasks: [lowerPriority, higherPriority] })).proposal.task
        .id,
    ).toBe("work:higher-priority");

    const lowValue = taskCandidate("work:low-value", { expectedValue: 40 });
    const highValue = taskCandidate("work:high-value", { expectedValue: 90 });
    expect(
      suggested(input({ tasks: [lowValue, highValue] })).proposal.task.id,
    ).toBe("work:high-value");
  });

  it("uses capability fit, cost, capacity, and handoff cost in that order", () => {
    const weaker = workerCandidate("actor:weaker", {
      declaredLevel: 4,
      cost: 1,
      providerContext: 90_000,
      handoffCost: 0,
    });
    const stronger = workerCandidate("actor:stronger", {
      declaredLevel: 5,
      cost: 4,
      providerContext: 13_000,
      handoffCost: 20,
    });
    expect(
      suggested(input({ workers: [weaker, stronger] })).proposal.worker.actorId,
    ).toBe("actor:stronger");

    const expensive = workerCandidate("actor:expensive", {
      cost: 4,
      providerContext: 90_000,
      handoffCost: 0,
    });
    const cheap = workerCandidate("actor:cheap", {
      cost: 1,
      providerContext: 13_000,
      handoffCost: 20,
    });
    expect(
      suggested(input({ workers: [expensive, cheap] })).proposal.worker.actorId,
    ).toBe("actor:cheap");

    const tightCapacity = workerCandidate("actor:tight", {
      providerContext: 13_000,
      handoffCost: 0,
    });
    const ampleCapacity = workerCandidate("actor:ample", {
      providerContext: 90_000,
      handoffCost: 20,
    });
    expect(
      suggested(input({ workers: [tightCapacity, ampleCapacity] })).proposal
        .worker.actorId,
    ).toBe("actor:ample");

    const costlyHandoff = workerCandidate("actor:costly-handoff", {
      handoffCost: 10,
    });
    const easyHandoff = workerCandidate("actor:easy-handoff", {
      handoffCost: 2,
    });
    expect(
      suggested(input({ workers: [costlyHandoff, easyHandoff] })).proposal.worker
        .actorId,
    ).toBe("actor:easy-handoff");
  });

  it("uses expiring prepaid capacity only after the main scores tie", () => {
    const weakPrepaid = workerCandidate("actor:prepaid-weak", {
      declaredLevel: 4,
      funding: "prepaid",
      resetsAt: "2026-09-27T13:00:00.000Z",
    });
    const strongMetered = workerCandidate("actor:metered-strong", {
      declaredLevel: 5,
    });
    expect(
      suggested(input({ workers: [weakPrepaid, strongMetered] })).proposal.worker
        .actorId,
    ).toBe("actor:metered-strong");

    const equalMetered = workerCandidate("actor:a-metered");
    const equalPrepaid = workerCandidate("actor:z-prepaid", {
      funding: "prepaid",
      resetsAt: "2026-09-27T13:00:00.000Z",
    });
    expect(
      suggested(input({ workers: [equalMetered, equalPrepaid] })).proposal.worker
        .actorId,
    ).toBe("actor:z-prepaid");
  });

  it("leaves capacity idle when no pair is eligible or work is below the value floor", () => {
    const noWorkers = createAdvisoryDecision(input({ workers: [] }), {
      now: NOW,
    });
    expect(noWorkers).toMatchObject({ status: "idle", reason: "no-workers" });

    const belowFloor = createAdvisoryDecision(
      input({
        tasks: [taskCandidate("work:small", { expectedValue: 9 })],
        minimumExpectedValue: 10,
      }),
      { now: NOW },
    );
    expect(belowFloor).toMatchObject({
      status: "idle",
      reason: "below-value-floor",
      evaluations: [
        {
          eligible: true,
          suitable: false,
          suitabilityReason: "below-value-floor",
        },
      ],
    });
  });

  it("breaks otherwise equal candidates by stable identifiers", () => {
    const beta = workerCandidate("actor:beta");
    const alpha = workerCandidate("actor:alpha");
    expect(
      suggested(input({ workers: [beta, alpha] })).proposal.worker.actorId,
    ).toBe("actor:alpha");
  });

  it("rejects stale ready-queue data", () => {
    expect(() =>
      createAdvisoryDecision(
        input({ validUntil: "2026-09-27T12:04:59.000Z" }),
        { now: NOW },
      ),
    ).toThrowError(
      expect.objectContaining<Partial<AdvisoryMatchingError>>({
        code: "queue-stale",
      }),
    );
  });

  it("supports decline and another suggestion without claiming", () => {
    const matchingInput = input({
      workers: [
        workerCandidate("actor:alpha"),
        workerCandidate("actor:beta"),
      ],
    });
    const first = suggested(matchingInput);
    const claim = vi.fn();

    expect(declineAdvisoryDecision(first)).toMatchObject({
      status: "declined",
      pairing: first.proposal.pairing,
    });
    const another = requestAnotherAdvisoryDecision(first, matchingInput, {
      now: NOW,
    });

    expect(claim).not.toHaveBeenCalled();
    expect(another).toMatchObject({
      status: "suggested",
      proposal: { worker: { actorId: "actor:beta" } },
    });
  });

  it("claims only after confirmation and refuses changed policy", async () => {
    const matchingInput = input();
    const decision = suggested(matchingInput);
    const claim = vi.fn(async (_task, claimInput) => ({ claimInput }));

    expect(claim).not.toHaveBeenCalled();
    await expect(
      confirmAdvisoryDecision(decision, matchingInput, { claim }, { now: NOW }),
    ).resolves.toEqual({
      claimInput: { workerId: "actor:alpha", leaseDurationSeconds: 900 },
    });
    expect(claim).toHaveBeenCalledTimes(1);

    const changedPolicyInput = {
      ...matchingInput,
      policy: {
        ...policy,
        revision: policy.revision + 1,
        concurrency: {
          ...policy.concurrency,
          maximumActiveSessions: 3,
        },
      },
    };
    await expect(
      confirmAdvisoryDecision(
        decision,
        changedPolicyInput,
        { claim },
        { now: NOW },
      ),
    ).rejects.toMatchObject({ code: "decision-stale" });
    expect(claim).toHaveBeenCalledTimes(1);
  });
});
