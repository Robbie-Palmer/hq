import { describe, expect, it, vi } from "vitest";

import {
  AuthenticationAllowlist,
  createOpenRouterAdapter,
  SessionBudgetExceededError,
  WorkerAdapterRuntime,
  type AuthenticationAllowlistEntry,
  type OpenRouterSession,
  type OpenRouterTransport,
} from "../src";

const authenticationEntry: AuthenticationAllowlistEntry = {
  schemaVersion: 1,
  recordType: "authentication-allowlist-entry",
  authenticationPathId: "auth:openrouter-api-key",
  providerId: "provider:openrouter",
  routeKind: "api-gateway",
  accountClass: "account:api-funded",
  approvalBasis: {
    kind: "provider-documentation",
    referenceUrl: "https://openrouter.ai/docs/api-reference/overview",
    reviewedAt: "2026-09-26T08:00:00.000Z",
  },
  enabled: true,
};

describe("OpenRouter adapter", () => {
  it("preserves session identity and attributes metered request cost", async () => {
    const transport: OpenRouterTransport = {
      isAvailable: vi.fn().mockResolvedValue(true),
      execute: vi.fn().mockResolvedValue({
        output: "result",
        providerId: "provider:inference-vendor",
        modelId: "vendor/model",
        costUsd: 0.35,
      }),
    };
    const adapter = createOpenRouterAdapter({
      actorId: "actor:api-agent",
      authenticationPathId: authenticationEntry.authenticationPathId,
      transport,
      createCheckpointId: () => "checkpoint:api",
    });
    const runtime = new WorkerAdapterRuntime({
      allowlist: new AuthenticationAllowlist([authenticationEntry]),
      adapters: [adapter],
      createSessionId: () => "session:api-stable",
    });
    const session = (await runtime.launch(adapter.identity.adapterId, {
      taskId: "work:api",
      input: "",
      cwd: "/workspace",
      budgetUsd: 1,
    })) as OpenRouterSession;

    await session.execute({
      requestId: "request:one",
      model: "vendor/model",
      input: "Do the work",
      maximumCostUsd: 0.5,
    });

    expect(transport.execute).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "session:api-stable" }),
    );
    expect(await session.cost()).toMatchObject({
      funding: "metered",
      amount: 0.35,
    });
    expect(session.signals()).toContainEqual(
      expect.objectContaining({
        kind: "cost",
        providerId: "provider:inference-vendor",
        modelId: "vendor/model",
        requestId: "request:one",
        amount: 0.35,
      }),
    );
  });

  it("rejects a request before transport when its reservation exceeds the hard budget", async () => {
    const transport: OpenRouterTransport = {
      isAvailable: vi.fn().mockResolvedValue(true),
      execute: vi.fn(),
    };
    const adapter = createOpenRouterAdapter({
      actorId: "actor:api-agent",
      authenticationPathId: authenticationEntry.authenticationPathId,
      transport,
    });
    const runtime = new WorkerAdapterRuntime({
      allowlist: new AuthenticationAllowlist([authenticationEntry]),
      adapters: [adapter],
      createSessionId: () => "session:api",
    });
    const session = (await runtime.launch(adapter.identity.adapterId, {
      taskId: "work:api",
      input: "",
      cwd: "/workspace",
      budgetUsd: 0.25,
    })) as OpenRouterSession;

    await expect(
      session.execute({
        requestId: "request:too-expensive",
        model: "vendor/model",
        input: "Do the work",
        maximumCostUsd: 0.3,
      }),
    ).rejects.toBeInstanceOf(SessionBudgetExceededError);
    expect(transport.execute).not.toHaveBeenCalled();
  });

  it("reserves concurrent request ceilings and redacts transport failures", async () => {
    let finishFirst: (() => void) | undefined;
    const firstResult = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    const transport: OpenRouterTransport = {
      isAvailable: vi.fn().mockResolvedValue(true),
      execute: vi
        .fn()
        .mockImplementationOnce(async () => {
          await firstResult;
          return {
            output: "done",
            providerId: "provider:one",
            modelId: "model:one",
            costUsd: 0.2,
          };
        })
        .mockRejectedValueOnce(new Error("Bearer private-api-token")),
    };
    const adapter = createOpenRouterAdapter({
      actorId: "actor:api-agent",
      authenticationPathId: authenticationEntry.authenticationPathId,
      transport,
    });
    const runtime = new WorkerAdapterRuntime({
      allowlist: new AuthenticationAllowlist([authenticationEntry]),
      adapters: [adapter],
      createSessionId: () => "session:api",
    });
    const session = (await runtime.launch(adapter.identity.adapterId, {
      taskId: "work:api",
      input: "",
      cwd: "/workspace",
      budgetUsd: 0.5,
    })) as OpenRouterSession;

    const first = session.execute({
      requestId: "request:first",
      model: "model:one",
      input: "first",
      maximumCostUsd: 0.3,
    });
    await expect(
      session.execute({
        requestId: "request:concurrent",
        model: "model:one",
        input: "second",
        maximumCostUsd: 0.3,
      }),
    ).rejects.toBeInstanceOf(SessionBudgetExceededError);
    finishFirst?.();
    await first;

    await expect(
      session.execute({
        requestId: "request:failing",
        model: "model:one",
        input: "third",
        maximumCostUsd: 0.2,
      }),
    ).rejects.toThrow("Bearer [REDACTED]");
  });

  it("restores spend from a checkpoint when resuming", async () => {
    const transport: OpenRouterTransport = {
      isAvailable: vi.fn().mockResolvedValue(true),
      execute: vi.fn().mockResolvedValue({
        output: "done",
        providerId: "provider:one",
        modelId: "model:one",
        costUsd: 0.4,
      }),
    };
    const adapter = createOpenRouterAdapter({
      actorId: "actor:api-agent",
      authenticationPathId: authenticationEntry.authenticationPathId,
      transport,
      createCheckpointId: () => "checkpoint:api",
    });
    const runtime = new WorkerAdapterRuntime({
      allowlist: new AuthenticationAllowlist([authenticationEntry]),
      adapters: [adapter],
      createSessionId: () => "session:api",
    });
    const first = (await runtime.launch(adapter.identity.adapterId, {
      taskId: "work:api",
      input: "",
      cwd: "/workspace",
      budgetUsd: 1,
    })) as OpenRouterSession;
    await first.execute({
      requestId: "request:first",
      model: "model:one",
      input: "first",
      maximumCostUsd: 0.5,
    });
    const checkpoint = await first.checkpoint("restart process");

    const resumed = (await runtime.resume(adapter.identity.adapterId, {
      taskId: "work:api",
      input: "",
      cwd: "/workspace",
      budgetUsd: 1,
      identity: first.identity,
      checkpoint,
    })) as OpenRouterSession;

    expect(await resumed.cost()).toMatchObject({ amount: 0.4 });
    await expect(
      resumed.execute({
        requestId: "request:over-budget",
        model: "model:one",
        input: "second",
        maximumCostUsd: 0.7,
      }),
    ).rejects.toBeInstanceOf(SessionBudgetExceededError);
  });

  it("records a transport cost that violates its reserved ceiling", async () => {
    const transport: OpenRouterTransport = {
      isAvailable: vi.fn().mockResolvedValue(true),
      execute: vi.fn().mockResolvedValue({
        output: "done",
        providerId: "provider:one",
        modelId: "model:one",
        costUsd: 0.6,
      }),
    };
    const adapter = createOpenRouterAdapter({
      actorId: "actor:api-agent",
      authenticationPathId: authenticationEntry.authenticationPathId,
      transport,
    });
    const runtime = new WorkerAdapterRuntime({
      allowlist: new AuthenticationAllowlist([authenticationEntry]),
      adapters: [adapter],
      createSessionId: () => "session:api",
    });
    const session = (await runtime.launch(adapter.identity.adapterId, {
      taskId: "work:api",
      input: "",
      cwd: "/workspace",
      budgetUsd: 1,
    })) as OpenRouterSession;

    await expect(
      session.execute({
        requestId: "request:bad-ceiling",
        model: "model:one",
        input: "work",
        maximumCostUsd: 0.5,
      }),
    ).rejects.toThrow("exceeded the reserved request cost");
    expect(await session.cost()).toMatchObject({ amount: 0.6 });
  });
});
