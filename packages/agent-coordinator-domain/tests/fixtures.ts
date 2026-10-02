import type {
  ActorProfile,
  AuthenticationAllowlistEntry,
  ComplexityScale,
  CompatibilityInput,
  ExecutionSessionIdentity,
  OwnerPolicy,
  TaskRequirements,
  WorkerAdapterIdentity,
} from "../src";

export const authenticationEntry: AuthenticationAllowlistEntry = {
  schemaVersion: 1,
  recordType: "authentication-allowlist-entry",
  authenticationPathId: "auth:provider-native",
  providerId: "provider:example",
  routeKind: "native-client",
  accountClass: "account:owner-subscription",
  approvalBasis: {
    kind: "provider-documentation",
    referenceUrl: "https://example.com/provider-authentication",
    reviewedAt: "2026-09-26T08:00:00.000Z",
  },
  enabled: true,
};

export const complexityScale: ComplexityScale = {
  schemaVersion: 1,
  recordType: "complexity-scale",
  scaleId: "complexity:repository-change",
  revision: 1,
  levels: [
    {
      levelId: "bounded-change",
      rank: 10,
      definition:
        "The affected component and implementation path are already known.",
    },
    {
      levelId: "cross-cutting-change",
      rank: 20,
      definition:
        "The change spans components and requires explicit contract decisions.",
    },
    {
      levelId: "open-ended-research",
      rank: 30,
      definition:
        "The implementation path depends on unresolved research or experiments.",
    },
  ],
};

export const task: TaskRequirements = {
  schemaVersion: 1,
  recordType: "task-requirements",
  taskId: "work:contract-implementation",
  workClass: "code.change",
  complexity: {
    scaleId: complexityScale.scaleId,
    scaleRevision: complexityScale.revision,
    levelId: "cross-cutting-change",
  },
  tags: ["typescript", "domain-modeling"],
  requiredCapabilities: [
    {
      capability: "typescript-domain-modeling",
      minimumLevel: 4,
      requiresObservedEvidence: true,
    },
  ],
  requiredAuthority: ["repository-write"],
  requiredAccess: ["repository:personal-site"],
  requiredTools: ["git"],
  preferredTools: ["work-graph"],
  requiredEvidence: [
    { kind: "test-results", stage: "completion" },
    { kind: "handoff-note", stage: "checkpoint" },
  ],
  requiredResources: [
    { resource: "provider-context", amount: 12_000, unit: "tokens" },
    { resource: "account-budget", amount: 1, unit: "credits" },
  ],
  estimatedCost: { currency: "USD", amount: 2.5 },
};

export const actor: ActorProfile = {
  schemaVersion: 1,
  recordType: "actor-profile",
  actorId: "actor:domain-agent",
  actorKind: "user-directed-agent",
  complexityLimits: [
    {
      scaleId: complexityScale.scaleId,
      scaleRevision: complexityScale.revision,
      levelId: "cross-cutting-change",
    },
  ],
  routingPreferences: {
    workClasses: ["code.change"],
    tags: ["typescript", "architecture"],
  },
  tools: ["git", "work-graph"],
  grantedAuthority: ["repository-write"],
  access: ["repository:personal-site"],
  declaredCapabilities: [
    { capability: "typescript-domain-modeling", level: 5 },
  ],
  observedCapabilities: [
    {
      capability: "typescript-domain-modeling",
      level: 4,
      assessmentId: "assessment:typescript-domain-modeling-2026-09",
      assessedAt: "2026-09-25T10:00:00.000Z",
    },
  ],
  cost: {
    funding: "metered",
    estimatedSessionCost: { currency: "USD", amount: 2 },
  },
  resourceAvailability: [
    {
      resource: "provider-context",
      amount: 48_000,
      unit: "tokens",
      observedAt: "2026-09-26T08:00:00.000Z",
    },
    {
      resource: "account-budget",
      amount: 8,
      unit: "credits",
      observedAt: "2026-09-26T08:00:00.000Z",
    },
  ],
};

export const policy: OwnerPolicy = {
  schemaVersion: 1,
  recordType: "owner-policy",
  policyId: "policy:personal-repositories",
  ownerId: "owner:robbie",
  revision: 1,
  allowedAuthenticationPaths: ["auth:provider-native"],
  allowedAuthority: ["repository-write"],
  allowedWorkClasses: ["code.change", "documentation"],
  budgets: [
    {
      workClass: "code.change",
      maximumPerSession: { currency: "USD", amount: 5 },
      remaining: { currency: "USD", amount: 20 },
    },
  ],
  concurrency: {
    maximumActiveSessions: 4,
    maximumActiveSessionsPerActor: 2,
    workClasses: [
      { workClass: "code.change", maximumActiveSessions: 3 },
    ],
  },
};

export const adapter: WorkerAdapterIdentity = {
  schemaVersion: 1,
  recordType: "worker-adapter",
  adapterId: "adapter:native-code-client",
  adapterVersion: "1.0.0",
  actorId: actor.actorId,
  adapterKind: "native-client",
  authenticationPathId: "auth:provider-native",
  tools: ["git", "work-graph"],
  evidenceKinds: ["test-results", "handoff-note"],
  supportsCheckpointing: true,
};

export const session: ExecutionSessionIdentity = {
  schemaVersion: 1,
  recordType: "execution-session",
  sessionId: "session:01k5example",
  taskId: task.taskId,
  actorId: actor.actorId,
  adapterId: adapter.adapterId,
  adapterVersion: adapter.adapterVersion,
  authenticationPathId: adapter.authenticationPathId,
  startedAt: "2026-09-26T08:00:00.000Z",
  workGraphLeaseId: "641da305-0f50-4c15-a080-81c5d687c0ab",
};

export const compatibleInput: CompatibilityInput = {
  task,
  actor,
  complexityScale,
  policy,
  adapter,
  state: {
    activeSessions: 1,
    activeSessionsForActor: 0,
    activeSessionsForWorkClass: 1,
  },
};
