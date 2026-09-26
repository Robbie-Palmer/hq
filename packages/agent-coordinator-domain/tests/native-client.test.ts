import { describe, expect, it, vi } from "vitest";

import {
  AuthenticationAllowlist,
  claudeCodeNativeClientDefinition,
  codexNativeClientDefinition,
  createNativeClientAdapter,
  createNodeNativeProcessLauncher,
  redactAdapterText,
  WorkerAdapterRuntime,
  type NativeProcessHandle,
  type NativeProcessLauncher,
  type NativeProcessRequest,
} from "../src";
import { authenticationEntry } from "./fixtures";

function launcherFixture(result = { exitCode: 0, stdout: "ok", stderr: "" }) {
  const requests: NativeProcessRequest[] = [];
  const handle: NativeProcessHandle = {
    processId: 42,
    completion: Promise.resolve(result),
    stop: vi.fn().mockResolvedValue(undefined),
    checkpoint: vi.fn().mockResolvedValue({ threadId: "thread:one" }),
    quota: vi.fn().mockResolvedValue({
      state: "exhausted",
      remaining: 0,
      unit: "requests",
    }),
  };
  const launcher: NativeProcessLauncher = {
    isAvailable: vi.fn().mockResolvedValue(true),
    launch: vi.fn().mockImplementation(async (request) => {
      requests.push(request);
      return handle;
    }),
  };
  return { handle, launcher, requests };
}

describe("native client adapters", () => {
  it.each([
    ["Codex", codexNativeClientDefinition],
    ["Claude Code", claudeCodeNativeClientDefinition],
  ])("launches the unmodified %s client without credential environment variables", async (_name, definitionFactory) => {
    const fixture = launcherFixture();
    const definition = definitionFactory(
      "actor:owner-agent",
      authenticationEntry.authenticationPathId,
    );
    const runtime = new WorkerAdapterRuntime({
      allowlist: new AuthenticationAllowlist([authenticationEntry]),
      adapters: [
        createNativeClientAdapter({
          definition,
          launcher: fixture.launcher,
          environment: {
            HOME: "/Users/owner",
            PATH: "/usr/bin",
            OPENAI_API_KEY: "sk-do-not-export",
            PROVIDER_SESSION_TOKEN: "token-do-not-export",
          },
          createCheckpointId: () => "checkpoint:one",
        }),
      ],
      createSessionId: () => "session:native",
    });

    const session = await runtime.launch(definition.identity.adapterId, {
      taskId: "work:native",
      input: "Implement the task",
      cwd: "/workspace",
    });

    expect(fixture.requests).toHaveLength(1);
    expect(fixture.requests[0]?.executable).toBe(definition.executable);
    expect(fixture.requests[0]?.environment).toEqual({
      HOME: "/Users/owner",
      PATH: "/usr/bin",
    });
    expect(await session.quota()).toMatchObject({
      kind: "quota",
      state: "exhausted",
      remaining: 0,
    });
  });

  it("redacts credentials from adapter failures and checkpoints", async () => {
    expect(
      redactAdapterText(
        [
          "Authorization: Bearer abc123",
          `${["api", "key"].join("_")}=not-a-real-credential`,
        ].join(" and "),
      ),
    ).not.toContain("abc123");

    const fixture = launcherFixture({
      exitCode: 1,
      stdout: "",
      stderr: "request failed with Bearer private-token-value",
    });
    fixture.handle.checkpoint = vi.fn().mockResolvedValue({
      threadId: "thread:one",
      accessToken: "secret-token-value",
      nested: { password: "do-not-persist" },
    });
    const definition = codexNativeClientDefinition(
      "actor:owner-agent",
      authenticationEntry.authenticationPathId,
    );
    const adapter = createNativeClientAdapter({
      definition,
      launcher: fixture.launcher,
      createCheckpointId: () => "checkpoint:one",
    });
    const identity = {
      schemaVersion: 1 as const,
      recordType: "execution-session" as const,
      sessionId: "session:native",
      taskId: "work:native",
      actorId: definition.identity.actorId,
      adapterId: definition.identity.adapterId,
      adapterVersion: definition.identity.adapterVersion,
      authenticationPathId: definition.identity.authenticationPathId,
      startedAt: "2026-09-26T08:00:00.000Z",
    };
    const active = await adapter.launch(
      { taskId: identity.taskId, input: "test", cwd: "/workspace" },
      identity,
    );
    const checkpoint = await active.checkpoint("save before limit");
    await fixture.handle.completion;
    await Promise.resolve();

    expect(checkpoint.state.accessToken).toBe("[REDACTED]");
    expect(checkpoint.state.nested).toEqual({ password: "[REDACTED]" });
    expect(JSON.stringify(active.signals())).not.toContain("private-token-value");
  });

  it("runs a native process and extracts a resumable session marker", async () => {
    const launcher = createNodeNativeProcessLauncher({
      maximumOutputBytes: 10_000,
    });
    const handle = await launcher.launch({
      executable: process.execPath,
      arguments: [
        "-e",
        'process.stdout.write(JSON.stringify({ thread_id: "thread:from-client" }))',
      ],
      cwd: process.cwd(),
      environment: nativeClientEnvironmentForTest(),
    });

    expect(await handle.completion).toMatchObject({ exitCode: 0 });
    expect(await handle.checkpoint?.()).toEqual({
      threadId: "thread:from-client",
    });
  });

  it("reports an unavailable executable before launch", async () => {
    const fixture = launcherFixture();
    vi.mocked(fixture.launcher.isAvailable).mockResolvedValue(false);
    const definition = codexNativeClientDefinition(
      "actor:owner-agent",
      authenticationEntry.authenticationPathId,
    );
    const runtime = new WorkerAdapterRuntime({
      allowlist: new AuthenticationAllowlist([authenticationEntry]),
      adapters: [
        createNativeClientAdapter({
          definition,
          launcher: fixture.launcher,
        }),
      ],
      createSessionId: () => "session:native",
    });

    await expect(
      runtime.launch(definition.identity.adapterId, {
        taskId: "work:native",
        input: "test",
        cwd: "/workspace",
      }),
    ).rejects.toMatchObject({ code: "adapter-unavailable" });
    expect(fixture.launcher.launch).not.toHaveBeenCalled();
  });
});

function nativeClientEnvironmentForTest(): NodeJS.ProcessEnv {
  return {
    HOME: process.env.HOME,
    PATH: process.env.PATH,
  };
}
