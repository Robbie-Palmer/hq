import { describe, expect, it, vi } from "vitest";

import {
  AdapterRuntimeError,
  AuthenticationAllowlistEntrySchema,
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
  it("discovers an allowed adapter and rejects duplicate registrations", async () => {
    const worker = testAdapter();
    const options = {
      adapters: [worker],
      allowlist: new AuthenticationAllowlist([authenticationEntry]),
      createSessionId: () => "session:stable",
    };
    const runtime = new WorkerAdapterRuntime(options);

    await expect(runtime.discoverAvailability(adapter.adapterId)).resolves.toMatchObject({
      state: "available",
    });
    expect(
      () => new WorkerAdapterRuntime({ ...options, adapters: [worker, worker] }),
    ).toThrow(`Duplicate adapter ${adapter.adapterId}`);
  });

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

  it("accepts an equivalent identity with a different property order", async () => {
    const worker = testAdapter();
    worker.launch = vi.fn().mockImplementation(async (_request, identity) => ({
      identity: {
        taskId: identity.taskId,
        sessionId: identity.sessionId,
        schemaVersion: identity.schemaVersion,
        recordType: identity.recordType,
        actorId: identity.actorId,
        adapterId: identity.adapterId,
        adapterVersion: identity.adapterVersion,
        authenticationPathId: identity.authenticationPathId,
        startedAt: identity.startedAt,
      },
      checkpoint: vi.fn(),
      quota: vi.fn(),
      cost: vi.fn(),
      stop: vi.fn(),
      signals: () => [],
    }));
    const runtime = new WorkerAdapterRuntime({
      adapters: [worker],
      allowlist: new AuthenticationAllowlist([authenticationEntry]),
      createSessionId: () => "session:stable",
    });

    await expect(
      runtime.launch(adapter.adapterId, {
        taskId: "work:test",
        input: "Do the work",
        cwd: "/workspace",
      }),
    ).resolves.toMatchObject({ identity: { sessionId: "session:stable" } });
  });

  it("rejects unknown, unavailable, and mismatched sessions", async () => {
    const worker = testAdapter();
    vi.mocked(worker.discoverAvailability).mockResolvedValue({
      state: "quota-exhausted",
      observedAt: "2026-09-26T08:00:00.000Z",
      reason: "No capacity",
    });
    const runtime = new WorkerAdapterRuntime({
      adapters: [worker],
      allowlist: new AuthenticationAllowlist([authenticationEntry]),
      createSessionId: () => "session:stable",
    });

    await expect(
      runtime.launch("adapter:missing", {
        taskId: "work:test",
        input: "test",
        cwd: "/workspace",
      }),
    ).rejects.toMatchObject({ code: "adapter-not-found" });
    await expect(
      runtime.launch(adapter.adapterId, {
        taskId: "work:test",
        input: "test",
        cwd: "/workspace",
      }),
    ).rejects.toMatchObject({ code: "adapter-unavailable" });
    await expect(
      runtime.resume(adapter.adapterId, {
        taskId: "work:other",
        input: "test",
        cwd: "/workspace",
        identity: session,
        checkpoint: {
          kind: "checkpoint",
          checkpointId: "checkpoint:one",
          createdAt: "2026-09-26T08:01:00.000Z",
          reason: "test",
          state: {},
        },
      }),
    ).rejects.toMatchObject({ code: "identity-mismatch" });
  });

  it("rejects an adapter that changes session identity", async () => {
    const worker = testAdapter();
    worker.launch = vi.fn().mockImplementation(async (_request, identity) => ({
      identity: { ...identity, sessionId: "session:changed" },
      checkpoint: vi.fn(),
      quota: vi.fn(),
      cost: vi.fn(),
      stop: vi.fn(),
      signals: () => [],
    }));
    const runtime = new WorkerAdapterRuntime({
      adapters: [worker],
      allowlist: new AuthenticationAllowlist([authenticationEntry]),
      createSessionId: () => "session:stable",
    });

    await expect(
      runtime.launch(adapter.adapterId, {
        taskId: "work:test",
        input: "test",
        cwd: "/workspace",
      }),
    ).rejects.toBeInstanceOf(AdapterRuntimeError);
  });
});

describe("authentication allowlist", () => {
  it("looks up entries and rejects duplicates or unknown disables", () => {
    const allowlist = new AuthenticationAllowlist([authenticationEntry]);
    expect(allowlist.get(authenticationEntry.authenticationPathId)).toEqual(
      authenticationEntry,
    );
    expect(
      () => new AuthenticationAllowlist([authenticationEntry, authenticationEntry]),
    ).toThrow("Duplicate authentication path");
    expect(() =>
      allowlist.disable(
        "auth:missing",
        "2026-09-26T09:00:00.000Z",
        "Missing route",
      ),
    ).toThrow(AuthenticationNotAllowedError);
  });

  it("requires disable metadata only for disabled entries", () => {
    expect(
      AuthenticationAllowlistEntrySchema.safeParse({
        ...authenticationEntry,
        disabledAt: "2026-09-26T09:00:00.000Z",
        disabledReason: "Contradiction",
      }).success,
    ).toBe(false);
    expect(
      AuthenticationAllowlistEntrySchema.safeParse({
        ...authenticationEntry,
        enabled: false,
      }).success,
    ).toBe(false);
  });
});
