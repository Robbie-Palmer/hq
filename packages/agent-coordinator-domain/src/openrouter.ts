import type {
  AdapterAvailability,
  AdapterSession,
  CheckpointSignal,
  CostReport,
  QuotaSignal,
  WorkerAdapter,
  WorkerLaunchRequest,
  WorkerResumeRequest,
  WorkerSignal,
} from "./adapter";
import { redactAdapterText } from "./native-client";
import type {
  ExecutionSessionIdentity,
  WorkerAdapterIdentity,
} from "./session";

export class SessionBudgetExceededError extends Error {
  readonly code = "session-budget-exhausted";

  constructor(
    readonly budgetUsd: number,
    readonly spentUsd: number,
    readonly requestedMaximumUsd: number,
  ) {
    super("The request would exceed the session budget");
    this.name = "SessionBudgetExceededError";
  }
}

export interface OpenRouterRequest {
  requestId: string;
  model: string;
  input: string;
  maximumCostUsd: number;
}

export interface OpenRouterTransportRequest extends OpenRouterRequest {
  sessionId: string;
}

export interface OpenRouterTransportResult {
  output: string;
  providerId: string;
  modelId: string;
  costUsd: number;
}

export interface OpenRouterTransport {
  isAvailable(): Promise<boolean>;
  execute(request: OpenRouterTransportRequest): Promise<OpenRouterTransportResult>;
}

export interface OpenRouterSession extends AdapterSession {
  execute(request: OpenRouterRequest): Promise<OpenRouterTransportResult>;
}

export interface OpenRouterAdapterOptions {
  actorId: string;
  authenticationPathId: string;
  transport: OpenRouterTransport;
  now?: () => Date;
  createCheckpointId?: () => string;
}

class MeteredOpenRouterSession implements OpenRouterSession {
  readonly #events: WorkerSignal[] = [];
  readonly #transport: OpenRouterTransport;
  readonly #budgetUsd: number;
  readonly #routeId: string;
  readonly #now: () => Date;
  readonly #createCheckpointId: () => string;
  #spentUsd = 0;
  #reservedUsd = 0;

  constructor(
    readonly identity: ExecutionSessionIdentity,
    options: {
      transport: OpenRouterTransport;
      budgetUsd: number;
      routeId: string;
      now: () => Date;
      createCheckpointId: () => string;
      spentUsd?: number;
    },
  ) {
    this.#transport = options.transport;
    this.#budgetUsd = options.budgetUsd;
    this.#routeId = options.routeId;
    this.#now = options.now;
    this.#createCheckpointId = options.createCheckpointId;
    this.#spentUsd = options.spentUsd ?? 0;
  }

  async execute(request: OpenRouterRequest): Promise<OpenRouterTransportResult> {
    if (
      !Number.isFinite(request.maximumCostUsd) ||
      request.maximumCostUsd <= 0 ||
      this.#spentUsd + this.#reservedUsd + request.maximumCostUsd >
        this.#budgetUsd
    ) {
      throw new SessionBudgetExceededError(
        this.#budgetUsd,
        this.#spentUsd,
        request.maximumCostUsd,
      );
    }
    this.#reservedUsd += request.maximumCostUsd;
    let result: OpenRouterTransportResult;
    try {
      result = await this.#transport.execute({
        ...request,
        sessionId: this.identity.sessionId,
      });
    } catch (error) {
      throw new Error(
        redactAdapterText(
          error instanceof Error ? error.message : "OpenRouter request failed",
        ),
      );
    } finally {
      this.#reservedUsd -= request.maximumCostUsd;
    }
    if (!Number.isFinite(result.costUsd) || result.costUsd < 0) {
      throw new Error("OpenRouter transport returned an invalid metered cost");
    }
    this.#spentUsd += result.costUsd;
    this.#events.push({
      kind: "cost",
      funding: "metered",
      currency: "USD",
      amount: result.costUsd,
      routeId: this.#routeId,
      providerId: result.providerId,
      modelId: result.modelId,
      requestId: request.requestId,
    });
    if (result.costUsd > request.maximumCostUsd) {
      throw new Error(
        "OpenRouter transport exceeded the reserved request cost",
      );
    }
    return result;
  }

  async checkpoint(reason: string): Promise<CheckpointSignal> {
    const signal: CheckpointSignal = {
      kind: "checkpoint",
      checkpointId: this.#createCheckpointId(),
      createdAt: this.#now().toISOString(),
      reason,
      state: { spentUsd: this.#spentUsd, budgetUsd: this.#budgetUsd },
    };
    this.#events.push(signal);
    return signal;
  }

  async quota(): Promise<QuotaSignal> {
    const remaining = Math.max(0, this.#budgetUsd - this.#spentUsd);
    const signal: QuotaSignal = {
      kind: "quota",
      state: remaining === 0 ? "exhausted" : "available",
      remaining,
      unit: "USD",
      observedAt: this.#now().toISOString(),
    };
    this.#events.push(signal);
    return signal;
  }

  async cost(): Promise<CostReport> {
    const report: CostReport = {
      kind: "cost",
      funding: "metered",
      currency: "USD",
      amount: this.#spentUsd,
      routeId: this.#routeId,
      providerId: "provider:openrouter",
    };
    return report;
  }

  async stop(reason: string): Promise<void> {
    this.#events.push({
      kind: "stopped",
      reason: redactAdapterText(reason),
      stoppedAt: this.#now().toISOString(),
    });
  }

  signals(): readonly WorkerSignal[] {
    return this.#events;
  }
}

export function createOpenRouterAdapter(
  options: OpenRouterAdapterOptions,
): WorkerAdapter {
  const now = options.now ?? (() => new Date());
  const createCheckpointId =
    options.createCheckpointId ?? (() => crypto.randomUUID());
  const identity: WorkerAdapterIdentity = {
    schemaVersion: 1,
    recordType: "worker-adapter",
    adapterId: "adapter:openrouter-api",
    adapterVersion: "1.0.0",
    actorId: options.actorId,
    adapterKind: "api-runner",
    authenticationPathId: options.authenticationPathId,
    tools: ["openrouter-api"],
    evidenceKinds: ["checkpoint", "metered-cost"],
    supportsCheckpointing: true,
  };

  const start = (
    request: WorkerLaunchRequest,
    sessionIdentity: ExecutionSessionIdentity,
    resumed?: { budgetUsd: number; spentUsd: number },
  ): OpenRouterSession => {
    const budgetUsd = resumed?.budgetUsd ?? request.budgetUsd;
    const spentUsd = resumed?.spentUsd ?? 0;
    if (
      budgetUsd === undefined ||
      !Number.isFinite(budgetUsd) ||
      budgetUsd <= 0 ||
      !Number.isFinite(spentUsd) ||
      spentUsd < 0 ||
      spentUsd > budgetUsd ||
      (request.budgetUsd !== undefined && request.budgetUsd !== budgetUsd)
    ) {
      throw new SessionBudgetExceededError(budgetUsd ?? 0, spentUsd, 0);
    }
    return new MeteredOpenRouterSession(sessionIdentity, {
      transport: options.transport,
      budgetUsd,
      routeId: options.authenticationPathId,
      now,
      createCheckpointId,
      spentUsd,
    });
  };

  return {
    identity,
    async discoverAvailability(): Promise<AdapterAvailability> {
      const available = await options.transport.isAvailable();
      return available
        ? { state: "available", observedAt: now().toISOString() }
        : {
            state: "unavailable",
            observedAt: now().toISOString(),
            reason: "OpenRouter transport is unavailable",
          };
    },
    async launch(request, sessionIdentity) {
      return start(request, sessionIdentity);
    },
    async resume(request: WorkerResumeRequest) {
      const { budgetUsd, spentUsd } = request.checkpoint.state;
      if (typeof budgetUsd !== "number" || typeof spentUsd !== "number") {
        throw new Error("OpenRouter checkpoint does not contain budget state");
      }
      return start(request, request.identity, { budgetUsd, spentUsd });
    },
  };
}
