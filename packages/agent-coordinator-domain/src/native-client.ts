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
import type {
  ExecutionSessionIdentity,
  WorkerAdapterIdentity,
} from "./session";

const SAFE_ENVIRONMENT_NAMES = new Set([
  "COLORTERM",
  "HOME",
  "LANG",
  "LC_ALL",
  "LOGNAME",
  "NO_COLOR",
  "PATH",
  "SHELL",
  "TERM",
  "TMPDIR",
  "USER",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
]);

const REDACTION_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bBearer\s+[^\s"']+/giu, "Bearer [REDACTED]"],
  [/\b(?:sk|key|token|secret)-[a-z\d_-]{8,}\b/giu, "[REDACTED]"],
  [
    /(["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)["']?\s*[:=]\s*["']?)[^\s,"'}]+/giu,
    "$1[REDACTED]",
  ],
];

export function nativeClientEnvironment(
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(environment).filter(
      ([name, value]) => SAFE_ENVIRONMENT_NAMES.has(name) && value !== undefined,
    ),
  );
}

export function redactAdapterText(value: string): string {
  return REDACTION_PATTERNS.reduce(
    (redacted, [pattern, replacement]) =>
      redacted.replace(pattern, replacement),
    value,
  );
}

export interface NativeProcessRequest {
  executable: string;
  arguments: readonly string[];
  cwd: string;
  environment: NodeJS.ProcessEnv;
}

export interface NativeProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface NativeProcessHandle {
  readonly processId?: number;
  readonly completion: Promise<NativeProcessResult>;
  stop(): Promise<void>;
  checkpoint?(): Promise<Readonly<Record<string, unknown>>>;
  quota?(): Promise<Omit<QuotaSignal, "kind" | "observedAt">>;
}

export interface NativeProcessLauncher {
  isAvailable(executable: string): Promise<boolean>;
  launch(request: NativeProcessRequest): Promise<NativeProcessHandle>;
}

export interface NativeClientDefinition {
  identity: WorkerAdapterIdentity;
  providerId: string;
  executable: string;
  launchArguments(input: string): readonly string[];
  resumeArguments(
    input: string,
    checkpoint: CheckpointSignal,
  ): readonly string[];
}

export interface NativeClientAdapterOptions {
  definition: NativeClientDefinition;
  launcher: NativeProcessLauncher;
  environment?: NodeJS.ProcessEnv;
  now?: () => Date;
  createCheckpointId?: () => string;
}

function appendBounded(current: string, chunk: Buffer, maximumBytes: number): string {
  if (Buffer.byteLength(current) >= maximumBytes) return current;
  return (current + chunk.toString("utf8")).slice(0, maximumBytes);
}

function findSessionState(output: string): Readonly<Record<string, unknown>> {
  const state: Record<string, unknown> = {};
  for (const line of output.split("\n")) {
    try {
      const value = JSON.parse(line) as Record<string, unknown>;
      const threadId = value.thread_id ?? value.threadId;
      const sessionId = value.session_id ?? value.sessionId;
      if (typeof threadId === "string") state.threadId = threadId;
      if (typeof sessionId === "string") state.sessionId = sessionId;
    } catch {
      // Native clients may mix human-readable diagnostics with JSON events.
    }
  }
  return state;
}

async function executableExists(
  executable: string,
  pathValue: string | undefined,
): Promise<boolean> {
  const candidates =
    isAbsolute(executable) || executable.includes("/")
      ? [executable]
      : (pathValue ?? "").split(delimiter).map((part) => join(part, executable));
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return true;
    } catch {
      // Try the next PATH entry.
    }
  }
  return false;
}

export function createNodeNativeProcessLauncher(options?: {
  maximumOutputBytes?: number;
  path?: string;
}): NativeProcessLauncher {
  const maximumOutputBytes = options?.maximumOutputBytes ?? 1_000_000;
  return {
    isAvailable(executable) {
      return executableExists(executable, options?.path ?? process.env.PATH);
    },
    async launch(request) {
      let stdout = "";
      let stderr = "";
      const child = spawn(request.executable, [...request.arguments], {
        cwd: request.cwd,
        env: request.environment,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout.on("data", (chunk: Buffer) => {
        stdout = appendBounded(stdout, chunk, maximumOutputBytes);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = appendBounded(stderr, chunk, maximumOutputBytes);
      });
      const completion = new Promise<NativeProcessResult>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (exitCode) => {
          resolve({
            exitCode: exitCode ?? 1,
            stdout: redactAdapterText(stdout),
            stderr: redactAdapterText(stderr),
          });
        });
      });
      return {
        processId: child.pid,
        completion,
        async stop() {
          child.kill("SIGTERM");
        },
        async checkpoint() {
          return findSessionState(stdout);
        },
        async quota() {
          const combined = `${stdout}\n${stderr}`;
          return /(?:rate|usage) limit|quota (?:exhausted|exceeded)/iu.test(
            combined,
          )
            ? { state: "exhausted" as const }
            : { state: "unknown" as const };
        },
      };
    },
  };
}

class NativeAdapterSession implements AdapterSession {
  readonly #events: WorkerSignal[] = [];
  readonly #handle: NativeProcessHandle;
  readonly #now: () => Date;
  readonly #createCheckpointId: () => string;
  readonly #routeId: string;
  readonly #providerId: string;

  constructor(
    readonly identity: ExecutionSessionIdentity,
    handle: NativeProcessHandle,
    options: {
      now: () => Date;
      createCheckpointId: () => string;
      routeId: string;
      providerId: string;
    },
  ) {
    this.#handle = handle;
    this.#now = options.now;
    this.#createCheckpointId = options.createCheckpointId;
    this.#routeId = options.routeId;
    this.#providerId = options.providerId;
    void this.#observeCompletion();
  }

  async checkpoint(reason: string): Promise<CheckpointSignal> {
    const rawState = (await this.#handle.checkpoint?.()) ?? {
      processId: this.#handle.processId,
    };
    const signal: CheckpointSignal = {
      kind: "checkpoint",
      checkpointId: this.#createCheckpointId(),
      createdAt: this.#now().toISOString(),
      reason,
      state: redactRecord(rawState),
    };
    this.#events.push(signal);
    return signal;
  }

  async quota(): Promise<QuotaSignal> {
    const observed = (await this.#handle.quota?.()) ?? { state: "unknown" };
    const signal: QuotaSignal = {
      kind: "quota",
      ...observed,
      observedAt: this.#now().toISOString(),
    };
    this.#events.push(signal);
    return signal;
  }

  async cost(): Promise<CostReport> {
    const report: CostReport = {
      kind: "cost",
      funding: "prepaid",
      currency: "USD",
      amount: 0,
      routeId: this.#routeId,
      providerId: this.#providerId,
    };
    this.#events.push(report);
    return report;
  }

  async stop(reason: string): Promise<void> {
    await this.#handle.stop();
    this.#events.push({
      kind: "stopped",
      reason: redactAdapterText(reason),
      stoppedAt: this.#now().toISOString(),
    });
  }

  signals(): readonly WorkerSignal[] {
    return this.#events;
  }

  async #observeCompletion(): Promise<void> {
    try {
      const result = await this.#handle.completion;
      if (result.exitCode !== 0) {
        this.#events.push({
          kind: "failure",
          message: redactAdapterText(
            result.stderr || `Native client exited with ${result.exitCode}`,
          ),
          failedAt: this.#now().toISOString(),
        });
      }
    } catch (error) {
      this.#events.push({
        kind: "failure",
        message: redactAdapterText(
          error instanceof Error ? error.message : "Native client failed",
        ),
        failedAt: this.#now().toISOString(),
      });
    }
  }
}

function redactRecord(
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      if (/key|token|secret|password|authorization|cookie/iu.test(key)) {
        return [key, "[REDACTED]"];
      }
      return [key, redactValue(item)];
    }),
  );
}

function redactValue(value: unknown): unknown {
  if (typeof value === "string") return redactAdapterText(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === "object") {
    return redactRecord(value as Readonly<Record<string, unknown>>);
  }
  return value;
}

export function createNativeClientAdapter(
  options: NativeClientAdapterOptions,
): WorkerAdapter {
  const now = options.now ?? (() => new Date());
  const createCheckpointId =
    options.createCheckpointId ?? (() => crypto.randomUUID());

  const start = async (
    request: WorkerLaunchRequest,
    identity: ExecutionSessionIdentity,
    arguments_: readonly string[],
  ): Promise<AdapterSession> => {
    const handle = await options.launcher.launch({
      executable: options.definition.executable,
      arguments: arguments_,
      cwd: request.cwd,
      environment: nativeClientEnvironment(options.environment ?? process.env),
    });
    return new NativeAdapterSession(identity, handle, {
      now,
      createCheckpointId,
      routeId: options.definition.identity.authenticationPathId,
      providerId: options.definition.providerId,
    });
  };

  return {
    identity: options.definition.identity,
    async discoverAvailability(): Promise<AdapterAvailability> {
      const available = await options.launcher.isAvailable(
        options.definition.executable,
      );
      return available
        ? { state: "available", observedAt: now().toISOString() }
        : {
            state: "unavailable",
            observedAt: now().toISOString(),
            reason: `${options.definition.executable} is not installed`,
          };
    },
    launch(request, identity) {
      return start(
        request,
        identity,
        options.definition.launchArguments(request.input),
      );
    },
    resume(request: WorkerResumeRequest) {
      return start(
        request,
        request.identity,
        options.definition.resumeArguments(request.input, request.checkpoint),
      );
    },
  };
}

function nativeIdentity(
  adapterId: string,
  actorId: string,
  authenticationPathId: string,
): WorkerAdapterIdentity {
  return {
    schemaVersion: 1,
    recordType: "worker-adapter",
    adapterId,
    adapterVersion: "1.0.0",
    actorId,
    adapterKind: "native-client",
    authenticationPathId,
    tools: ["filesystem", "git", "shell", "work-graph"],
    evidenceKinds: ["checkpoint", "test-results"],
    supportsCheckpointing: true,
  };
}

export function codexNativeClientDefinition(
  actorId: string,
  authenticationPathId: string,
): NativeClientDefinition {
  return {
    identity: nativeIdentity(
      "adapter:codex-native-client",
      actorId,
      authenticationPathId,
    ),
    providerId: "provider:openai",
    executable: "codex",
    launchArguments: (input) => ["exec", "--json", input],
    resumeArguments: (input, checkpoint) => {
      const threadId = checkpoint.state.threadId;
      if (typeof threadId !== "string") {
        throw new Error("Codex checkpoint does not contain a threadId");
      }
      return ["exec", "resume", threadId, input];
    },
  };
}

export function claudeCodeNativeClientDefinition(
  actorId: string,
  authenticationPathId: string,
): NativeClientDefinition {
  return {
    identity: nativeIdentity(
      "adapter:claude-code-native-client",
      actorId,
      authenticationPathId,
    ),
    providerId: "provider:anthropic",
    executable: "claude",
    launchArguments: (input) => [
      "--print",
      "--output-format",
      "stream-json",
      input,
    ],
    resumeArguments: (input, checkpoint) => {
      const sessionId = checkpoint.state.sessionId;
      if (typeof sessionId !== "string") {
        throw new Error("Claude Code checkpoint does not contain a sessionId");
      }
      return [
        "--resume",
        sessionId,
        "--print",
        "--output-format",
        "stream-json",
        input,
      ];
    },
  };
}
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import { spawn } from "node:child_process";
