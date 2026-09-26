import type { AuthenticationAllowlist } from "./authentication";
import {
  ExecutionSessionIdentitySchema,
  WorkerAdapterIdentitySchema,
  type ExecutionSessionIdentity,
  type WorkerAdapterIdentity,
} from "./session";

export type AdapterAvailability =
  | { state: "available"; observedAt: string }
  | {
      state: "unavailable" | "quota-exhausted";
      observedAt: string;
      reason: string;
    };

export interface CheckpointSignal {
  kind: "checkpoint";
  checkpointId: string;
  createdAt: string;
  reason: string;
  state: Readonly<Record<string, unknown>>;
}

export interface QuotaSignal {
  kind: "quota";
  state: "available" | "near-limit" | "exhausted" | "unknown";
  observedAt: string;
  remaining?: number;
  unit?: string;
  resetsAt?: string;
}

export interface CostReport {
  kind: "cost";
  funding: "prepaid" | "metered";
  currency: "USD";
  amount: number;
  routeId: string;
  providerId: string;
  modelId?: string;
  requestId?: string;
}

export type WorkerSignal =
  | CheckpointSignal
  | QuotaSignal
  | CostReport
  | { kind: "stopped"; reason: string; stoppedAt: string }
  | { kind: "failure"; message: string; failedAt: string };

export interface WorkerLaunchRequest {
  taskId: string;
  input: string;
  cwd: string;
  budgetUsd?: number;
}

export interface WorkerResumeRequest extends WorkerLaunchRequest {
  identity: ExecutionSessionIdentity;
  checkpoint: CheckpointSignal;
}

export interface AdapterSession {
  readonly identity: ExecutionSessionIdentity;
  checkpoint(reason: string): Promise<CheckpointSignal>;
  quota(): Promise<QuotaSignal>;
  cost(): Promise<CostReport>;
  stop(reason: string): Promise<void>;
  signals(): readonly WorkerSignal[];
}

export interface WorkerAdapter {
  readonly identity: WorkerAdapterIdentity;
  discoverAvailability(): Promise<AdapterAvailability>;
  launch(
    request: WorkerLaunchRequest,
    identity: ExecutionSessionIdentity,
  ): Promise<AdapterSession>;
  resume(request: WorkerResumeRequest): Promise<AdapterSession>;
}

export class AdapterRuntimeError extends Error {
  constructor(
    readonly code:
      | "adapter-not-found"
      | "adapter-unavailable"
      | "identity-mismatch",
    message: string,
  ) {
    super(message);
    this.name = "AdapterRuntimeError";
  }
}

export interface WorkerAdapterRuntimeOptions {
  allowlist: AuthenticationAllowlist;
  adapters: readonly WorkerAdapter[];
  createSessionId: () => string;
  now?: () => Date;
}

export class WorkerAdapterRuntime {
  readonly #adapters = new Map<string, WorkerAdapter>();
  readonly #allowlist: AuthenticationAllowlist;
  readonly #createSessionId: () => string;
  readonly #now: () => Date;

  constructor(options: WorkerAdapterRuntimeOptions) {
    this.#allowlist = options.allowlist;
    this.#createSessionId = options.createSessionId;
    this.#now = options.now ?? (() => new Date());
    for (const adapter of options.adapters) {
      WorkerAdapterIdentitySchema.parse(adapter.identity);
      if (this.#adapters.has(adapter.identity.adapterId)) {
        throw new Error(`Duplicate adapter ${adapter.identity.adapterId}`);
      }
      this.#adapters.set(adapter.identity.adapterId, adapter);
    }
  }

  async discoverAvailability(adapterId: string): Promise<AdapterAvailability> {
    const adapter = this.#adapter(adapterId);
    this.#allowlist.requireEnabled(adapter.identity.authenticationPathId);
    return adapter.discoverAvailability();
  }

  async launch(
    adapterId: string,
    request: WorkerLaunchRequest,
  ): Promise<AdapterSession> {
    const adapter = this.#adapter(adapterId);
    this.#allowlist.requireEnabled(adapter.identity.authenticationPathId);
    const availability = await adapter.discoverAvailability();
    if (availability.state !== "available") {
      throw new AdapterRuntimeError(
        "adapter-unavailable",
        `${adapterId} is ${availability.state}`,
      );
    }
    const identity = ExecutionSessionIdentitySchema.parse({
      schemaVersion: 1,
      recordType: "execution-session",
      sessionId: this.#createSessionId(),
      taskId: request.taskId,
      actorId: adapter.identity.actorId,
      adapterId: adapter.identity.adapterId,
      adapterVersion: adapter.identity.adapterVersion,
      authenticationPathId: adapter.identity.authenticationPathId,
      startedAt: this.#now().toISOString(),
    });
    const session = await adapter.launch(request, identity);
    this.#assertIdentity(identity, session.identity);
    return session;
  }

  async resume(
    adapterId: string,
    request: WorkerResumeRequest,
  ): Promise<AdapterSession> {
    const adapter = this.#adapter(adapterId);
    this.#allowlist.requireEnabled(adapter.identity.authenticationPathId);
    this.#assertAdapterIdentity(adapter.identity, request.identity);
    if (request.taskId !== request.identity.taskId) {
      throw new AdapterRuntimeError(
        "identity-mismatch",
        "Resume request task does not match the stable session identity",
      );
    }
    const availability = await adapter.discoverAvailability();
    if (availability.state !== "available") {
      throw new AdapterRuntimeError(
        "adapter-unavailable",
        `${adapterId} is ${availability.state}`,
      );
    }
    const session = await adapter.resume(request);
    this.#assertIdentity(request.identity, session.identity);
    return session;
  }

  #adapter(adapterId: string): WorkerAdapter {
    const adapter = this.#adapters.get(adapterId);
    if (!adapter) {
      throw new AdapterRuntimeError(
        "adapter-not-found",
        `Adapter ${adapterId} is not registered`,
      );
    }
    return adapter;
  }

  #assertAdapterIdentity(
    adapter: WorkerAdapterIdentity,
    session: ExecutionSessionIdentity,
  ): void {
    if (
      session.adapterId !== adapter.adapterId ||
      session.adapterVersion !== adapter.adapterVersion ||
      session.actorId !== adapter.actorId ||
      session.authenticationPathId !== adapter.authenticationPathId
    ) {
      throw new AdapterRuntimeError(
        "identity-mismatch",
        "Session identity does not belong to this adapter",
      );
    }
  }

  #assertIdentity(
    expected: ExecutionSessionIdentity,
    actual: ExecutionSessionIdentity,
  ): void {
    const parsedExpected = ExecutionSessionIdentitySchema.parse(expected);
    const parsedActual = ExecutionSessionIdentitySchema.parse(actual);
    const fields = [
      "schemaVersion",
      "recordType",
      "sessionId",
      "taskId",
      "actorId",
      "adapterId",
      "adapterVersion",
      "authenticationPathId",
      "startedAt",
      "workGraphLeaseId",
      "predecessorSessionId",
    ] as const;
    if (fields.some((field) => parsedExpected[field] !== parsedActual[field])) {
      throw new AdapterRuntimeError(
        "identity-mismatch",
        "Adapter changed the stable session identity",
      );
    }
  }
}
