import { z } from "zod";

import { type ActorProfile, ActorProfileSchema } from "./actor";
import { type OwnerPolicy, OwnerPolicySchema } from "./policy";
import {
  RoutingStateSchema,
  type WorkerAdapterIdentity,
  WorkerAdapterIdentitySchema,
} from "./session";
import { type TaskRequirements, TaskRequirementsSchema } from "./task";
import {
  compareIdentifiers,
  type Complexity,
  IdentifierSchema,
} from "./vocabulary";

export const HardExclusionCodeSchema = z.enum([
  "actor-capacity-exhausted",
  "actor-concurrency-exhausted",
  "adapter-actor-mismatch",
  "authentication-path-denied",
  "capability-below-minimum",
  "capability-missing",
  "checkpoint-unsupported",
  "complexity-unsupported",
  "cost-currency-mismatch",
  "evidence-unsupported",
  "owner-authority-denied",
  "remaining-budget-exhausted",
  "required-access-missing",
  "required-authority-missing",
  "required-tool-missing",
  "session-budget-exceeded",
  "total-concurrency-exhausted",
  "verified-capability-below-minimum",
  "verified-capability-missing",
  "work-class-concurrency-exhausted",
  "work-class-denied",
]);

export const HardExclusionSchema = z
  .object({
    code: HardExclusionCodeSchema,
    subject: IdentifierSchema,
    detail: z.string().min(1),
  })
  .strict();
export type HardExclusion = z.infer<typeof HardExclusionSchema>;

export const RankingSignalSchema = z
  .object({
    code: z.enum([
      "available-capacity",
      "declared-capability-margin",
      "estimated-session-cost",
      "interest-match",
      "observed-capability-confidence",
      "preferred-tool-match",
    ]),
    value: z.number().finite(),
    direction: z.enum(["higher-is-better", "lower-is-better"]),
    unit: z.string().min(1),
    detail: z.string().min(1),
  })
  .strict();
export type RankingSignal = z.infer<typeof RankingSignalSchema>;

export const CompatibilityResultSchema = z
  .object({
    eligible: z.boolean(),
    hardExclusions: z.array(HardExclusionSchema),
    rankingSignals: z.array(RankingSignalSchema),
  })
  .strict()
  .refine(
    ({ eligible, hardExclusions }) =>
      eligible === (hardExclusions.length === 0),
    {
      message: "eligible must agree with hardExclusions",
      path: ["eligible"],
    },
  );
export type CompatibilityResult = z.infer<typeof CompatibilityResultSchema>;

export const CompatibilityInputSchema = z
  .object({
    task: TaskRequirementsSchema,
    actor: ActorProfileSchema,
    policy: OwnerPolicySchema,
    adapter: WorkerAdapterIdentitySchema,
    state: RoutingStateSchema,
  })
  .strict();
export type CompatibilityInput = z.input<typeof CompatibilityInputSchema>;

const COMPLEXITY_RANK: Record<Complexity, number> = {
  mechanical: 1,
  bounded: 2,
  complex: 3,
  frontier: 4,
};

function exclusion(
  code: HardExclusion["code"],
  subject: string,
  detail: string,
): HardExclusion {
  return { code, subject, detail };
}

function setMissing(
  required: string[],
  available: Set<string>,
  code: HardExclusion["code"],
  detail: (value: string) => string,
): HardExclusion[] {
  return required
    .filter((value) => !available.has(value))
    .map((value) => exclusion(code, value, detail(value)));
}

function capabilityExclusions(
  task: TaskRequirements,
  actor: ActorProfile,
): HardExclusion[] {
  const declared = new Map(
    actor.declaredCapabilities.map(({ capability, level }) => [
      capability,
      level,
    ]),
  );
  const observed = new Map(
    actor.observedCapabilities.map(({ capability, level }) => [
      capability,
      level,
    ]),
  );
  const exclusions: HardExclusion[] = [];

  for (const requirement of task.requiredCapabilities) {
    const declaredLevel = declared.get(requirement.capability);
    if (declaredLevel === undefined) {
      exclusions.push(
        exclusion(
          "capability-missing",
          requirement.capability,
          `Actor has not declared ${requirement.capability}`,
        ),
      );
    } else if (declaredLevel < requirement.minimumLevel) {
      exclusions.push(
        exclusion(
          "capability-below-minimum",
          requirement.capability,
          `Declared level ${declaredLevel} is below ${requirement.minimumLevel}`,
        ),
      );
    }

    if (!requirement.requiresObservedEvidence) continue;
    const observedLevel = observed.get(requirement.capability);
    if (observedLevel === undefined) {
      exclusions.push(
        exclusion(
          "verified-capability-missing",
          requirement.capability,
          `Task requires observed evidence for ${requirement.capability}`,
        ),
      );
    } else if (observedLevel < requirement.minimumLevel) {
      exclusions.push(
        exclusion(
          "verified-capability-below-minimum",
          requirement.capability,
          `Observed level ${observedLevel} is below ${requirement.minimumLevel}`,
        ),
      );
    }
  }
  return exclusions;
}

function policyExclusions(
  task: TaskRequirements,
  actor: ActorProfile,
  policy: OwnerPolicy,
  adapter: WorkerAdapterIdentity,
  state: z.infer<typeof RoutingStateSchema>,
): HardExclusion[] {
  const exclusions: HardExclusion[] = [];
  const allowedWorkClasses = new Set(policy.allowedWorkClasses);
  if (!allowedWorkClasses.has(task.workClass)) {
    exclusions.push(
      exclusion(
        "work-class-denied",
        task.workClass,
        `Policy does not allow ${task.workClass}`,
      ),
    );
  }

  const allowedAuthority = new Set(policy.allowedAuthority);
  exclusions.push(
    ...setMissing(
      task.requiredAuthority,
      allowedAuthority,
      "owner-authority-denied",
      (authority) => `Policy does not allow ${authority}`,
    ),
  );

  if (!policy.allowedAuthenticationPaths.includes(adapter.authenticationPathId)) {
    exclusions.push(
      exclusion(
        "authentication-path-denied",
        adapter.authenticationPathId,
        `Policy does not allow ${adapter.authenticationPathId}`,
      ),
    );
  }
  if (state.activeSessions >= policy.concurrency.maximumActiveSessions) {
    exclusions.push(
      exclusion(
        "total-concurrency-exhausted",
        policy.policyId,
        "Owner policy has no global session capacity",
      ),
    );
  }
  if (
    state.activeSessionsForActor >=
    policy.concurrency.maximumActiveSessionsPerActor
  ) {
    exclusions.push(
      exclusion(
        "actor-concurrency-exhausted",
        actor.actorId,
        "Owner policy has no session capacity for this actor",
      ),
    );
  }
  const classLimit = policy.concurrency.workClasses.find(
    ({ workClass }) => workClass === task.workClass,
  );
  if (
    classLimit &&
    state.activeSessionsForWorkClass >= classLimit.maximumActiveSessions
  ) {
    exclusions.push(
      exclusion(
        "work-class-concurrency-exhausted",
        task.workClass,
        `Owner policy has no session capacity for ${task.workClass}`,
      ),
    );
  }
  return exclusions;
}

function budgetExclusions(
  task: TaskRequirements,
  actor: ActorProfile,
  policy: OwnerPolicy,
): HardExclusion[] {
  const budget = policy.budgets.find(
    ({ workClass }) => workClass === task.workClass,
  );
  if (!budget) return [];

  const estimate = task.estimatedCost ?? actor.cost.estimatedSessionCost;
  if (estimate.currency !== budget.maximumPerSession.currency) {
    return [
      exclusion(
        "cost-currency-mismatch",
        estimate.currency.toLowerCase(),
        `Estimate uses ${estimate.currency}; budget uses ${budget.maximumPerSession.currency}`,
      ),
    ];
  }

  const exclusions: HardExclusion[] = [];
  if (estimate.amount > budget.maximumPerSession.amount) {
    exclusions.push(
      exclusion(
        "session-budget-exceeded",
        task.workClass,
        `Estimated cost ${estimate.amount} exceeds the per-session limit ${budget.maximumPerSession.amount}`,
      ),
    );
  }
  if (estimate.amount > budget.remaining.amount) {
    exclusions.push(
      exclusion(
        "remaining-budget-exhausted",
        task.workClass,
        `Estimated cost ${estimate.amount} exceeds the remaining budget ${budget.remaining.amount}`,
      ),
    );
  }
  return exclusions;
}

function directExclusions(
  task: TaskRequirements,
  actor: ActorProfile,
  adapter: WorkerAdapterIdentity,
): HardExclusion[] {
  const exclusions: HardExclusion[] = [];
  if (adapter.actorId !== actor.actorId) {
    exclusions.push(
      exclusion(
        "adapter-actor-mismatch",
        adapter.adapterId,
        `Adapter belongs to ${adapter.actorId}, not ${actor.actorId}`,
      ),
    );
  }
  if (
    COMPLEXITY_RANK[task.complexity] >
    COMPLEXITY_RANK[actor.maximumComplexity]
  ) {
    exclusions.push(
      exclusion(
        "complexity-unsupported",
        task.complexity,
        `Actor supports work through ${actor.maximumComplexity}`,
      ),
    );
  }
  if (actor.capacity.activeSessions >= actor.capacity.maximumSessions) {
    exclusions.push(
      exclusion(
        "actor-capacity-exhausted",
        actor.actorId,
        "Actor has no declared session capacity",
      ),
    );
  }

  exclusions.push(
    ...setMissing(
      task.requiredAuthority,
      new Set(actor.grantedAuthority),
      "required-authority-missing",
      (authority) => `Actor lacks ${authority}`,
    ),
    ...setMissing(
      task.requiredAccess,
      new Set(actor.access),
      "required-access-missing",
      (access) => `Actor lacks ${access}`,
    ),
  );

  const usableTools = new Set(
    actor.tools.filter((tool) => adapter.tools.includes(tool)),
  );
  exclusions.push(
    ...setMissing(
      task.requiredTools,
      usableTools,
      "required-tool-missing",
      (tool) => `Actor and adapter do not both expose ${tool}`,
    ),
    ...setMissing(
      task.requiredEvidence.map(({ kind }) => kind),
      new Set(adapter.evidenceKinds),
      "evidence-unsupported",
      (kind) => `Adapter cannot produce ${kind}`,
    ),
  );
  if (
    task.requiredEvidence.some(({ stage }) => stage === "checkpoint") &&
    !adapter.supportsCheckpointing
  ) {
    exclusions.push(
      exclusion(
        "checkpoint-unsupported",
        adapter.adapterId,
        "Task requires checkpoint evidence but adapter cannot checkpoint",
      ),
    );
  }
  return exclusions;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function rankingSignals(
  task: TaskRequirements,
  actor: ActorProfile,
  adapter: WorkerAdapterIdentity,
): RankingSignal[] {
  const declared = new Map(
    actor.declaredCapabilities.map(({ capability, level }) => [
      capability,
      level,
    ]),
  );
  const observed = new Map(
    actor.observedCapabilities.map((capability) => [
      capability.capability,
      capability,
    ]),
  );
  const matchedInterests = task.tags.filter((tag) =>
    actor.interests.includes(tag),
  );
  const matchedPreferredTools = task.preferredTools.filter(
    (tool) => actor.tools.includes(tool) && adapter.tools.includes(tool),
  );
  const declaredMargins = task.requiredCapabilities.map(
    ({ capability, minimumLevel }) =>
      (declared.get(capability) ?? 0) - minimumLevel,
  );
  const observedConfidence = task.requiredCapabilities.flatMap(
    ({ capability, minimumLevel }) => {
      const record = observed.get(capability);
      if (!record) return [];
      const levelFit = Math.min(record.level / minimumLevel, 1);
      return [levelFit * record.successRate];
    },
  );

  return [
    {
      code: "interest-match",
      value: matchedInterests.length,
      direction: "higher-is-better",
      unit: "matching-tags",
      detail: `${matchedInterests.length} task tags match actor interests`,
    },
    {
      code: "declared-capability-margin",
      value: mean(declaredMargins),
      direction: "higher-is-better",
      unit: "levels",
      detail: "Mean declared level above the task minimum",
    },
    {
      code: "observed-capability-confidence",
      value: mean(observedConfidence),
      direction: "higher-is-better",
      unit: "ratio",
      detail: "Mean observed success rate adjusted for required level",
    },
    {
      code: "preferred-tool-match",
      value: matchedPreferredTools.length,
      direction: "higher-is-better",
      unit: "matching-tools",
      detail: `${matchedPreferredTools.length} preferred tools are available`,
    },
    {
      code: "available-capacity",
      value: actor.capacity.maximumSessions - actor.capacity.activeSessions,
      direction: "higher-is-better",
      unit: "sessions",
      detail: "Actor session capacity remaining before this assignment",
    },
    {
      code: "estimated-session-cost",
      value: actor.cost.estimatedSessionCost.amount,
      direction: "lower-is-better",
      unit: actor.cost.estimatedSessionCost.currency,
      detail: `Estimated ${actor.cost.funding} session cost`,
    },
  ];
}

function compareExclusions(left: HardExclusion, right: HardExclusion): number {
  return (
    compareIdentifiers(left.code, right.code) ||
    compareIdentifiers(left.subject, right.subject) ||
    left.detail.localeCompare(right.detail, "en")
  );
}

export function evaluateCompatibility(
  input: CompatibilityInput,
): CompatibilityResult {
  const { task, actor, policy, adapter, state } =
    CompatibilityInputSchema.parse(input);
  const hardExclusions = [
    ...directExclusions(task, actor, adapter),
    ...capabilityExclusions(task, actor),
    ...policyExclusions(task, actor, policy, adapter, state),
    ...budgetExclusions(task, actor, policy),
  ].sort(compareExclusions);

  return CompatibilityResultSchema.parse({
    eligible: hardExclusions.length === 0,
    hardExclusions,
    rankingSignals: rankingSignals(task, actor, adapter),
  });
}
