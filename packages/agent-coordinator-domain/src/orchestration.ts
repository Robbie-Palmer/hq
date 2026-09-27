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
import {
  CurrencySchema,
  IdentifierSchema,
  MoneySchema,
  type Currency,
  type Money,
} from "./vocabulary";

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

export const CurrencyConversionSchema = z
  .object({
    sourceCurrency: CurrencySchema,
    targetCurrency: CurrencySchema,
    rate: z.number().positive(),
    source: z.string().trim().min(1).max(500),
    observedAt: TimestampSchema,
  })
  .strict()
  .refine(
    ({ sourceCurrency, targetCurrency }) =>
      sourceCurrency !== targetCurrency,
    {
      message: "Currency conversion must connect different currencies",
      path: ["targetCurrency"],
    },
  );
export type CurrencyConversion = z.infer<typeof CurrencyConversionSchema>;

export class CurrencyConversionRequiredError extends Error {
  readonly code = "currency-conversion-required";

  constructor(
    readonly sourceCurrency: Currency,
    readonly targetCurrency: Currency,
  ) {
    super(
      `No conversion is recorded from ${sourceCurrency} to ${targetCurrency}`,
    );
    this.name = "CurrencyConversionRequiredError";
  }
}

const SessionBindingBaseSchema = z
  .object({
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
    currencyConversions: z.array(CurrencyConversionSchema).max(100),
  })
  .strict();

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
    costBaseline: MoneySchema,
    workerBudget: MoneySchema,
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
  .strict()
  .superRefine((checkpoint, context) => {
    const budgetCurrency = checkpoint.binding.budget.limit.currency;
    if (checkpoint.costBaseline.currency !== budgetCurrency) {
      context.addIssue({
        code: "custom",
        message: "Cost baseline must use the session budget currency",
        path: ["costBaseline", "currency"],
      });
    }
    const workerCurrency =
      checkpoint.binding.adapter.settlementCurrency ?? budgetCurrency;
    if (checkpoint.workerBudget.currency !== workerCurrency) {
      context.addIssue({
        code: "custom",
        message: "Worker budget must use the adapter settlement currency",
        path: ["workerBudget", "currency"],
      });
    }
  });
export type DurableSessionCheckpoint = z.infer<
  typeof DurableSessionCheckpointSchema
>;

export interface CoordinatedSession {
  binding: SessionBinding;
  worker: AdapterSession;
  costBaseline: Money;
  workerBudget: Money;
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
  launch: Omit<WorkerLaunchRequest, "taskId" | "budget">;
  budget?: Money;
  currencyConversions?: readonly CurrencyConversion[];
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

function policyBudget(policy: OwnerPolicy, task: TaskRequirements): Money {
  const configured = policy.budgets.find(
    ({ workClass }) => workClass === task.workClass,
  );
  if (!configured) {
    if (task.estimatedCost) return task.estimatedCost;
    throw new Error(`Policy has no budget for ${task.workClass}`);
  }
  return {
    currency: configured.maximumPerSession.currency,
    amount: Math.min(
      configured.maximumPerSession.amount,
      configured.remaining.amount,
    ),
  };
}

function mergeConversions(
  existing: readonly CurrencyConversion[],
  added: readonly CurrencyConversion[] = [],
): CurrencyConversion[] {
  const records = [...existing];
  for (const input of added) {
    const conversion = CurrencyConversionSchema.parse(input);
    const index = records.findIndex(
      (record) =>
        record.sourceCurrency === conversion.sourceCurrency &&
        record.targetCurrency === conversion.targetCurrency,
    );
    if (index === -1) records.push(conversion);
    else records[index] = conversion;
  }
  return records;
}

function convertMoney(
  money: Money,
  targetCurrency: Currency,
  conversions: readonly CurrencyConversion[],
): Money {
  if (money.currency === targetCurrency) return money;
  const direct = conversions.find(
    (record) =>
      record.sourceCurrency === money.currency &&
      record.targetCurrency === targetCurrency,
  );
  if (direct) {
    return { currency: targetCurrency, amount: money.amount * direct.rate };
  }
  const inverse = conversions.find(
    (record) =>
      record.sourceCurrency === targetCurrency &&
      record.targetCurrency === money.currency,
  );
  if (inverse) {
    return { currency: targetCurrency, amount: money.amount / inverse.rate };
  }
  throw new CurrencyConversionRequiredError(money.currency, targetCurrency);
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
    const budget = MoneySchema.parse(input.budget ?? maximumBudget);
    if (
      budget.currency !== maximumBudget.currency ||
      budget.amount > maximumBudget.amount
    ) {
      throw new Error(
        `Session budget must not exceed ${maximumBudget.amount} ${maximumBudget.currency}`,
      );
    }
    const adapter = this.#adapters.adapterIdentity(input.adapterId);
    const currencyConversions = mergeConversions(
      [],
      input.currencyConversions,
    );
    const workerBudget = adapter.settlementCurrency
      ? convertMoney(budget, adapter.settlementCurrency, currencyConversions)
      : budget;
    const claimed = await this.#workGraph.claim(task, {
      workerId: input.workerId,
      leaseDurationSeconds: input.leaseDurationSeconds,
    });
    const handle = leaseHandle(claimed);
    try {
      const worker = await this.#adapters.launch(input.adapterId, {
        ...input.launch,
        taskId: task.taskId,
        budget: workerBudget,
      });
      const binding = SessionBindingSchema.parse({
        schemaVersion: 1,
        recordType: "session-binding",
        workerId: input.workerId,
        identity: worker.identity,
        adapter,
        workItem: claimed.workItem,
        lease: handle,
        policySnapshot: policy,
        contextPackageVersion: input.contextPackageVersion,
        context: claimed.context,
        budget: {
          limit: budget,
          spent: { currency: budget.currency, amount: 0 },
        },
        currencyConversions,
      });
      return {
        binding,
        worker,
        costBaseline: { currency: budget.currency, amount: 0 },
        workerBudget,
      };
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
      currencyConversions?: readonly CurrencyConversion[];
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
    const currencyConversions = mergeConversions(
      session.binding.currencyConversions,
      input.currencyConversions,
    );
    const currentCost =
      cost.funding === "metered"
        ? convertMoney(
            cost.cost,
            session.binding.budget.limit.currency,
            currencyConversions,
          )
        : { currency: session.binding.budget.limit.currency, amount: 0 };
    const totalSpent = session.costBaseline.amount + currentCost.amount;
    session.binding = SessionBindingSchema.parse({
      ...session.binding,
      budget: {
        ...session.binding.budget,
        spent: {
          currency: session.binding.budget.limit.currency,
          amount: totalSpent,
        },
      },
      currencyConversions,
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
        totalSpent >= session.binding.budget.limit.amount,
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
    const operation = this.#writeCheckpoint(session, input, noteId).finally(
      () => {
        this.#checkpoints.delete(noteId);
      },
    );
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
      launch: Omit<WorkerLaunchRequest, "taskId" | "budget">;
      currencyConversions?: readonly CurrencyConversion[];
    },
  ): Promise<CoordinatedSession> {
    const checkpoint = DurableSessionCheckpointSchema.parse(checkpointInput);
    const task = TaskRequirementsSchema.parse(input.task);
    if (task.taskId !== checkpoint.binding.identity.taskId) {
      throw new Error("Resume task does not match the checkpointed session");
    }
    const adapterId = input.adapterId ?? checkpoint.binding.adapter.adapterId;
    const sameAdapter = adapterId === checkpoint.binding.adapter.adapterId;
    const adapter = this.#adapters.adapterIdentity(adapterId);
    const currencyConversions = mergeConversions(
      checkpoint.binding.currencyConversions,
      input.currencyConversions,
    );
    const remainingBudget = Math.max(
      0,
      checkpoint.binding.budget.limit.amount -
        checkpoint.binding.budget.spent.amount,
    );
    const remaining = {
      currency: checkpoint.binding.budget.limit.currency,
      amount: remainingBudget,
    };
    const nextWorkerBudget = sameAdapter
      ? checkpoint.workerBudget
      : adapter.settlementCurrency
        ? convertMoney(
            remaining,
            adapter.settlementCurrency,
            currencyConversions,
          )
        : remaining;
    if (!sameAdapter) {
      this.#adapters.requireCheckpointCompatibility(
        adapterId,
        checkpoint.adapterCheckpoint as CheckpointSignal,
      );
    }
    const claimed = await this.#workGraph.claim(task, {
      workerId: input.workerId,
      leaseDurationSeconds: input.leaseDurationSeconds,
    });
    const handle = leaseHandle(claimed);
    const request = {
      ...input.launch,
      taskId: task.taskId,
      budget: nextWorkerBudget,
      identity: checkpoint.binding.identity,
      checkpoint: checkpoint.adapterCheckpoint as CheckpointSignal,
    };
    let worker: AdapterSession;
    try {
      worker = sameAdapter
        ? await this.#adapters.resume(adapterId, request)
        : await this.#adapters.handoff(adapterId, request);
    } catch (error) {
      await this.#recordStartupFailure(handle, error);
      throw error;
    }
    const binding = SessionBindingSchema.parse({
      ...checkpoint.binding,
      workerId: input.workerId,
      identity: worker.identity,
      adapter,
      workItem: claimed.workItem,
      lease: handle,
      context: claimed.context,
      currencyConversions,
    });
    return {
      binding,
      worker,
      costBaseline: sameAdapter
        ? checkpoint.costBaseline
        : checkpoint.binding.budget.spent,
      workerBudget: nextWorkerBudget,
    };
  }

  async providerFallback(
    session: CoordinatedSession,
    input: Omit<WorkerLaunchRequest, "taskId" | "budget">,
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
        budget: session.workerBudget,
        identity: session.binding.identity,
        checkpoint,
      },
    );
    return {
      binding: session.binding,
      worker,
      costBaseline: session.costBaseline,
      workerBudget: session.workerBudget,
    };
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
      costBaseline: session.costBaseline,
      workerBudget: session.workerBudget,
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
        currencyConversions: session.binding.currencyConversions,
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
