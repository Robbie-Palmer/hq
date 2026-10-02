import { z } from "zod";

import { type ActorProfile, ActorProfileSchema } from "./actor";
import {
  type ComplexityScale,
  ComplexityScaleSchema,
} from "./complexity";
import { type OwnerPolicy, OwnerPolicySchema } from "./policy";
import {
  RoutingStateSchema,
  type WorkerAdapterIdentity,
  WorkerAdapterIdentitySchema,
} from "./session";
import { type TaskRequirements, TaskRequirementsSchema } from "./task";
import {
  compareIdentifiers,
  IdentifierSchema,
} from "./vocabulary";

export const HardExclusionCodeSchema = z.enum([
  "actor-concurrency-exhausted",
  "adapter-actor-mismatch",
  "authentication-path-denied",
  "capacity-insufficient",
  "capacity-missing",
  "capacity-unit-mismatch",
  "capability-below-minimum",
  "capability-missing",
  "checkpoint-unsupported",
  "complexity-scale-unsupported",
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
  "observed-capability-below-minimum",
  "observed-capability-missing",
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
      "capacity-headroom",
      "declared-capability-margin",
      "estimated-session-cost",
      "observed-capability-margin",
      "preferred-tool-match",
      "tag-preference-match",
      "work-class-preference",
    ]),
    subject: IdentifierSchema,
    value: z.number(),
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
    complexityScale: ComplexityScaleSchema,
    policy: OwnerPolicySchema,
    adapter: WorkerAdapterIdentitySchema,
    state: RoutingStateSchema,
  })
  .strict()
  .superRefine(({ actor, complexityScale, task }, context) => {
    if (
      task.complexity.scaleId !== complexityScale.scaleId ||
      task.complexity.scaleRevision !== complexityScale.revision
    ) {
      context.addIssue({
        code: "custom",
        message: "complexityScale does not match the task complexity reference",
        path: ["complexityScale"],
      });
      return;
    }

    const levelIds = new Set(
      complexityScale.levels.map(({ levelId }) => levelId),
    );
    if (!levelIds.has(task.complexity.levelId)) {
      context.addIssue({
        code: "custom",
        message: `task references unknown complexity level ${task.complexity.levelId}`,
        path: ["task", "complexity", "levelId"],
      });
    }

    for (const [index, limit] of actor.complexityLimits.entries()) {
      if (
        limit.scaleId === complexityScale.scaleId &&
        limit.scaleRevision === complexityScale.revision &&
        !levelIds.has(limit.levelId)
      ) {
        context.addIssue({
          code: "custom",
          message: `actor references unknown complexity level ${limit.levelId}`,
          path: ["actor", "complexityLimits", index, "levelId"],
        });
      }
    }
  });
export type CompatibilityInput = z.input<typeof CompatibilityInputSchema>;

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
          "observed-capability-missing",
          requirement.capability,
          `Task requires observed evidence for ${requirement.capability}`,
        ),
      );
    } else if (observedLevel < requirement.minimumLevel) {
      exclusions.push(
        exclusion(
          "observed-capability-below-minimum",
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
  complexityScale: ComplexityScale,
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
  const actorComplexityLimit = actor.complexityLimits.find(
    ({ scaleId, scaleRevision }) =>
      scaleId === task.complexity.scaleId &&
      scaleRevision === task.complexity.scaleRevision,
  );
  if (!actorComplexityLimit) {
    exclusions.push(
      exclusion(
        "complexity-scale-unsupported",
        task.complexity.scaleId,
        `Actor has no limit for revision ${task.complexity.scaleRevision} of ${task.complexity.scaleId}`,
      ),
    );
  } else {
    const ranks = new Map(
      complexityScale.levels.map(({ levelId, rank }) => [levelId, rank]),
    );
    const requiredRank = ranks.get(task.complexity.levelId);
    const maximumRank = ranks.get(actorComplexityLimit.levelId);
    if (
      requiredRank !== undefined &&
      maximumRank !== undefined &&
      requiredRank > maximumRank
    ) {
      exclusions.push(
        exclusion(
          "complexity-unsupported",
          task.complexity.levelId,
          `Actor limit is ${actorComplexityLimit.levelId} on ${complexityScale.scaleId} revision ${complexityScale.revision}`,
        ),
      );
    }
  }

  const availableResources = new Map(
    actor.resourceAvailability.map((resource) => [resource.resource, resource]),
  );
  for (const requirement of task.requiredResources) {
    const available = availableResources.get(requirement.resource);
    if (!available) {
      exclusions.push(
        exclusion(
          "capacity-missing",
          requirement.resource,
          `Actor reports no available ${requirement.resource}`,
        ),
      );
    } else if (available.unit !== requirement.unit) {
      exclusions.push(
        exclusion(
          "capacity-unit-mismatch",
          requirement.resource,
          `Task requires ${requirement.unit}; actor reports ${available.unit}`,
        ),
      );
    } else if (available.amount < requirement.amount) {
      exclusions.push(
        exclusion(
          "capacity-insufficient",
          requirement.resource,
          `Task requires ${requirement.amount} ${requirement.unit}; actor has ${available.amount}`,
        ),
      );
    }
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
  const matchedTags = task.tags.filter((tag) =>
    actor.routingPreferences.tags.includes(tag),
  );
  const matchedPreferredTools = task.preferredTools.filter(
    (tool) => actor.tools.includes(tool) && adapter.tools.includes(tool),
  );
  const capabilitySignals: RankingSignal[] = task.requiredCapabilities.flatMap(
    ({ capability, minimumLevel }) => {
      const signals: RankingSignal[] = [
        {
          code: "declared-capability-margin",
          subject: capability,
          value: (declared.get(capability) ?? 0) - minimumLevel,
          direction: "higher-is-better",
          unit: "levels",
          detail: "Declared level above the task minimum",
        },
      ];
      const observedCapability = observed.get(capability);
      if (observedCapability) {
        signals.push({
          code: "observed-capability-margin",
          subject: capability,
          value: observedCapability.level - minimumLevel,
          direction: "higher-is-better",
          unit: "levels",
          detail: `Assessed level above the task minimum; assessment ${observedCapability.assessmentId}`,
        });
      }
      return signals;
    },
  );
  const capacitySignals: RankingSignal[] = task.requiredResources.flatMap(
    (requirement) => {
      const available = actor.resourceAvailability.find(
        ({ resource }) => resource === requirement.resource,
      );
      if (available?.unit !== requirement.unit) return [];
      return [
        {
          code: "capacity-headroom" as const,
          subject: requirement.resource,
          value: available.amount - requirement.amount,
          direction: "higher-is-better" as const,
          unit: requirement.unit,
          detail: "Reported resource balance after the task requirement",
        },
      ];
    },
  );

  return [
    {
      code: "work-class-preference",
      subject: task.workClass,
      value: actor.routingPreferences.workClasses.includes(task.workClass)
        ? 1
        : 0,
      direction: "higher-is-better",
      unit: "match",
      detail: "Whether the actor prefers this work class",
    },
    {
      code: "tag-preference-match",
      subject: task.taskId,
      value: matchedTags.length,
      direction: "higher-is-better",
      unit: "matching-tags",
      detail: `${matchedTags.length} task tags match the actor's routing preferences`,
    },
    ...capabilitySignals,
    {
      code: "preferred-tool-match",
      subject: task.taskId,
      value: matchedPreferredTools.length,
      direction: "higher-is-better",
      unit: "matching-tools",
      detail: `${matchedPreferredTools.length} preferred tools are available`,
    },
    ...capacitySignals,
    {
      code: "estimated-session-cost",
      subject: actor.actorId,
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
  const { task, actor, complexityScale, policy, adapter, state } =
    CompatibilityInputSchema.parse(input);
  const hardExclusions = [
    ...directExclusions(task, actor, adapter, complexityScale),
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
