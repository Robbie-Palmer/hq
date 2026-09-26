import type {
  ActorProfile,
  CompatibilityInput,
  ExecutionSessionIdentity,
  OwnerPolicy,
  TaskRequirements,
  WorkerAdapterIdentity,
} from "../src";

export const task: TaskRequirements = {
  schemaVersion: 1,
  recordType: "task-requirements",
  taskId: "work:contract-implementation",
  workClass: "code.change",
  complexity: "complex",
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
  estimatedCost: { currency: "USD", amount: 2.5 },
};

export const actor: ActorProfile = {
  schemaVersion: 1,
  recordType: "actor-profile",
  actorId: "actor:domain-agent",
  actorKind: "user-directed-agent",
  maximumComplexity: "complex",
  interests: ["typescript", "architecture"],
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
      sampleSize: 12,
      successRate: 0.9,
      observedAt: "2026-09-25T10:00:00.000Z",
    },
  ],
  cost: {
    funding: "metered",
    estimatedSessionCost: { currency: "USD", amount: 2 },
  },
  capacity: { maximumSessions: 2, activeSessions: 0 },
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
  policy,
  adapter,
  state: {
    activeSessions: 1,
    activeSessionsForActor: 0,
    activeSessionsForWorkClass: 1,
  },
};
