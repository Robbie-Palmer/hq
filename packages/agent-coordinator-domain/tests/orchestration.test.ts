import { describe, expect, it, vi } from "vitest";

import {
  AuthenticationAllowlist,
  SessionOrchestrator,
  WorkerAdapterRuntime,
  type AdapterSession,
  type CheckpointSignal,
  type ClaimedWork,
  type SessionWorkGraphPort,
  type WorkerAdapter,
  type WorkerSignal,
} from "../src";
import { adapter, authenticationEntry, policy, task } from "./fixtures";

const LEASE_IDS = [
  "641da305-0f50-4c15-a080-81c5d687c0ab",
  "741da305-0f50-4c15-a080-81c5d687c0ab",
] as const;
const NOTE_ID = "841da305-0f50-4c15-a080-81c5d687c0ab";
const NOW = "2026-09-27T08:00:00.000Z";

function claimedWork(index = 0): ClaimedWork {
  const lease = {
    id: LEASE_IDS[index] ?? LEASE_IDS[0],
    workItemId: task.taskId,
    workerId: "worker:test",
    epoch: index + 1,
    acquiredAt: NOW,
    expiresAt: `2026-09-27T08:${index === 0 ? "10" : "20"}:00.000Z`,
    endedAt: null,
    outcome: null,
  } as const;
  const workItem = {
    id: task.taskId,
    title: "Coordinate one session",
    lifecycle: "open" as const,
    parentId: null,
    rank: null,
    priorityRank: 1,
    schedulingInitiativeId: "initiative:test",
    schedulingProjectId: "project:test",
    expedited: false,
    expediteReason: null,
    stage: "in_progress" as const,
    currentLease: lease,
    priority: {
      initiativeRank: 1,
      projectRank: 1,
      ticketRank: 1,
      expedited: false,
      effectiveExpedited: false,
      donatedFromWorkItemId: null,
    },
  };
  return {
    lease,
    workItem,
    context: {
      schemaVersion: 1,
      workItem,
      taskRequirements: task,
      brief: {
        kind: "brief",
        content: "Run one accountable worker session.",
        sourceWorkItemId: task.taskId,
        inheritanceDepth: 0,
      },
      acceptanceCriteria: {
        kind: "acceptance_criteria",
        content: "Checkpoint before the worker stops.",
        sourceWorkItemId: task.taskId,
        inheritanceDepth: 0,
      },
      dependencies: [],
      architectureDecisions: [],
      references: [],
      notes: [],
      requiredEvidence: task.requiredEvidence,
    },
  };
}

function workGraphPort() {
  let claimIndex = 0;
  const port: SessionWorkGraphPort = {
    claim: vi.fn().mockImplementation(async () => claimedWork(claimIndex++)),
    renew: vi.fn().mockImplementation(async (handle) => ({
      ...handle,
      acquiredAt: NOW,
      expiresAt: "2026-09-27T08:30:00.000Z",
      endedAt: null,
      outcome: null,
    })),
    checkpoint: vi.fn().mockImplementation(async (handle, content, input) => ({
      note: {
        id: input?.noteId ?? NOTE_ID,
        workItemId: handle.workItemId,
        kind: "work",
        leaseId: handle.id,
        author: handle.workerId,
        content,
        createdAt: NOW,
      },
      lease: handle,
    })),
  };
  return port;
}

function adapterSession(
  identity: AdapterSession["identity"],
  signals: WorkerSignal[],
): AdapterSession {
  return {
    identity,
    checkpoint: vi.fn().mockResolvedValue({
      kind: "checkpoint",
      checkpointId: "checkpoint:test",
      createdAt: NOW,
      reason: "manual",
      state: { providerSessionId: "provider:test" },
    } satisfies CheckpointSignal),
    quota: vi.fn().mockResolvedValue({
      kind: "quota",
      state: "available",
      observedAt: NOW,
    }),
    cost: vi.fn().mockResolvedValue({
      kind: "cost",
      funding: "prepaid",
      currency: "USD",
      amount: 1,
      routeId: authenticationEntry.authenticationPathId,
      providerId: "provider:test",
    }),
    stop: vi.fn().mockResolvedValue(undefined),
    signals: () => signals,
  };
}

function runtime(signals: WorkerSignal[] = []) {
  const handoffAdapter = {
    ...adapter,
    adapterId: "adapter:second-native-client",
    adapterVersion: "2.0.0",
  } as const;
  const makeAdapter = (identity: typeof adapter): WorkerAdapter => ({
    identity,
    discoverAvailability: vi.fn().mockResolvedValue({
      state: "available",
      observedAt: NOW,
    }),
    launch: vi
      .fn()
      .mockImplementation(async (_request, identity) =>
        adapterSession(identity, signals),
      ),
    resume: vi
      .fn()
      .mockImplementation(async (request) =>
        adapterSession(request.identity, signals),
      ),
  });
  const adapters = [
    makeAdapter(adapter),
    makeAdapter(handoffAdapter as typeof adapter),
  ];
  const ids = ["session:first", "session:handoff"];
  return new WorkerAdapterRuntime({
    adapters,
    allowlist: new AuthenticationAllowlist([authenticationEntry]),
    createSessionId: () => ids.shift() ?? "session:extra",
    now: () => new Date(NOW),
  });
}

function apiRuntime() {
  const apiIdentity = { ...adapter, adapterKind: "api-runner" as const };
  const apiAdapter: WorkerAdapter = {
    identity: apiIdentity,
    discoverAvailability: vi.fn().mockResolvedValue({
      state: "available",
      observedAt: NOW,
    }),
    launch: vi
      .fn()
      .mockImplementation(async (_request, identity) =>
        adapterSession(identity, []),
      ),
    resume: vi
      .fn()
      .mockImplementation(async (request) => adapterSession(request.identity, [])),
  };
  return new WorkerAdapterRuntime({
    adapters: [apiAdapter],
    allowlist: new AuthenticationAllowlist([authenticationEntry]),
    createSessionId: () => "session:api",
    now: () => new Date(NOW),
  });
}

function startInput() {
  return {
    task,
    workerId: "worker:test",
    adapterId: adapter.adapterId,
    policy,
    contextPackageVersion: "context:v1",
    leaseDurationSeconds: 600,
    launch: { input: "Implement the ticket", cwd: "/workspace" },
    budgetUsd: 3,
  };
}

describe("session orchestration", () => {
  it("binds startup inputs and renews a healthy authorised session", async () => {
    const graph = workGraphPort();
    const orchestrator = new SessionOrchestrator(graph, runtime(), {
      now: () => new Date(NOW),
      createNoteId: () => NOTE_ID,
    });

    const session = await orchestrator.start(startInput());
    const heartbeat = await orchestrator.heartbeat(session, {
      leaseDurationSeconds: 600,
    });

    expect(session.binding).toMatchObject({
      workerId: "worker:test",
      adapter,
      policySnapshot: policy,
      contextPackageVersion: "context:v1",
      budget: { limit: { amount: 3 }, spent: { amount: 1 } },
      identity: { sessionId: "session:first" },
      lease: { id: LEASE_IDS[0] },
    });
    expect(heartbeat.state).toBe("renewed");
    expect(graph.renew).toHaveBeenCalledOnce();
    expect(graph.checkpoint).not.toHaveBeenCalled();
  });

  it("checkpoints instead of renewing after authorisation is revoked", async () => {
    const graph = workGraphPort();
    const orchestrator = new SessionOrchestrator(graph, runtime(), {
      now: () => new Date(NOW),
      createNoteId: () => NOTE_ID,
      isAuthorised: () => false,
    });
    const session = await orchestrator.start(startInput());

    const heartbeat = await orchestrator.heartbeat(session, {
      leaseDurationSeconds: 600,
      progress: {
        completedWork: ["Added session binding"],
        remainingWork: ["Open the pull request"],
        evidence: [{ kind: "test-results", value: "domain tests pass" }],
        artifacts: [{ kind: "source", location: "src/orchestration.ts" }],
      },
    });

    expect(heartbeat).toMatchObject({
      state: "checkpointed",
      checkpoint: {
        stopReason: "authorization-revoked",
        progress: { completedWork: ["Added session binding"] },
      },
    });
    expect(graph.renew).not.toHaveBeenCalled();
    expect(graph.checkpoint).toHaveBeenCalledOnce();
    expect(session.worker.stop).toHaveBeenCalledWith("authorization-revoked");
  });

  it("does not silently renew a crashed worker", async () => {
    const graph = workGraphPort();
    const failure: WorkerSignal = {
      kind: "failure",
      message: "client exited",
      failedAt: NOW,
    };
    const orchestrator = new SessionOrchestrator(graph, runtime([failure]), {
      now: () => new Date(NOW),
      createNoteId: () => NOTE_ID,
    });
    const session = await orchestrator.start(startInput());

    const heartbeat = await orchestrator.heartbeat(session, {
      leaseDurationSeconds: 600,
    });

    expect(heartbeat).toMatchObject({
      state: "checkpointed",
      checkpoint: { stopReason: "client-failure" },
    });
    expect(graph.renew).not.toHaveBeenCalled();
  });

  it.each([
    ["quota pressure", "quota-limit"],
    ["budget exhaustion", "budget-limit"],
    ["lease deadline", "time-limit"],
  ] as const)("checkpoints for %s", async (condition, stopReason) => {
    const graph = workGraphPort();
    const now =
      condition === "lease deadline"
        ? "2026-09-27T08:09:30.000Z"
        : NOW;
    const orchestrator = new SessionOrchestrator(graph, runtime(), {
      now: () => new Date(now),
      createNoteId: () => NOTE_ID,
    });
    const session = await orchestrator.start(startInput());
    if (condition === "quota pressure") {
      vi.mocked(session.worker.quota).mockResolvedValue({
        kind: "quota",
        state: "near-limit",
        observedAt: NOW,
      });
    }
    if (condition === "budget exhaustion") {
      vi.mocked(session.worker.cost).mockResolvedValue({
        kind: "cost",
        funding: "metered",
        currency: "USD",
        amount: 3,
        routeId: authenticationEntry.authenticationPathId,
        providerId: "provider:test",
      });
    }

    const heartbeat = await orchestrator.heartbeat(session, {
      leaseDurationSeconds: 600,
    });

    expect(heartbeat).toMatchObject({
      state: "checkpointed",
      checkpoint: { stopReason },
    });
    expect(graph.renew).not.toHaveBeenCalled();
  });

  it("deduplicates checkpoint retries and resumes after a new claim", async () => {
    const graph = workGraphPort();
    const orchestrator = new SessionOrchestrator(graph, runtime(), {
      now: () => new Date(NOW),
      createNoteId: () => NOTE_ID,
    });
    const session = await orchestrator.start(startInput());
    const request = {
      noteId: NOTE_ID,
      stopReason: "shutdown" as const,
      completedWork: ["Implemented orchestration"],
      remainingWork: ["Verify"],
      evidence: [],
      artifacts: [],
    };

    const firstOperation = orchestrator.checkpoint(session, request);
    const concurrentOperation = orchestrator.checkpoint(session, request);
    expect(concurrentOperation).toBe(firstOperation);
    const first = await firstOperation;
    const retried = await orchestrator.checkpoint(session, request);
    const resumed = await orchestrator.resume(first.checkpoint, {
      task,
      workerId: "worker:test",
      leaseDurationSeconds: 600,
      launch: { input: "Resume", cwd: "/workspace" },
    });

    expect(retried.durable.note.id).toBe(first.durable.note.id);
    expect(graph.checkpoint).toHaveBeenCalledTimes(2);
    expect(session.worker.checkpoint).toHaveBeenCalledTimes(2);
    expect(resumed.binding.lease.id).toBe(LEASE_IDS[1]);
    expect(resumed.binding.identity).toEqual(session.binding.identity);
  });

  it("creates an explicit predecessor-linked session when adapters change", async () => {
    const graph = workGraphPort();
    const orchestrator = new SessionOrchestrator(graph, runtime(), {
      now: () => new Date(NOW),
      createNoteId: () => NOTE_ID,
    });
    const session = await orchestrator.start(startInput());
    await orchestrator.heartbeat(session, { leaseDurationSeconds: 600 });
    const { checkpoint } = await orchestrator.checkpoint(session, {
      stopReason: "manual",
      completedWork: [],
      remainingWork: ["Continue with another client"],
      evidence: [],
      artifacts: [],
    });

    const resumed = await orchestrator.resume(checkpoint, {
      task,
      workerId: "worker:test",
      adapterId: "adapter:second-native-client",
      leaseDurationSeconds: 600,
      launch: { input: "Continue", cwd: "/workspace" },
    });

    expect(resumed.binding.identity).toMatchObject({
      sessionId: "session:handoff",
      predecessorSessionId: "session:first",
      adapterId: "adapter:second-native-client",
    });
    expect(resumed.costBaselineUsd).toBe(1);
    expect(resumed.workerBudgetUsd).toBe(2);
    vi.mocked(resumed.worker.cost).mockResolvedValue({
      kind: "cost",
      funding: "metered",
      currency: "USD",
      amount: 1.5,
      routeId: authenticationEntry.authenticationPathId,
      providerId: "provider:test",
    });
    await orchestrator.heartbeat(resumed, { leaseDurationSeconds: 600 });
    expect(resumed.binding.budget.spent.amount).toBe(2.5);
  });

  it("rejects a mismatched resume before claiming and records launch failures", async () => {
    const graph = workGraphPort();
    const orchestrator = new SessionOrchestrator(graph, runtime(), {
      now: () => new Date(NOW),
      createNoteId: () => NOTE_ID,
    });
    const session = await orchestrator.start(startInput());
    const { checkpoint } = await orchestrator.checkpoint(session, {
      stopReason: "manual",
      completedWork: [],
      remainingWork: ["Resume"],
      evidence: [],
      artifacts: [],
    });

    await expect(
      orchestrator.resume(checkpoint, {
        task: { ...task, taskId: "work:other" },
        workerId: "worker:test",
        leaseDurationSeconds: 600,
        launch: { input: "Wrong task", cwd: "/workspace" },
      }),
    ).rejects.toThrow("does not match");
    expect(graph.claim).toHaveBeenCalledOnce();

    await expect(
      orchestrator.resume(checkpoint, {
        task,
        workerId: "worker:test",
        adapterId: "adapter:missing",
        leaseDurationSeconds: 600,
        launch: { input: "Unavailable adapter", cwd: "/workspace" },
      }),
    ).rejects.toMatchObject({ code: "adapter-not-found" });
    expect(graph.claim).toHaveBeenCalledTimes(2);
    expect(graph.checkpoint).toHaveBeenCalledTimes(2);
  });

  it("keeps the binding stable during an API provider fallback", async () => {
    const graph = workGraphPort();
    const orchestrator = new SessionOrchestrator(graph, apiRuntime(), {
      now: () => new Date(NOW),
      createNoteId: () => NOTE_ID,
    });
    const session = await orchestrator.start(startInput());

    const fallback = await orchestrator.providerFallback(session, {
      input: "Retry through another provider",
      cwd: "/workspace",
    });

    expect(fallback.binding).toBe(session.binding);
    expect(fallback.worker.identity).toEqual(session.worker.identity);
    expect(graph.claim).toHaveBeenCalledOnce();
    expect(graph.renew).not.toHaveBeenCalled();
  });
});
