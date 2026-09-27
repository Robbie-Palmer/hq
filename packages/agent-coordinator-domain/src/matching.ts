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
const ScoreSchema = z.number().nonnegative();

export const AdvisorySuitabilityReasonSchema = z.enum([
  "eligible",
  "below-value-floor",
  "hard-exclusion",
]);
export type AdvisorySuitabilityReason = z.infer<
  typeof AdvisorySuitabilityReasonSchema
>;

export const AdvisoryIdleReasonSchema = z.enum([
  "no-ready-work",
  "no-workers",
  "no-eligible-pair",
  "below-value-floor",
  "no-alternative",
]);
export type AdvisoryIdleReason = z.infer<typeof AdvisoryIdleReasonSchema>;

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

export const AdvisoryWorkerInventorySnapshotSchema = z
  .object({
    revision: RevisionSchema,
    observedAt: TimestampSchema,
    workers: z.array(AdvisoryWorkerCandidateSchema),
  })
  .strict()
  .superRefine(({ workers }, context) => {
    const workerKeys = workers.map(
      ({ actor, adapter }) => `${actor.actorId}::${adapter.adapterId}`,
    );
    const duplicates = findDuplicates(workerKeys);
    if (duplicates.length > 0) {
      context.addIssue({
        code: "custom",
        message: `workers contains duplicate actor and adapter pairs: ${duplicates.join(", ")}`,
        path: ["workers"],
      });
    }
  });
export type AdvisoryWorkerInventorySnapshot = z.infer<
  typeof AdvisoryWorkerInventorySnapshotSchema
>;

export const AdvisoryMatchingSettingsSchema = z
  .object({
    minimumExpectedValue: ScoreSchema,
    leaseDurationSeconds: z.number().int().min(60).max(86_400),
    rankingCurrency: CurrencySchema,
  })
  .strict();
export type AdvisoryMatchingSettings = z.infer<
  typeof AdvisoryMatchingSettingsSchema
>;

export const AdvisoryMatchingInputSchema = z
  .object({
    queue: ReadyQueueSnapshotSchema,
    workerInventory: AdvisoryWorkerInventorySnapshotSchema,
    complexityScales: z.array(ComplexityScaleSchema),
    policy: OwnerPolicySchema,
    settings: AdvisoryMatchingSettingsSchema,
  })
  .strict()
  .superRefine((input, context) => {
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
    for (const [workerIndex, worker] of input.workerInventory.workers.entries()) {
      if (worker.actor.cost.estimatedSessionCost.currency !== input.settings.rankingCurrency) {
        context.addIssue({
          code: "custom",
          message: `worker cost must use ranking currency ${input.settings.rankingCurrency}`,
          path: ["workerInventory", "workers", workerIndex, "actor", "cost"],
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
            path: [
              "workerInventory",
              "workers",
              workerIndex,
              "activeSessionsByWorkClass",
            ],
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
    declaredCapabilityMargin: z.number(),
    observedCapabilityMargin: z.number(),
    declaredSessionCost: MoneySchema,
    capacityHeadroom: z.number().nonnegative(),
    handoffCost: ScoreSchema,
    prepaidCapacityExpiresAt: z.union([TimestampSchema, z.null()]),
  })
  .strict();
export type AdvisoryScoreInputs = z.infer<typeof AdvisoryScoreInputsSchema>;

export const AdvisoryPairingSchema = z
  .object({
    taskId: IdentifierSchema,
    actorId: IdentifierSchema,
    adapterId: IdentifierSchema,
  })
  .strict();
export type AdvisoryPairing = z.infer<typeof AdvisoryPairingSchema>;

export const AdvisoryPairEvaluationSchema = z
  .object({
    pairing: AdvisoryPairingSchema,
    eligible: z.boolean(),
    suitable: z.boolean(),
    suitabilityReason: AdvisorySuitabilityReasonSchema,
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
    maximumPerSession: z.union([MoneySchema, z.null()]),
    remaining: z.union([MoneySchema, z.null()]),
  })
  .strict();

export const AdvisoryProposalSchema = z
  .object({
    pairing: AdvisoryPairingSchema,
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

const AdvisoryComplexityScaleRevisionSchema = z
  .object({
    scaleId: IdentifierSchema,
    revision: z.number().int().positive(),
  })
  .strict();

export const AdvisoryDecisionBasisSchema = z
  .object({
    queueRevision: RevisionSchema,
    workerInventoryRevision: RevisionSchema,
    policy: z
      .object({
        policyId: IdentifierSchema,
        revision: z.number().int().positive(),
      })
      .strict(),
    complexityScales: z.array(AdvisoryComplexityScaleRevisionSchema),
    settings: AdvisoryMatchingSettingsSchema,
  })
  .strict();
export type AdvisoryDecisionBasis = z.infer<typeof AdvisoryDecisionBasisSchema>;

const DecisionBaseSchema = z
  .object({
    createdAt: TimestampSchema,
    expiresAt: TimestampSchema,
    basis: AdvisoryDecisionBasisSchema,
    ignoredPairings: z.array(AdvisoryPairingSchema),
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
  reason: AdvisoryIdleReasonSchema,
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

const comparePairings = (
  left: AdvisoryPairing,
  right: AdvisoryPairing,
): number =>
  compareIdentifiers(left.taskId, right.taskId) ||
  compareIdentifiers(left.actorId, right.actorId) ||
  compareIdentifiers(left.adapterId, right.adapterId);

const samePairing = (
  left: AdvisoryPairing,
  right: AdvisoryPairing,
): boolean => comparePairings(left, right) === 0;

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
    if (available?.unit !== required.unit) return 0;
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
    declaredSessionCost: worker.actor.cost.estimatedSessionCost,
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
    leftScore.declaredSessionCost.amount - rightScore.declaredSessionCost.amount,
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
  if (!leftScore) return rightScore ? 1 : 0;
  if (!rightScore) return -1;
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
  policy: z.infer<typeof OwnerPolicySchema>,
) => {
  const budget = policy.budgets.find(
    ({ workClass }) => workClass === task.task.workClass,
  );
  return AdvisoryBudgetViewSchema.parse({
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
  let suitabilityReason: AdvisoryPairEvaluation["suitabilityReason"] =
    "hard-exclusion";
  if (eligible) {
    suitabilityReason = aboveFloor ? "eligible" : "below-value-floor";
  }
  const evaluation = AdvisoryPairEvaluationSchema.parse({
    pairing: {
      taskId: task.task.taskId,
      actorId: worker.actor.actorId,
      adapterId: worker.adapter.adapterId,
    },
    eligible,
    suitable: eligible && aboveFloor,
    suitabilityReason,
    hardExclusions: compatibility.hardExclusions,
    scoreInputs: eligible ? scoreInputs(task, worker, compatibility) : null,
  });
  return { task, worker, evaluation };
};

const idleReason = (
  input: z.infer<typeof AdvisoryMatchingInputSchema>,
  pairs: readonly RankedPair[],
  ignoredPairings: readonly AdvisoryPairing[],
): AdvisoryIdleDecision["reason"] => {
  if (input.queue.items.length === 0) return "no-ready-work";
  if (input.workerInventory.workers.length === 0) return "no-workers";
  if (!pairs.some(({ evaluation }) => evaluation.eligible)) {
    return "no-eligible-pair";
  }
  if (!pairs.some(({ evaluation }) => evaluation.suitable)) {
    return "below-value-floor";
  }
  if (
    pairs
      .filter(({ evaluation }) => evaluation.suitable)
      .every(({ evaluation }) =>
        ignoredPairings.some((ignored) =>
          samePairing(ignored, evaluation.pairing),
        ),
      )
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
  options: {
    now?: number;
    ignoredPairings?: readonly AdvisoryPairing[];
  } = {},
): AdvisoryDecision {
  const input = AdvisoryMatchingInputSchema.parse(inputValue);
  const now = options.now ?? Date.now();
  assertFreshQueue(input.queue, now);
  const ignoredPairings = (options.ignoredPairings ?? [])
    .map((pairing) => AdvisoryPairingSchema.parse(pairing))
    .filter(
      (pairing, index, all) =>
        all.findIndex((candidate) => samePairing(candidate, pairing)) === index,
    )
    .sort(comparePairings);
  const pairs = input.queue.items
    .flatMap((task) =>
      input.workerInventory.workers.map((worker) =>
        evaluatePair(task, worker, input),
      ),
    )
    .sort((left, right) =>
      comparePairings(left.evaluation.pairing, right.evaluation.pairing),
    );
  const ranked = pairs
    .filter(
      ({ evaluation }) =>
        evaluation.suitable &&
        !ignoredPairings.some((ignored) =>
          samePairing(ignored, evaluation.pairing),
        ),
    )
    .sort(compareRankedPairs);
  const selected = ranked[0];
  const common = {
    createdAt: input.queue.observedAt,
    expiresAt: input.queue.validUntil,
    basis: {
      queueRevision: input.queue.revision,
      workerInventoryRevision: input.workerInventory.revision,
      policy: {
        policyId: input.policy.policyId,
        revision: input.policy.revision,
      },
      complexityScales: input.complexityScales
        .map(({ scaleId, revision }) => ({ scaleId, revision }))
        .sort(
          (left, right) =>
            compareIdentifiers(left.scaleId, right.scaleId) ||
            left.revision - right.revision,
        ),
      settings: input.settings,
    },
    ignoredPairings,
    evaluations: pairs.map(({ evaluation }) => evaluation),
    exclusions: pairs
      .map(({ evaluation }) => evaluation)
      .filter(({ eligible }) => !eligible),
  };

  if (!selected?.evaluation.scoreInputs) {
    return AdvisoryIdleDecisionSchema.parse({
      ...common,
      status: "idle",
      reason: idleReason(input, pairs, ignoredPairings),
    });
  }

  return AdvisoryDecisionViewSchema.parse({
    ...common,
    status: "suggested",
    proposal: {
      pairing: selected.evaluation.pairing,
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
      budget: budgetView(selected.task, input.policy),
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

const sameDecisionBasis = (
  left: AdvisoryDecisionBasis,
  right: AdvisoryDecisionBasis,
): boolean =>
  left.queueRevision === right.queueRevision &&
  left.workerInventoryRevision === right.workerInventoryRevision &&
  left.policy.policyId === right.policy.policyId &&
  left.policy.revision === right.policy.revision &&
  left.settings.minimumExpectedValue === right.settings.minimumExpectedValue &&
  left.settings.leaseDurationSeconds === right.settings.leaseDurationSeconds &&
  left.settings.rankingCurrency === right.settings.rankingCurrency &&
  left.complexityScales.length === right.complexityScales.length &&
  left.complexityScales.every(
    (scale, index) =>
      scale.scaleId === right.complexityScales[index]?.scaleId &&
      scale.revision === right.complexityScales[index]?.revision,
  );

const assertCurrentDecision = (
  decision: AdvisoryDecisionView,
  input: AdvisoryMatchingInput,
  now: number,
): AdvisoryDecisionView => {
  const current = createAdvisoryDecision(input, {
    now,
    ignoredPairings: decision.ignoredPairings,
  });
  if (
    current.status !== "suggested" ||
    !sameDecisionBasis(current.basis, decision.basis) ||
    !samePairing(current.proposal.pairing, decision.proposal.pairing)
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
  pairing: AdvisoryPairing;
} {
  const parsed = AdvisoryDecisionViewSchema.parse(decision);
  return {
    status: "declined",
    pairing: parsed.proposal.pairing,
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
    ignoredPairings: [
      ...decision.ignoredPairings,
      decision.proposal.pairing,
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
