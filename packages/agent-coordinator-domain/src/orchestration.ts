import { z } from "zod";

import type {
  AdapterSession,
  CheckpointSignal,
  WorkerAdapterRuntime,
  WorkerLaunchRequest,
} from "./adapter";
import { OwnerPolicySchema, type OwnerPolicy } from "./policy";
import {
  ExecutionSessionIdentitySchema,
  WorkerAdapterIdentitySchema,
} from "./session";
import { TaskRequirementsSchema, type TaskRequirements } from "./task";
import {
  type CheckpointResult,
  type ClaimedWork,
  LeaseHandleSchema,
  type LeaseHandle,
  type WorkGraphCoordinator,
  type WorkGraphLease,
  WorkGraphContextPackageSchema,
  WorkGraphWorkItemSchema,
} from "./work-graph";
import { IdentifierSchema, MoneySchema } from "./vocabulary";

const TimestampSchema = z.iso.datetime();

export const SessionBudgetSchema = z
  .object({
    limit: MoneySchema,
    spent: MoneySchema,
  })
  .strict()
  .refine(({ limit, spent }) => limit.currency === spent.currency, {
    message: "Session budget and spend must use the same currency",
    path: ["spent", "currency"],
  });

const SessionBindingBaseSchema = z.object({
    schemaVersion: z.literal(1),
    recordType: z.literal("session-binding"),
    workerId: IdentifierSchema,
    identity: ExecutionSessionIdentitySchema,
    adapter: WorkerAdapterIdentitySchema,
    workItem: WorkGraphWorkItemSchema,
    lease: LeaseHandleSchema,
    policySnapshot: OwnerPolicySchema,
    contextPackageVersion: IdentifierSchema,
    context: WorkGraphContextPackageSchema,
    budget: SessionBudgetSchema,
  }).strict();

export const SessionBindingSchema = SessionBindingBaseSchema
  .superRefine((binding, context) => {
    const mismatches = [
      binding.identity.taskId !== binding.workItem.id && "task",
      binding.lease.workItemId !== binding.workItem.id && "lease work item",
      binding.lease.workerId !== binding.workerId && "worker",
      binding.identity.adapterId !== binding.adapter.adapterId && "adapter",
      binding.identity.actorId !== binding.adapter.actorId && "actor",
    ].filter(Boolean);
    if (mismatches.length > 0) {
      context.addIssue({
        code: "custom",
        message: `Session binding has mismatched ${mismatches.join(", ")}`,
      });
    }
  });
export type SessionBinding = z.infer<typeof SessionBindingSchema>;

export const SessionStopReasonSchema = z.enum([
  "time-limit",
  "quota-limit",
  "budget-limit",
  "shutdown",
  "client-failure",
  "authorization-revoked",
  "manual",
]);
export type SessionStopReason = z.infer<typeof SessionStopReasonSchema>;

const ProgressSchema = z
  .object({
    completedWork: z.array(z.string().trim().min(1)).max(100),
    remainingWork: z.array(z.string().trim().min(1)).max(100),
    evidence: z
      .array(
        z
          .object({ kind: IdentifierSchema, value: z.string().trim().min(1) })
          .strict(),
      )
      .max(100),
    artifacts: z
      .array(
        z
          .object({ kind: IdentifierSchema, location: z.string().trim().min(1) })
          .strict(),
      )
      .max(100),
  })
  .strict();
export type SessionProgress = z.infer<typeof ProgressSchema>;

const CheckpointBindingSchema = SessionBindingBaseSchema.omit({
  context: true,
  workItem: true,
});

export const DurableSessionCheckpointSchema = z
  .object({
    schemaVersion: z.literal(1),
    recordType: z.literal("session-checkpoint"),
    noteId: z.uuid(),
    createdAt: TimestampSchema,
    stopReason: SessionStopReasonSchema,
    binding: CheckpointBindingSchema,
    adapterCheckpoint: z.object({
      kind: z.literal("checkpoint"),
      checkpointId: IdentifierSchema,
      createdAt: TimestampSchema,
      reason: z.string().trim().min(1),
      state: z.record(z.string(), z.unknown()),
    }),
    progress: ProgressSchema,
  })
  .strict();
export type DurableSessionCheckpoint = z.infer<
  typeof DurableSessionCheckpointSchema
>;

export interface CoordinatedSession {
  binding: SessionBinding;
  worker: AdapterSession;
}

export interface SessionWorkGraphPort {
  claim(
    task: TaskRequirements,
    input: { workerId: string; leaseDurationSeconds: number },
  ): Promise<ClaimedWork>;
  renew(
    handle: LeaseHandle,
    leaseDurationSeconds: number,
  ): Promise<WorkGraphLease>;
  checkpoint(
    handle: LeaseHandle,
    content: string,
    input?: { noteId?: string; renewForSeconds?: number },
  ): Promise<CheckpointResult>;
}

export interface SessionOrchestratorOptions {
  now?: () => Date;
  createNoteId?: () => string;
  isAuthorised?: (binding: SessionBinding) => boolean | Promise<boolean>;
  checkpointLeadTimeMs?: number;
}

export interface StartSessionInput {
  task: TaskRequirements;
  workerId: string;
  adapterId: string;
  policy: OwnerPolicy;
  contextPackageVersion: string;
  leaseDurationSeconds: number;
  launch: Omit<WorkerLaunchRequest, "taskId" | "budgetUsd">;
  budgetUsd?: number;
}

export interface CheckpointSessionInput extends SessionProgress {
  noteId?: string;
  stopReason: SessionStopReason;
  stopWorker?: boolean;
}

export type HeartbeatResult =
  | { state: "renewed"; session: CoordinatedSession }
  | {
      state: "checkpointed";
      session: CoordinatedSession;
      checkpoint: DurableSessionCheckpoint;
      durable: CheckpointResult;
    };

function leaseHandle(claimed: ClaimedWork): LeaseHandle {
  return LeaseHandleSchema.parse({
    id: claimed.lease.id,
    workItemId: claimed.lease.workItemId,
    workerId: claimed.lease.workerId,
    epoch: claimed.lease.epoch,
    expiresAt: claimed.lease.expiresAt,
  });
}

function policyBudget(policy: OwnerPolicy, task: TaskRequirements): number {
  const configured = policy.budgets.find(
    ({ workClass }) => workClass === task.workClass,
  );
  if (!configured) return task.estimatedCost?.amount ?? 0;
  return Math.min(
    configured.maximumPerSession.amount,
    configured.remaining.amount,
  );
}

function heartbeatStopReason(input: {
  authorised: boolean;
  healthy: boolean;
  failed: boolean;
  quotaState: "available" | "near-limit" | "exhausted" | "unknown";
  budgetExhausted: boolean;
  nearDeadline: boolean;
}): SessionStopReason | undefined {
  if (!input.authorised) return "authorization-revoked";
  if (!input.healthy || input.failed) return "client-failure";
  if (input.quotaState === "near-limit" || input.quotaState === "exhausted") {
    return "quota-limit";
  }
  if (input.budgetExhausted) return "budget-limit";
  if (input.nearDeadline) return "time-limit";
  return undefined;
}

export class SessionOrchestrator {
  readonly #workGraph: SessionWorkGraphPort;
  readonly #adapters: WorkerAdapterRuntime;
  readonly #now: () => Date;
  readonly #createNoteId: () => string;
  readonly #isAuthorised: (binding: SessionBinding) => boolean | Promise<boolean>;
  readonly #checkpointLeadTimeMs: number;
  readonly #checkpoints = new Map<string, Promise<{
    checkpoint: DurableSessionCheckpoint;
    durable: CheckpointResult;
  }>>();

  constructor(
    workGraph: WorkGraphCoordinator | SessionWorkGraphPort,
    adapters: WorkerAdapterRuntime,
    options: SessionOrchestratorOptions = {},
  ) {
    this.#workGraph = workGraph;
    this.#adapters = adapters;
    this.#now = options.now ?? (() => new Date());
    this.#createNoteId = options.createNoteId ?? (() => crypto.randomUUID());
    this.#isAuthorised = options.isAuthorised ?? (() => true);
    this.#checkpointLeadTimeMs = z
      .number()
      .int()
      .nonnegative()
      .parse(options.checkpointLeadTimeMs ?? 60_000);
  }

  async start(input: StartSessionInput): Promise<CoordinatedSession> {
    const task = TaskRequirementsSchema.parse(input.task);
    const policy = OwnerPolicySchema.parse(input.policy);
    const maximumBudget = policyBudget(policy, task);
    const budgetUsd = input.budgetUsd ?? maximumBudget;
    if (budgetUsd < 0 || budgetUsd > maximumBudget) {
      throw new Error(
        `Session budget ${budgetUsd} exceeds the policy limit ${maximumBudget}`,
      );
    }
    const claimed = await this.#workGraph.claim(task, {
      workerId: input.workerId,
      leaseDurationSeconds: input.leaseDurationSeconds,
    });
    const handle = leaseHandle(claimed);
    try {
      const worker = await this.#adapters.launch(input.adapterId, {
        ...input.launch,
        taskId: task.taskId,
        budgetUsd,
      });
      const binding = SessionBindingSchema.parse({
        schemaVersion: 1,
        recordType: "session-binding",
        workerId: input.workerId,
        identity: worker.identity,
        adapter: this.#adapters.adapterIdentity(input.adapterId),
        workItem: claimed.workItem,
        lease: handle,
        policySnapshot: policy,
        contextPackageVersion: input.contextPackageVersion,
        context: claimed.context,
        budget: {
          limit: { currency: "USD", amount: budgetUsd },
          spent: { currency: "USD", amount: 0 },
        },
      });
      return { binding, worker };
    } catch (error) {
      await this.#recordStartupFailure(handle, error);
      throw error;
    }
  }

  async heartbeat(
    session: CoordinatedSession,
    input: {
      leaseDurationSeconds: number;
      healthy?: boolean;
      progress?: Partial<SessionProgress>;
    },
  ): Promise<HeartbeatResult> {
    const authorised =
      session.binding.policySnapshot.allowedAuthenticationPaths.includes(
        session.binding.identity.authenticationPathId,
      ) && (await this.#isAuthorised(session.binding));
    const signals = session.worker.signals();
    const failed = signals.some(
      (signal) => signal.kind === "failure" || signal.kind === "stopped",
    );
    const quota = await session.worker.quota();
    const cost = await session.worker.cost();
    session.binding = SessionBindingSchema.parse({
      ...session.binding,
      budget: {
        ...session.binding.budget,
        spent: { currency: "USD", amount: cost.amount },
      },
    });
    const nearDeadline =
      Date.parse(session.binding.lease.expiresAt) - this.#now().getTime() <=
      this.#checkpointLeadTimeMs;
    const stopReason = heartbeatStopReason({
      authorised,
      healthy: input.healthy !== false,
      failed,
      quotaState: quota.state,
      budgetExhausted:
        cost.funding === "metered" &&
        cost.amount >= session.binding.budget.limit.amount,
      nearDeadline,
    });
    if (stopReason) {
      const result = await this.checkpoint(session, {
        completedWork: input.progress?.completedWork ?? [],
        remainingWork: input.progress?.remainingWork ?? [],
        evidence: input.progress?.evidence ?? [],
        artifacts: input.progress?.artifacts ?? [],
        stopReason,
        stopWorker: true,
      });
      return { state: "checkpointed", session, ...result };
    }
    const renewed = await this.#workGraph.renew(
      session.binding.lease,
      input.leaseDurationSeconds,
    );
    session.binding = SessionBindingSchema.parse({
      ...session.binding,
      lease: { ...session.binding.lease, expiresAt: renewed.expiresAt },
    });
    return { state: "renewed", session };
  }

  checkpoint(
    session: CoordinatedSession,
    input: CheckpointSessionInput,
  ): Promise<{ checkpoint: DurableSessionCheckpoint; durable: CheckpointResult }> {
    const noteId = z.uuid().parse(input.noteId ?? this.#createNoteId());
    const existing = this.#checkpoints.get(noteId);
    if (existing) return existing;
    const operation = this.#writeCheckpoint(session, input, noteId);
    this.#checkpoints.set(noteId, operation);
    return operation;
  }

  async resume(
    checkpointInput: DurableSessionCheckpoint,
    input: {
      task: TaskRequirements;
      workerId: string;
      adapterId?: string;
      leaseDurationSeconds: number;
      launch: Omit<WorkerLaunchRequest, "taskId" | "budgetUsd">;
    },
  ): Promise<CoordinatedSession> {
    const checkpoint = DurableSessionCheckpointSchema.parse(checkpointInput);
    const task = TaskRequirementsSchema.parse(input.task);
    const claimed = await this.#workGraph.claim(task, {
      workerId: input.workerId,
      leaseDurationSeconds: input.leaseDurationSeconds,
    });
    const adapterId = input.adapterId ?? checkpoint.binding.adapter.adapterId;
    const request = {
      ...input.launch,
      taskId: task.taskId,
      budgetUsd: checkpoint.binding.budget.limit.amount,
      identity: checkpoint.binding.identity,
      checkpoint: checkpoint.adapterCheckpoint as CheckpointSignal,
    };
    const worker =
      adapterId === checkpoint.binding.adapter.adapterId
        ? await this.#adapters.resume(adapterId, request)
        : await this.#adapters.handoff(adapterId, request);
    const binding = SessionBindingSchema.parse({
      ...checkpoint.binding,
      workerId: input.workerId,
      identity: worker.identity,
      adapter: this.#adapters.adapterIdentity(adapterId),
      workItem: claimed.workItem,
      lease: leaseHandle(claimed),
      context: claimed.context,
    });
    return { binding, worker };
  }

  async providerFallback(
    session: CoordinatedSession,
    input: Omit<WorkerLaunchRequest, "taskId" | "budgetUsd">,
  ): Promise<CoordinatedSession> {
    if (session.binding.adapter.adapterKind !== "api-runner") {
      throw new Error("Provider fallback is only valid for API-runner sessions");
    }
    const checkpoint = await session.worker.checkpoint("provider fallback");
    const worker = await this.#adapters.resume(
      session.binding.adapter.adapterId,
      {
        ...input,
        taskId: session.binding.identity.taskId,
        budgetUsd: session.binding.budget.limit.amount,
        identity: session.binding.identity,
        checkpoint,
      },
    );
    return { binding: session.binding, worker };
  }

  async #writeCheckpoint(
    session: CoordinatedSession,
    input: CheckpointSessionInput,
    noteId: string,
  ): Promise<{ checkpoint: DurableSessionCheckpoint; durable: CheckpointResult }> {
    const progress = ProgressSchema.parse({
      completedWork: input.completedWork,
      remainingWork: input.remainingWork,
      evidence: input.evidence,
      artifacts: input.artifacts,
    });
    const adapterCheckpoint = await session.worker.checkpoint(input.stopReason);
    const checkpoint = DurableSessionCheckpointSchema.parse({
      schemaVersion: 1,
      recordType: "session-checkpoint",
      noteId,
      createdAt: this.#now().toISOString(),
      stopReason: input.stopReason,
      binding: {
        schemaVersion: session.binding.schemaVersion,
        recordType: session.binding.recordType,
        workerId: session.binding.workerId,
        identity: session.binding.identity,
        adapter: session.binding.adapter,
        lease: session.binding.lease,
        policySnapshot: session.binding.policySnapshot,
        contextPackageVersion: session.binding.contextPackageVersion,
        budget: session.binding.budget,
      },
      adapterCheckpoint,
      progress,
    });
    const durable = await this.#workGraph.checkpoint(
      session.binding.lease,
      JSON.stringify(checkpoint),
      { noteId },
    );
    if (input.stopWorker) await session.worker.stop(input.stopReason);
    return { checkpoint, durable };
  }

  async #recordStartupFailure(handle: LeaseHandle, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : "Worker launch failed";
    try {
      await this.#workGraph.checkpoint(
        handle,
        JSON.stringify({
          schemaVersion: 1,
          recordType: "session-startup-failure",
          stopReason: "client-failure",
          message,
        }),
        { noteId: this.#createNoteId() },
      );
    } catch {
      // The original launch error remains the useful failure. The lease expires
      // without renewal if Work Graph cannot accept the diagnostic note.
    }
  }
}
