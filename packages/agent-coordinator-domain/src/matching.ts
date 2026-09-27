import { z } from "zod";

import { type ActorProfile, ActorProfileSchema } from "./actor";
import {
  type CompatibilityResult,
  evaluateCompatibility,
  HardExclusionSchema,
} from "./compatibility";
import { ComplexityScaleSchema } from "./complexity";
import { OwnerPolicySchema } from "./policy";
import {
  type RoutingState,
  WorkerAdapterIdentitySchema,
} from "./session";
import { TaskRequirementsSchema } from "./task";
import {
  compareIdentifiers,
  CurrencySchema,
  findDuplicates,
  IdentifierSchema,
  MoneySchema,
} from "./vocabulary";
import { WorkGraphWorkItemSchema } from "./work-graph";

const TimestampSchema = z.iso.datetime();
const RevisionSchema = z.string().trim().min(1).max(500);
const ScoreSchema = z.number().finite().nonnegative();

export const AdvisoryScoreObservationSchema = z
  .object({
    value: ScoreSchema,
    basis: z.string().trim().min(1).max(500),
    observedAt: TimestampSchema,
  })
  .strict();
export type AdvisoryScoreObservation = z.infer<
  typeof AdvisoryScoreObservationSchema
>;

export const AdvisoryTaskCandidateSchema = z
  .object({
    workItem: WorkGraphWorkItemSchema,
    task: TaskRequirementsSchema,
    contextSummary: z.string().trim().min(1).max(4_000),
    expectedValue: AdvisoryScoreObservationSchema,
  })
  .strict()
  .superRefine(({ task, workItem }, context) => {
    if (task.taskId !== workItem.id) {
      context.addIssue({
        code: "custom",
        message: "task.taskId must match workItem.id",
        path: ["task", "taskId"],
      });
    }
    if (workItem.stage !== "ready" || workItem.lifecycle !== "open") {
      context.addIssue({
        code: "custom",
        message: "advisory matching only accepts open, ready work",
        path: ["workItem", "stage"],
      });
    }
  });
export type AdvisoryTaskCandidate = z.infer<
  typeof AdvisoryTaskCandidateSchema
>;

export const ReadyQueueSnapshotSchema = z
  .object({
    revision: RevisionSchema,
    observedAt: TimestampSchema,
    validUntil: TimestampSchema,
    items: z.array(AdvisoryTaskCandidateSchema),
  })
  .strict()
  .superRefine((snapshot, context) => {
    if (Date.parse(snapshot.validUntil) <= Date.parse(snapshot.observedAt)) {
      context.addIssue({
        code: "custom",
        message: "validUntil must be later than observedAt",
        path: ["validUntil"],
      });
    }
    const duplicates = findDuplicates(
      snapshot.items.map(({ workItem }) => workItem.id),
    );
    if (duplicates.length > 0) {
      context.addIssue({
        code: "custom",
        message: `items contains duplicate work: ${duplicates.join(", ")}`,
        path: ["items"],
      });
    }
  });
export type ReadyQueueSnapshot = z.infer<typeof ReadyQueueSnapshotSchema>;

const WorkClassSessionCountSchema = z
  .object({
    workClass: IdentifierSchema,
    activeSessions: z.number().int().nonnegative(),
  })
  .strict();

export const AdvisoryWorkerCandidateSchema = z
  .object({
    actor: ActorProfileSchema,
    adapter: WorkerAdapterIdentitySchema,
    activeSessions: z.number().int().nonnegative(),
    activeSessionsForActor: z.number().int().nonnegative(),
    activeSessionsByWorkClass: z.array(WorkClassSessionCountSchema),
    handoffCost: AdvisoryScoreObservationSchema,
  })
  .strict()
  .superRefine((worker, context) => {
    const duplicates = findDuplicates(
      worker.activeSessionsByWorkClass.map(({ workClass }) => workClass),
    );
    if (duplicates.length > 0) {
      context.addIssue({
        code: "custom",
        message: `activeSessionsByWorkClass contains duplicate values: ${duplicates.join(", ")}`,
        path: ["activeSessionsByWorkClass"],
      });
    }
  });
export type AdvisoryWorkerCandidate = z.infer<
  typeof AdvisoryWorkerCandidateSchema
>;

export const AdvisoryMatchingInputSchema = z
  .object({
    queue: ReadyQueueSnapshotSchema,
    workers: z.array(AdvisoryWorkerCandidateSchema),
    complexityScales: z.array(ComplexityScaleSchema),
    policy: OwnerPolicySchema,
    settings: z
      .object({
        minimumExpectedValue: ScoreSchema,
        leaseDurationSeconds: z.number().int().min(60).max(86_400),
        rankingCurrency: CurrencySchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((input, context) => {
    const workerKeys = input.workers.map(
      ({ actor, adapter }) => `${actor.actorId}::${adapter.adapterId}`,
    );
    const duplicateWorkers = findDuplicates(workerKeys);
    if (duplicateWorkers.length > 0) {
      context.addIssue({
        code: "custom",
        message: `workers contains duplicate actor and adapter pairs: ${duplicateWorkers.join(", ")}`,
        path: ["workers"],
      });
    }

    const scaleKeys = input.complexityScales.map(
      ({ scaleId, revision }) => `${scaleId}:${revision}`,
    );
    const duplicateScales = findDuplicates(scaleKeys);
    if (duplicateScales.length > 0) {
      context.addIssue({
        code: "custom",
        message: `complexityScales contains duplicate revisions: ${duplicateScales.join(", ")}`,
        path: ["complexityScales"],
      });
    }
  })
  .superRefine((input, context) => {
    const scaleKeys = input.complexityScales.map(
      ({ scaleId, revision }) => `${scaleId}:${revision}`,
    );
    const scales = new Set(scaleKeys);
    for (const [taskIndex, candidate] of input.queue.items.entries()) {
      const scaleKey = `${candidate.task.complexity.scaleId}:${candidate.task.complexity.scaleRevision}`;
      if (!scales.has(scaleKey)) {
        context.addIssue({
          code: "custom",
          message: `missing complexity scale ${scaleKey}`,
          path: ["queue", "items", taskIndex, "task", "complexity"],
        });
      }
      const estimate = candidate.task.estimatedCost;
      if (estimate && estimate.currency !== input.settings.rankingCurrency) {
        context.addIssue({
          code: "custom",
          message: `estimated cost must use ranking currency ${input.settings.rankingCurrency}`,
          path: ["queue", "items", taskIndex, "task", "estimatedCost"],
        });
      }
    }
  })
  .superRefine((input, context) => {
    const workClasses = new Set(
      input.queue.items.map(({ task }) => task.workClass),
    );
    for (const [workerIndex, worker] of input.workers.entries()) {
      if (worker.actor.cost.estimatedSessionCost.currency !== input.settings.rankingCurrency) {
        context.addIssue({
          code: "custom",
          message: `worker cost must use ranking currency ${input.settings.rankingCurrency}`,
          path: ["workers", workerIndex, "actor", "cost"],
        });
      }
      const observedClasses = new Set(
        worker.activeSessionsByWorkClass.map(({ workClass }) => workClass),
      );
      for (const workClass of workClasses) {
        if (!observedClasses.has(workClass)) {
          context.addIssue({
            code: "custom",
            message: `missing active-session observation for ${workClass}`,
            path: ["workers", workerIndex, "activeSessionsByWorkClass"],
          });
        }
      }
    }
  });
export type AdvisoryMatchingInput = z.input<
  typeof AdvisoryMatchingInputSchema
>;

export const AdvisoryScoreInputsSchema = z
  .object({
    workGraphPriority: WorkGraphWorkItemSchema.shape.priority,
    expectedValue: ScoreSchema,
    declaredCapabilityMargin: z.number().finite(),
    observedCapabilityMargin: z.number().finite(),
    estimatedCost: MoneySchema,
    capacityHeadroom: z.number().finite().nonnegative(),
    handoffCost: ScoreSchema,
    prepaidCapacityExpiresAt: z.union([TimestampSchema, z.null()]),
  })
  .strict();
export type AdvisoryScoreInputs = z.infer<typeof AdvisoryScoreInputsSchema>;

export const AdvisoryPairEvaluationSchema = z
  .object({
    pairingId: IdentifierSchema,
    taskId: IdentifierSchema,
    actorId: IdentifierSchema,
    adapterId: IdentifierSchema,
    eligible: z.boolean(),
    suitable: z.boolean(),
    suitabilityReason: z.union([
      z.enum(["eligible", "below-value-floor", "hard-exclusion"]),
      z.null(),
    ]),
    hardExclusions: z.array(HardExclusionSchema),
    scoreInputs: z.union([AdvisoryScoreInputsSchema, z.null()]),
  })
  .strict()
  .superRefine((evaluation, context) => {
    if (evaluation.eligible !== (evaluation.hardExclusions.length === 0)) {
      context.addIssue({
        code: "custom",
        message: "eligible must agree with hardExclusions",
        path: ["eligible"],
      });
    }
    if (evaluation.eligible !== (evaluation.scoreInputs !== null)) {
      context.addIssue({
        code: "custom",
        message: "only eligible pairings have score inputs",
        path: ["scoreInputs"],
      });
    }
  });
export type AdvisoryPairEvaluation = z.infer<
  typeof AdvisoryPairEvaluationSchema
>;

export const AdvisoryBudgetViewSchema = z
  .object({
    estimate: MoneySchema,
    maximumPerSession: z.union([MoneySchema, z.null()]),
    remaining: z.union([MoneySchema, z.null()]),
  })
  .strict();

export const AdvisoryProposalSchema = z
  .object({
    pairingId: IdentifierSchema,
    task: z
      .object({
        id: IdentifierSchema,
        title: z.string().trim().min(1),
        contextSummary: z.string().trim().min(1),
      })
      .strict(),
    worker: z
      .object({
        actorId: IdentifierSchema,
        adapterId: IdentifierSchema,
        adapterVersion: z.string().trim().min(1),
      })
      .strict(),
    scoreInputs: AdvisoryScoreInputsSchema,
    budget: AdvisoryBudgetViewSchema,
    claimEffect: z
      .object({
        workItemId: IdentifierSchema,
        workerId: IdentifierSchema,
        currentStage: z.literal("ready"),
        claimedStage: z.literal("in_progress"),
        leaseDurationSeconds: z.number().int().min(60).max(86_400),
      })
      .strict(),
  })
  .strict();
export type AdvisoryProposal = z.infer<typeof AdvisoryProposalSchema>;

const DecisionBaseSchema = z
  .object({
    decisionId: IdentifierSchema,
    createdAt: TimestampSchema,
    expiresAt: TimestampSchema,
    inputFingerprint: IdentifierSchema,
    queueRevision: RevisionSchema,
    policyId: IdentifierSchema,
    policyRevision: z.number().int().positive(),
    ignoredPairingIds: z.array(IdentifierSchema),
    evaluations: z.array(AdvisoryPairEvaluationSchema),
    exclusions: z.array(AdvisoryPairEvaluationSchema),
  })
  .strict();

export const AdvisoryDecisionViewSchema = DecisionBaseSchema.extend({
  status: z.literal("suggested"),
  proposal: AdvisoryProposalSchema,
}).strict();
export type AdvisoryDecisionView = z.infer<typeof AdvisoryDecisionViewSchema>;

export const AdvisoryIdleDecisionSchema = DecisionBaseSchema.extend({
  status: z.literal("idle"),
  reason: z.enum([
    "no-ready-work",
    "no-workers",
    "no-eligible-pair",
    "below-value-floor",
    "no-alternative",
  ]),
}).strict();
export type AdvisoryIdleDecision = z.infer<typeof AdvisoryIdleDecisionSchema>;

export const AdvisoryDecisionSchema = z.discriminatedUnion("status", [
  AdvisoryDecisionViewSchema,
  AdvisoryIdleDecisionSchema,
]);
export type AdvisoryDecision = z.infer<typeof AdvisoryDecisionSchema>;

export class AdvisoryMatchingError extends Error {
  constructor(
    readonly code: "decision-stale" | "queue-stale",
    message: string,
  ) {
    super(message);
    this.name = "AdvisoryMatchingError";
  }
}

const hash = (value: string): string => {
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 0x01000193);
  }
  return (result >>> 0).toString(16).padStart(8, "0");
};

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value
      .map(canonicalJson)
      .sort((left, right) => left.localeCompare(right, "en"))
      .join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort((left, right) => left.localeCompare(right, "en"))
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

const inputFingerprint = (
  input: z.infer<typeof AdvisoryMatchingInputSchema>,
): string => `snapshot:${hash(canonicalJson(input))}`;

const pairingId = (taskId: string, actorId: string, adapterId: string): string =>
  `pair:${hash(`${taskId}\n${actorId}\n${adapterId}`)}`;

const stateFor = (
  worker: AdvisoryWorkerCandidate,
  workClass: string,
): RoutingState => ({
  activeSessions: worker.activeSessions,
  activeSessionsForActor: worker.activeSessionsForActor,
  activeSessionsForWorkClass:
    worker.activeSessionsByWorkClass.find(
      (observation) => observation.workClass === workClass,
    )?.activeSessions ?? 0,
});

const averageSignal = (
  compatibility: CompatibilityResult,
  code: "declared-capability-margin" | "observed-capability-margin",
): number => {
  const values = compatibility.rankingSignals
    .filter((signal) => signal.code === code)
    .map(({ value }) => value);
  return values.length === 0
    ? 0
    : values.reduce((total, value) => total + value, 0) / values.length;
};

const capacityHeadroom = (
  task: z.infer<typeof TaskRequirementsSchema>,
  actor: ActorProfile,
): number => {
  const ratios = task.requiredResources.map((required) => {
    const available = actor.resourceAvailability.find(
      ({ resource }) => resource === required.resource,
    );
    if (!available || available.unit !== required.unit) return 0;
    const denominator = required.amount === 0 ? 1 : required.amount;
    return (available.amount - required.amount) / denominator;
  });
  return ratios.length === 0 ? 0 : Math.min(...ratios);
};

const prepaidExpiry = (actor: ActorProfile): string | null => {
  if (actor.cost.funding !== "prepaid") return null;
  return (
    actor.resourceAvailability
      .flatMap(({ resetsAt }) => (resetsAt ? [resetsAt] : []))
      .sort((left, right) => left.localeCompare(right, "en"))[0] ?? null
  );
};

const scoreInputs = (
  task: AdvisoryTaskCandidate,
  worker: AdvisoryWorkerCandidate,
  compatibility: CompatibilityResult,
): AdvisoryScoreInputs =>
  AdvisoryScoreInputsSchema.parse({
    workGraphPriority: task.workItem.priority,
    expectedValue: task.expectedValue.value,
    declaredCapabilityMargin: averageSignal(
      compatibility,
      "declared-capability-margin",
    ),
    observedCapabilityMargin: averageSignal(
      compatibility,
      "observed-capability-margin",
    ),
    estimatedCost: worker.actor.cost.estimatedSessionCost,
    capacityHeadroom: capacityHeadroom(task.task, worker.actor),
    handoffCost: worker.handoffCost.value,
    prepaidCapacityExpiresAt: prepaidExpiry(worker.actor),
  });

interface RankedPair {
  task: AdvisoryTaskCandidate;
  worker: AdvisoryWorkerCandidate;
  evaluation: AdvisoryPairEvaluation;
}

const comparePrimaryScores = (
  leftScore: AdvisoryScoreInputs,
  rightScore: AdvisoryScoreInputs,
): number => {
  const priorityComparisons = [
    Number(rightScore.workGraphPriority.effectiveExpedited) -
      Number(leftScore.workGraphPriority.effectiveExpedited),
    leftScore.workGraphPriority.initiativeRank -
      rightScore.workGraphPriority.initiativeRank,
    leftScore.workGraphPriority.projectRank -
      rightScore.workGraphPriority.projectRank,
    leftScore.workGraphPriority.ticketRank -
      rightScore.workGraphPriority.ticketRank,
  ];
  const primaryComparisons = [
    ...priorityComparisons,
    rightScore.expectedValue - leftScore.expectedValue,
    rightScore.observedCapabilityMargin -
      leftScore.observedCapabilityMargin,
    rightScore.declaredCapabilityMargin -
      leftScore.declaredCapabilityMargin,
    leftScore.estimatedCost.amount - rightScore.estimatedCost.amount,
    rightScore.capacityHeadroom - leftScore.capacityHeadroom,
    leftScore.handoffCost - rightScore.handoffCost,
  ];
  const primary = primaryComparisons.find((comparison) => comparison !== 0);
  return primary ?? 0;
};

const comparePrepaidExpiry = (
  leftExpiry: string | null,
  rightExpiry: string | null,
): number => {
  if (leftExpiry === rightExpiry) return 0;
  if (leftExpiry === null) return 1;
  if (rightExpiry === null) return -1;
  return leftExpiry.localeCompare(rightExpiry, "en");
};

const compareRankedPairs = (left: RankedPair, right: RankedPair): number => {
  const leftScore = left.evaluation.scoreInputs;
  const rightScore = right.evaluation.scoreInputs;
  if (!leftScore || !rightScore) return leftScore ? -1 : rightScore ? 1 : 0;
  const primary = comparePrimaryScores(leftScore, rightScore);
  if (primary !== 0) return primary;

  const expiry =
    left.task.task.taskId === right.task.task.taskId
      ? comparePrepaidExpiry(
          leftScore.prepaidCapacityExpiresAt,
          rightScore.prepaidCapacityExpiresAt,
        )
      : 0;
  if (expiry !== 0) return expiry;

  return (
    compareIdentifiers(left.task.task.taskId, right.task.task.taskId) ||
    compareIdentifiers(left.worker.actor.actorId, right.worker.actor.actorId) ||
    compareIdentifiers(
      left.worker.adapter.adapterId,
      right.worker.adapter.adapterId,
    )
  );
};

const budgetView = (
  task: AdvisoryTaskCandidate,
  worker: AdvisoryWorkerCandidate,
  policy: z.infer<typeof OwnerPolicySchema>,
) => {
  const budget = policy.budgets.find(
    ({ workClass }) => workClass === task.task.workClass,
  );
  return AdvisoryBudgetViewSchema.parse({
    estimate: task.task.estimatedCost ?? worker.actor.cost.estimatedSessionCost,
    maximumPerSession: budget?.maximumPerSession ?? null,
    remaining: budget?.remaining ?? null,
  });
};

const evaluatePair = (
  task: AdvisoryTaskCandidate,
  worker: AdvisoryWorkerCandidate,
  input: z.infer<typeof AdvisoryMatchingInputSchema>,
): RankedPair => {
  const scale = input.complexityScales.find(
    ({ scaleId, revision }) =>
      scaleId === task.task.complexity.scaleId &&
      revision === task.task.complexity.scaleRevision,
  );
  if (!scale) throw new Error("Matching input lost its validated complexity scale");
  const compatibility = evaluateCompatibility({
    task: task.task,
    actor: worker.actor,
    complexityScale: scale,
    policy: input.policy,
    adapter: worker.adapter,
    state: stateFor(worker, task.task.workClass),
  });
  const eligible = compatibility.eligible;
  const aboveFloor = task.expectedValue.value >= input.settings.minimumExpectedValue;
  const evaluation = AdvisoryPairEvaluationSchema.parse({
    pairingId: pairingId(
      task.task.taskId,
      worker.actor.actorId,
      worker.adapter.adapterId,
    ),
    taskId: task.task.taskId,
    actorId: worker.actor.actorId,
    adapterId: worker.adapter.adapterId,
    eligible,
    suitable: eligible && aboveFloor,
    suitabilityReason: eligible
      ? aboveFloor
        ? "eligible"
        : "below-value-floor"
      : "hard-exclusion",
    hardExclusions: compatibility.hardExclusions,
    scoreInputs: eligible ? scoreInputs(task, worker, compatibility) : null,
  });
  return { task, worker, evaluation };
};

const idleReason = (
  input: z.infer<typeof AdvisoryMatchingInputSchema>,
  pairs: readonly RankedPair[],
  ignoredPairingIds: ReadonlySet<string>,
): AdvisoryIdleDecision["reason"] => {
  if (input.queue.items.length === 0) return "no-ready-work";
  if (input.workers.length === 0) return "no-workers";
  if (!pairs.some(({ evaluation }) => evaluation.eligible)) {
    return "no-eligible-pair";
  }
  if (!pairs.some(({ evaluation }) => evaluation.suitable)) {
    return "below-value-floor";
  }
  if (
    pairs
      .filter(({ evaluation }) => evaluation.suitable)
      .every(({ evaluation }) => ignoredPairingIds.has(evaluation.pairingId))
  ) {
    return "no-alternative";
  }
  throw new Error("An idle decision requires an idle reason");
};

const assertFreshQueue = (
  queue: ReadyQueueSnapshot,
  now: number,
): void => {
  if (now >= Date.parse(queue.validUntil)) {
    throw new AdvisoryMatchingError(
      "queue-stale",
      `Ready queue ${queue.revision} expired at ${queue.validUntil}`,
    );
  }
};

export function createAdvisoryDecision(
  inputValue: AdvisoryMatchingInput,
  options: { now?: number; ignoredPairingIds?: readonly string[] } = {},
): AdvisoryDecision {
  const input = AdvisoryMatchingInputSchema.parse(inputValue);
  const now = options.now ?? Date.now();
  assertFreshQueue(input.queue, now);
  const ignoredPairingIds = [...new Set(options.ignoredPairingIds ?? [])]
    .map((id) => IdentifierSchema.parse(id))
    .sort(compareIdentifiers);
  const ignored = new Set(ignoredPairingIds);
  const pairs = input.queue.items
    .flatMap((task) =>
      input.workers.map((worker) => evaluatePair(task, worker, input)),
    )
    .sort((left, right) =>
      compareIdentifiers(
        left.evaluation.pairingId,
        right.evaluation.pairingId,
      ),
    );
  const ranked = pairs
    .filter(
      ({ evaluation }) =>
        evaluation.suitable && !ignored.has(evaluation.pairingId),
    )
    .sort(compareRankedPairs);
  const fingerprint = inputFingerprint(input);
  const selected = ranked[0];
  const common = {
    decisionId: `decision:${hash(
      `${fingerprint}\n${selected?.evaluation.pairingId ?? "idle"}\n${ignoredPairingIds.join("\n")}`,
    )}`,
    createdAt: input.queue.observedAt,
    expiresAt: input.queue.validUntil,
    inputFingerprint: fingerprint,
    queueRevision: input.queue.revision,
    policyId: input.policy.policyId,
    policyRevision: input.policy.revision,
    ignoredPairingIds,
    evaluations: pairs.map(({ evaluation }) => evaluation),
    exclusions: pairs
      .map(({ evaluation }) => evaluation)
      .filter(({ eligible }) => !eligible),
  };

  if (!selected?.evaluation.scoreInputs) {
    return AdvisoryIdleDecisionSchema.parse({
      ...common,
      status: "idle",
      reason: idleReason(input, pairs, ignored),
    });
  }

  return AdvisoryDecisionViewSchema.parse({
    ...common,
    status: "suggested",
    proposal: {
      pairingId: selected.evaluation.pairingId,
      task: {
        id: selected.task.task.taskId,
        title: selected.task.workItem.title,
        contextSummary: selected.task.contextSummary,
      },
      worker: {
        actorId: selected.worker.actor.actorId,
        adapterId: selected.worker.adapter.adapterId,
        adapterVersion: selected.worker.adapter.adapterVersion,
      },
      scoreInputs: selected.evaluation.scoreInputs,
      budget: budgetView(selected.task, selected.worker, input.policy),
      claimEffect: {
        workItemId: selected.task.task.taskId,
        workerId: selected.worker.actor.actorId,
        currentStage: "ready",
        claimedStage: "in_progress",
        leaseDurationSeconds: input.settings.leaseDurationSeconds,
      },
    },
  });
}

const assertCurrentDecision = (
  decision: AdvisoryDecisionView,
  input: AdvisoryMatchingInput,
  now: number,
): AdvisoryDecisionView => {
  const current = createAdvisoryDecision(input, {
    now,
    ignoredPairingIds: decision.ignoredPairingIds,
  });
  if (
    current.status !== "suggested" ||
    current.decisionId !== decision.decisionId ||
    current.inputFingerprint !== decision.inputFingerprint
  ) {
    throw new AdvisoryMatchingError(
      "decision-stale",
      "The ready queue, policy, worker inventory, or observations changed. Request a new suggestion before claiming work.",
    );
  }
  return current;
};

export function declineAdvisoryDecision(decision: AdvisoryDecisionView): {
  status: "declined";
  decisionId: string;
  pairingId: string;
} {
  const parsed = AdvisoryDecisionViewSchema.parse(decision);
  return {
    status: "declined",
    decisionId: parsed.decisionId,
    pairingId: parsed.proposal.pairingId,
  };
}

export function requestAnotherAdvisoryDecision(
  decisionValue: AdvisoryDecisionView,
  input: AdvisoryMatchingInput,
  options: { now?: number } = {},
): AdvisoryDecision {
  const decision = AdvisoryDecisionViewSchema.parse(decisionValue);
  const now = options.now ?? Date.now();
  assertCurrentDecision(decision, input, now);
  return createAdvisoryDecision(input, {
    now,
    ignoredPairingIds: [
      ...decision.ignoredPairingIds,
      decision.proposal.pairingId,
    ],
  });
}

export interface AdvisoryClaimPort<Result> {
  claim(
    task: z.infer<typeof TaskRequirementsSchema>,
    input: { workerId: string; leaseDurationSeconds: number },
  ): Promise<Result>;
}

export async function confirmAdvisoryDecision<Result>(
  decisionValue: AdvisoryDecisionView,
  inputValue: AdvisoryMatchingInput,
  claimPort: AdvisoryClaimPort<Result>,
  options: { now?: number } = {},
): Promise<Result> {
  const decision = AdvisoryDecisionViewSchema.parse(decisionValue);
  const input = AdvisoryMatchingInputSchema.parse(inputValue);
  const current = assertCurrentDecision(
    decision,
    input,
    options.now ?? Date.now(),
  );
  const task = input.queue.items.find(
    ({ task: candidate }) => candidate.taskId === current.proposal.task.id,
  )?.task;
  if (!task) {
    throw new AdvisoryMatchingError(
      "decision-stale",
      `Task ${current.proposal.task.id} is no longer in the ready queue`,
    );
  }
  return claimPort.claim(task, {
    workerId: current.proposal.worker.actorId,
    leaseDurationSeconds: current.proposal.claimEffect.leaseDurationSeconds,
  });
}
