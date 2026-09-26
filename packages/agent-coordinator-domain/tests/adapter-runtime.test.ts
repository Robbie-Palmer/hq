import { describe, expect, it, vi } from "vitest";

import {
  AuthenticationAllowlist,
  AuthenticationNotAllowedError,
  WorkerAdapterRuntime,
  type WorkerAdapter,
} from "../src";
import { adapter, authenticationEntry, session } from "./fixtures";

function testAdapter(): WorkerAdapter {
  return {
    identity: adapter,
    discoverAvailability: vi.fn().mockResolvedValue({
      state: "available",
      observedAt: "2026-09-26T08:00:00.000Z",
    }),
    launch: vi.fn().mockImplementation(async (_request, identity) => ({
      identity,
      checkpoint: vi.fn(),
      quota: vi.fn(),
      cost: vi.fn(),
      stop: vi.fn(),
      signals: () => [],
    })),
    resume: vi.fn().mockImplementation(async (request) => ({
      identity: request.identity,
      checkpoint: vi.fn(),
      quota: vi.fn(),
      cost: vi.fn(),
      stop: vi.fn(),
      signals: () => [],
    })),
  };
}

describe("worker adapter runtime", () => {
  it("creates one stable identity and preserves it when resuming", async () => {
    const worker = testAdapter();
    const runtime = new WorkerAdapterRuntime({
      adapters: [worker],
      allowlist: new AuthenticationAllowlist([authenticationEntry]),
      createSessionId: () => "session:stable",
      now: () => new Date("2026-09-26T08:00:00.000Z"),
    });

    const launched = await runtime.launch(adapter.adapterId, {
      taskId: "work:test",
      input: "Do the work",
      cwd: "/workspace",
    });
    expect(launched.identity.sessionId).toBe("session:stable");

    const resumed = await runtime.resume(adapter.adapterId, {
      taskId: "work:test",
      input: "Continue",
      cwd: "/workspace",
      identity: launched.identity,
      checkpoint: {
        kind: "checkpoint",
        checkpointId: "checkpoint:one",
        createdAt: "2026-09-26T08:01:00.000Z",
        reason: "usage limit",
        state: {},
      },
    });
    expect(resumed.identity).toEqual(launched.identity);
  });

  it("rejects new sessions as soon as an allowlist entry is disabled", async () => {
    const allowlist = new AuthenticationAllowlist([authenticationEntry]);
    const worker = testAdapter();
    const runtime = new WorkerAdapterRuntime({
      adapters: [worker],
      allowlist,
      createSessionId: () => session.sessionId,
    });
    allowlist.disable(
      authenticationEntry.authenticationPathId,
      "2026-09-26T09:00:00.000Z",
      "Provider documentation changed",
    );

    await expect(
      runtime.launch(adapter.adapterId, {
        taskId: "work:test",
        input: "Do the work",
        cwd: "/workspace",
      }),
    ).rejects.toBeInstanceOf(AuthenticationNotAllowedError);
    expect(worker.discoverAvailability).not.toHaveBeenCalled();
  });
});
