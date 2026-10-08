#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

import { z } from "zod";

import {
  AuthenticationAllowlist,
  type AdvisoryDecision,
  AdvisoryDecisionSchema,
  type AdvisoryMatchingInput,
  AdvisoryMatchingInputSchema,
  confirmAdvisoryDecision,
  type CoordinatedSession,
  createAdvisoryDecision,
  createNativeClientAdapter,
  createNodeNativeProcessLauncher,
  codexNativeClientDefinition,
  DurableSessionCheckpointSchema,
  redactAdapterText,
  SessionOrchestrator,
  type TaskRequirements,
  WorkerAdapterRuntime,
  WorkGraphCoordinator,
  type WorkGraphClientPort,
} from "../packages/agent-coordinator-domain/src/index";

const DEFAULT_CONFIG = ".agent-coordinator/config.json";
const DEFAULT_PROPOSAL = ".agent-coordinator/proposal.json";
const WORK_CLASS = "software-delivery";
const COMPLEXITY_SCALE = {
  schemaVersion: 1 as const,
  recordType: "complexity-scale" as const,
  scaleId: "personal-work",
  revision: 1,
  levels: [
    { levelId: "bounded", rank: 1, definition: "A bounded repository task." },
    { levelId: "deep", rank: 2, definition: "A task needing extended reasoning." },
  ],
};

const ProfileSchema = z.object({
  label: z.string().trim().min(1).regex(/^[a-z0-9-]+$/u),
  codexHome: z.string().trim().min(1),
  actorId: z.string().trim().min(1).regex(/^[a-z0-9][a-z0-9._:/-]*$/u),
});

const ConfigSchema = z.object({
  schemaVersion: z.literal(1),
  profiles: z.array(ProfileSchema).min(1),
  workingDirectory: z.string().trim().min(1).default("."),
  readyLimit: z.number().int().min(1).max(20).default(10),
  proposalTtlSeconds: z.number().int().min(60).max(3600).default(300),
  leaseDurationSeconds: z.number().int().min(300).max(86_400).default(1800),
  capacityPreflight: z.boolean().default(true),
});
type Config = z.infer<typeof ConfigSchema>;
type Profile = z.infer<typeof ProfileSchema>;

const StoredProposalSchema = z.object({
  schemaVersion: z.literal(1),
  selectedProfile: z.string(),
  input: AdvisoryMatchingInputSchema,
  decision: AdvisoryDecisionSchema,
});

interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const expandHome = (path: string): string =>
  path === "~" || path.startsWith("~/")
    ? resolve(homedir(), path.slice(2))
    : resolve(path);

const runProcess = (
  executable: string,
  arguments_: readonly string[],
  options: { cwd: string; environment?: NodeJS.ProcessEnv },
): Promise<ProcessResult> =>
  new Promise((resolveResult, reject) => {
    const child = spawn(executable, [...arguments_], {
      cwd: options.cwd,
      env: options.environment ?? process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", reject);
    child.once("close", (exitCode) => {
      resolveResult({
        exitCode: exitCode ?? 1,
        stdout: redactAdapterText(stdout),
        stderr: redactAdapterText(stderr),
      });
    });
  });

class WorkGraphCommandClient implements WorkGraphClientPort {
  readonly #cwd: string;

  constructor(cwd: string) {
    this.#cwd = cwd;
  }

  async #run(arguments_: readonly string[]): Promise<unknown> {
    const result = await runProcess("work-graph", arguments_, { cwd: this.#cwd });
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || `work-graph exited with ${result.exitCode}`);
    }
    return JSON.parse(result.stdout) as unknown;
  }

  async latestCheckpoint(workItemId: string): Promise<z.infer<typeof DurableSessionCheckpointSchema>> {
    const response = z.object({
      items: z.array(z.object({ content: z.string(), createdAt: z.string() })),
    }).parse(await this.#run(["metadata", "notes", workItemId, "--limit", "99"]));
    const notes = response.items.toSorted((left, right) =>
      right.createdAt.localeCompare(left.createdAt),
    );
    for (const note of notes) {
      try {
        const checkpoint = DurableSessionCheckpointSchema.safeParse(
          JSON.parse(note.content) as unknown,
        );
        if (checkpoint.success) return checkpoint.data;
      } catch {
        // Ordinary progress notes are not session checkpoints.
      }
    }
    throw new Error(`No durable session checkpoint exists for ${workItemId}.`);
  }

  listWorkItems(query: {
    stage: "ready";
    initiativeId?: string;
    projectId?: string;
    parentId?: string;
    limit: number;
    cursor?: string;
  }): Promise<unknown> {
    return this.#run([
      "ready",
      "--limit",
      String(query.limit),
      ...(query.cursor ? ["--cursor", query.cursor] : []),
      ...(query.initiativeId ? ["--initiative", query.initiativeId] : []),
      ...(query.projectId ? ["--project", query.projectId] : []),
      ...(query.parentId ? ["--parent-id", query.parentId] : []),
    ]);
  }

  getWorkItem(workItemId: string): Promise<unknown> {
    return this.#run(["show", workItemId]);
  }

  listWorkItemContexts(workItemId: string): Promise<unknown> {
    return this.#run(["context", "show", workItemId]);
  }

  listWorkItemDependencies(workItemId: string, query: { limit: number; cursor?: string }): Promise<unknown> {
    return this.#run([
      "metadata",
      "dependencies",
      workItemId,
      "--limit",
      String(query.limit),
      ...(query.cursor ? ["--cursor", query.cursor] : []),
    ]);
  }

  listWorkItemNotes(workItemId: string, query: { limit: number; cursor?: string }): Promise<unknown> {
    return this.#run([
      "metadata",
      "notes",
      workItemId,
      "--limit",
      String(query.limit),
      ...(query.cursor ? ["--cursor", query.cursor] : []),
    ]);
  }

  listWorkItemLeases(workItemId: string, query: { limit: number; afterEpoch?: number }): Promise<unknown> {
    return this.#run([
      "metadata",
      "leases",
      workItemId,
      "--limit",
      String(query.limit),
      ...(query.afterEpoch ? ["--after-epoch", String(query.afterEpoch)] : []),
    ]);
  }

  claim(body: { workerId: string; leaseDurationSeconds: number; workItemId: string }): Promise<unknown> {
    return this.#run([
      "claim",
      body.workItemId,
      "--worker-id",
      body.workerId,
      "--lease-duration-seconds",
      String(body.leaseDurationSeconds),
    ]);
  }

  renew(leaseId: string, body: { epoch: number; leaseDurationSeconds: number }): Promise<unknown> {
    return this.#run([
      "renew",
      leaseId,
      "--epoch",
      String(body.epoch),
      "--lease-duration-seconds",
      String(body.leaseDurationSeconds),
    ]);
  }

  createNote(
    workItemId: string,
    body: { id: string; leaseId: string; epoch: number; content: string },
    idempotencyKey?: string,
  ): Promise<unknown> {
    return this.#run([
      "note",
      workItemId,
      "--id",
      body.id,
      "--lease-id",
      body.leaseId,
      "--epoch",
      String(body.epoch),
      "--content",
      body.content,
      ...(idempotencyKey ? ["--idempotency-key", idempotencyKey] : []),
    ]);
  }

  release(
    workItemId: string,
    body: { leaseId: string; epoch: number; mergeEvidence: string; deploymentEvidence: string },
  ): Promise<unknown> {
    return this.#run([
      "release",
      workItemId,
      "--lease-id",
      body.leaseId,
      "--epoch",
      String(body.epoch),
      "--merge-evidence",
      body.mergeEvidence,
      "--deployment-evidence",
      body.deploymentEvidence,
    ]);
  }
}

const profileEnvironment = (profile: Profile, workerId?: string): NodeJS.ProcessEnv => ({
  ...process.env,
  CODEX_HOME: expandHome(profile.codexHome),
  ...(workerId ? { WORK_GRAPH_WORKER_ID: workerId } : {}),
});

export async function preflightProfile(
  profile: Profile,
  cwd: string,
  capacityPreflight: boolean,
  execute = runProcess,
): Promise<void> {
  const environment = profileEnvironment(profile);
  const login = await execute("codex", ["login", "status"], { cwd, environment });
  if (login.exitCode !== 0) {
    throw new Error(`Codex profile ${profile.label} is not authenticated: ${login.stderr || login.stdout}`);
  }
  if (!capacityPreflight) return;
  const capacity = await execute(
    "codex",
    [
      "exec",
      "--ephemeral",
      "--json",
      "--sandbox",
      "read-only",
      "--skip-git-repo-check",
      "Reply with exactly READY and do not use tools.",
    ],
    { cwd, environment },
  );
  if (capacity.exitCode !== 0) {
    throw new Error(`Codex profile ${profile.label} has no usable capacity: ${capacity.stderr || capacity.stdout}`);
  }
}

const requirementsFor = (workItemId: string, text: string): TaskRequirements => ({
  schemaVersion: 1,
  recordType: "task-requirements",
  taskId: workItemId,
  workClass: WORK_CLASS,
  complexity: {
    scaleId: COMPLEXITY_SCALE.scaleId,
    scaleRevision: COMPLEXITY_SCALE.revision,
    levelId: /architecture|research|reason|investigat|design/iu.test(text) ? "deep" : "bounded",
  },
  tags: [],
  requiredCapabilities: [
    { capability: "software-delivery", minimumLevel: 3, requiresObservedEvidence: false },
  ],
  requiredAuthority: ["repository-write"],
  requiredAccess: ["repository"],
  requiredTools: ["filesystem", "git", "shell", "work-graph"],
  preferredTools: [],
  requiredEvidence: [
    { kind: "checkpoint", stage: "checkpoint" },
    { kind: "test-results", stage: "completion" },
  ],
  requiredResources: [],
});

const revisionOf = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

export async function buildMatchingInput(
  graph: WorkGraphCoordinator,
  profile: Profile,
  config: Config,
  now = new Date(),
): Promise<AdvisoryMatchingInput> {
  const ready = await graph.listReadyCandidates({}, { limit: config.readyLimit });
  const candidates = await Promise.all(
    ready.items.map(async (workItem) => {
      const requirements = await graph.readRequirements(workItem.id);
      const contextSummary = `${requirements.brief.content}\n\nAcceptance criteria:\n${requirements.acceptanceCriteria.content}`;
      return {
        workItem,
        task: requirementsFor(workItem.id, `${workItem.title}\n${contextSummary}`),
        contextSummary: contextSummary.slice(0, 4_000),
        expectedValue: {
          value: workItem.priority.effectiveExpedited ? 2 : 1,
          basis: "Work Graph readiness and priority",
          observedAt: now.toISOString(),
        },
      };
    }),
  );
  const authenticationPathId = `auth:openai-chatgpt:${profile.label}`;
  const actorId = profile.actorId;
  const adapter = codexNativeClientDefinition(actorId, authenticationPathId).identity;
  const validUntil = new Date(now.getTime() + config.proposalTtlSeconds * 1_000).toISOString();
  const worker = {
    actor: {
      schemaVersion: 1 as const,
      recordType: "actor-profile" as const,
      actorId,
      actorKind: "user-directed-agent" as const,
      complexityLimits: [{ scaleId: COMPLEXITY_SCALE.scaleId, scaleRevision: 1, levelId: "deep" }],
      routingPreferences: { workClasses: [WORK_CLASS], tags: [] },
      tools: [...adapter.tools],
      grantedAuthority: ["repository-write"],
      access: ["repository"],
      declaredCapabilities: [{ capability: "software-delivery", level: 5 }],
      observedCapabilities: [],
      cost: { funding: "prepaid" as const, estimatedSessionCost: { currency: "USD", amount: 0 } },
      resourceAvailability: [],
    },
    adapter,
    activeSessions: 0,
    activeSessionsForActor: 0,
    activeSessionsByWorkClass: [{ workClass: WORK_CLASS, activeSessions: 0 }],
    handoffCost: { value: 0, basis: "Fresh explicit owner selection", observedAt: now.toISOString() },
  };
  const queueValue = candidates.map(({ workItem, task }) => ({ workItem, task }));
  return AdvisoryMatchingInputSchema.parse({
    queue: {
      revision: revisionOf(queueValue),
      observedAt: now.toISOString(),
      validUntil,
      items: candidates,
    },
    workerInventory: {
      revision: revisionOf({ profile: profile.label, actorId, adapter }),
      observedAt: now.toISOString(),
      workers: [worker],
    },
    complexityScales: [COMPLEXITY_SCALE],
    policy: {
      schemaVersion: 1,
      recordType: "owner-policy",
      policyId: "personal-codex-policy",
      ownerId: "owner:personal",
      revision: 1,
      allowedAuthenticationPaths: [authenticationPathId],
      allowedAuthority: ["repository-write"],
      allowedWorkClasses: [WORK_CLASS],
      budgets: [{
        workClass: WORK_CLASS,
        maximumPerSession: { currency: "USD", amount: 0 },
        remaining: { currency: "USD", amount: 0 },
      }],
      concurrency: {
        maximumActiveSessions: 1,
        maximumActiveSessionsPerActor: 1,
        workClasses: [{ workClass: WORK_CLASS, maximumActiveSessions: 1 }],
      },
    },
    settings: { minimumExpectedValue: 0, leaseDurationSeconds: config.leaseDurationSeconds, rankingCurrency: "USD" },
  });
}

const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, "utf8")) as unknown;

const loadConfig = async (path: string): Promise<Config> => ConfigSchema.parse(await readJson(path));

const selectProfile = (config: Config, label: string): Profile => {
  const profile = config.profiles.find((candidate) => candidate.label === label);
  if (!profile) throw new Error(`Unknown profile ${label}. Configured profiles: ${config.profiles.map(({ label: value }) => value).join(", ")}`);
  return profile;
};

const writeJson = async (path: string, value: unknown): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
};

const parseArguments = (arguments_: string[]) => {
  const command = arguments_[0];
  const value = (name: string): string | undefined => {
    const index = arguments_.indexOf(name);
    return index === -1 ? undefined : arguments_[index + 1];
  };
  return {
    command,
    configPath: resolve(value("--config") ?? DEFAULT_CONFIG),
    proposalPath: resolve(value("--proposal") ?? DEFAULT_PROPOSAL),
    profileLabel: value("--profile"),
    ticketId: value("--ticket"),
  };
};

const proposalSummary = (decision: AdvisoryDecision, profile: Profile): unknown =>
  decision.status === "suggested"
    ? {
        status: decision.status,
        profile: profile.label,
        ticket: decision.proposal.task,
        claimEffect: decision.proposal.claimEffect,
        scoreInputs: decision.proposal.scoreInputs,
        exclusions: decision.exclusions,
      }
    : { status: decision.status, reason: decision.reason, profile: profile.label, exclusions: decision.exclusions };

const workerPrompt = (context: unknown): string => `Execute the claimed Work Graph ticket described by this bounded context package. Follow the repository AGENTS.md. Keep the lease alive, record durable progress notes, verify the result, and only release after the required merge and deployment evidence exists.\n\n${JSON.stringify(context, null, 2)}`;

const waitForWorker = async (
  orchestrator: SessionOrchestrator,
  session: CoordinatedSession,
): Promise<ProcessResult | undefined> => {
  let shutdown: Promise<unknown> | undefined;
  const handleShutdown = () => {
    shutdown ??= orchestrator.checkpoint(session, {
      completedWork: [],
      remainingWork: ["Resume this ticket with an explicitly selected Codex profile."],
      evidence: [],
      artifacts: [],
      stopReason: "shutdown",
      stopWorker: true,
    });
  };
  process.once("SIGINT", handleShutdown);
  process.once("SIGTERM", handleShutdown);
  try {
    const result = await session.worker.completion?.();
    await shutdown;
    if (shutdown) {
      throw new Error("Codex was stopped; a durable Work Graph shutdown checkpoint was written.");
    }
    return result;
  } finally {
    process.off("SIGINT", handleShutdown);
    process.off("SIGTERM", handleShutdown);
  }
};

const initialise = async (configPath: string): Promise<void> => {
  await writeJson(configPath, {
    schemaVersion: 1,
    profiles: [{ label: "primary", codexHome: process.env.CODEX_HOME ?? "~/.codex", actorId: "codex:primary" }],
    workingDirectory: ".",
    readyLimit: 10,
    proposalTtlSeconds: 300,
    leaseDurationSeconds: 1800,
    capacityPreflight: true,
  });
  console.log(`Wrote ${configPath}. Add one separately authenticated CODEX_HOME per subscription.`);
};

const createCodexOrchestrator = (
  graph: WorkGraphCoordinator,
  profile: Profile,
): {
  definition: ReturnType<typeof codexNativeClientDefinition>;
  orchestrator: SessionOrchestrator;
} => {
  const authenticationPathId = `auth:openai-chatgpt:${profile.label}`;
  const definition = codexNativeClientDefinition(profile.actorId, authenticationPathId);
  const adapter = createNativeClientAdapter({
    definition,
    launcher: createNodeNativeProcessLauncher(),
    environment: profileEnvironment(profile, profile.actorId),
  });
  const runtime = new WorkerAdapterRuntime({
    allowlist: new AuthenticationAllowlist([{
      schemaVersion: 1,
      recordType: "authentication-allowlist-entry",
      authenticationPathId,
      providerId: "provider:openai",
      routeKind: "native-client",
      accountClass: "chatgpt-subscription",
      approvalBasis: {
        kind: "provider-documentation",
        referenceUrl: "https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server",
        reviewedAt: new Date().toISOString(),
      },
      enabled: true,
    }]),
    adapters: [adapter],
    createSessionId: randomUUID,
  });
  return { definition, orchestrator: new SessionOrchestrator(graph, runtime) };
};

const propose = async (
  config: Config,
  profile: Profile,
  cwd: string,
  graph: WorkGraphCoordinator,
  proposalPath: string,
): Promise<void> => {
  await preflightProfile(profile, cwd, config.capacityPreflight);
  const input = await buildMatchingInput(graph, profile, config);
  const decision = createAdvisoryDecision(input);
  await writeJson(proposalPath, { schemaVersion: 1, selectedProfile: profile.label, input, decision });
  console.log(JSON.stringify(proposalSummary(decision, profile), null, 2));
  console.log(`No Work Graph mutation was made. Confirm with: mise //:agent-coordinator -- confirm --profile ${profile.label}`);
};

const confirm = async (
  config: Config,
  profile: Profile,
  cwd: string,
  graph: WorkGraphCoordinator,
  proposalPath: string,
): Promise<void> => {
  const stored = StoredProposalSchema.parse(await readJson(proposalPath));
  if (stored.selectedProfile !== profile.label) {
    throw new Error(`Proposal selected ${stored.selectedProfile}; rerun propose to use ${profile.label}.`);
  }
  const decision = stored.decision;
  if (decision.status !== "suggested") throw new Error("The stored decision has no claimable proposal.");
  await preflightProfile(profile, cwd, config.capacityPreflight);
  const freshInput = await buildMatchingInput(graph, profile, config);
  const { definition, orchestrator } = createCodexOrchestrator(graph, profile);
  const task = freshInput.queue.items.find(({ task: candidate }) => candidate.taskId === decision.proposal.task.id)?.task;
  if (!task) throw new Error("The proposed task is no longer ready.");
  const context = await graph.buildContextPackage(task);
  const session = await confirmAdvisoryDecision(decision, freshInput, {
    claim: (confirmedTask, claim) => orchestrator.start({
      task: confirmedTask,
      workerId: claim.workerId,
      adapterId: definition.identity.adapterId,
      policy: freshInput.policy,
      contextPackageVersion: "work-graph-v1",
      leaseDurationSeconds: claim.leaseDurationSeconds,
      launch: { cwd, input: workerPrompt(context) },
    }),
  });
  console.log(`Claimed ${session.binding.workItem.id} with profile ${profile.label}; Codex session ${session.binding.identity.sessionId} is running.`);
  const result = await waitForWorker(orchestrator, session);
  if (result && result.exitCode !== 0) {
    const quota = await session.worker.quota();
    const stopReason = quota.state === "exhausted" ? "quota-limit" : "client-failure";
    await orchestrator.checkpoint(session, {
      completedWork: [],
      remainingWork: ["Resume the claimed ticket with an explicitly selected Codex profile."],
      evidence: [],
      artifacts: [],
      stopReason,
    });
    throw new Error(`Codex stopped (${stopReason}); a durable Work Graph checkpoint was written. Automatic profile rollover is disabled.`);
  }
  console.log(`Codex exited successfully for ${session.binding.workItem.id}. Inspect Work Graph for delivery state and evidence.`);
};

const resume = async (
  config: Config,
  profile: Profile,
  cwd: string,
  graph: WorkGraphCoordinator,
  client: WorkGraphCommandClient,
  ticketId: string,
): Promise<void> => {
  await preflightProfile(profile, cwd, config.capacityPreflight);
  const checkpoint = await client.latestCheckpoint(ticketId);
  if (checkpoint.binding.identity.taskId !== ticketId) {
    throw new Error(`Checkpoint task ${checkpoint.binding.identity.taskId} does not match ${ticketId}.`);
  }
  const resolved = await graph.readRequirements(ticketId);
  const task = requirementsFor(ticketId, `${resolved.brief.content}\n${resolved.acceptanceCriteria.content}`);
  const context = await graph.buildContextPackage(task);
  const { definition, orchestrator } = createCodexOrchestrator(graph, profile);
  const selectedPath = definition.identity.authenticationPathId;
  const sameProfile = selectedPath === checkpoint.binding.identity.authenticationPathId;
  if (!sameProfile) {
    throw new Error(
      "Cross-profile resume after a limit is intentionally disabled. Select the profile that created the checkpoint.",
    );
  }
  const launch = { cwd, input: workerPrompt({ context, previousCheckpoint: checkpoint }) };
  const session = await orchestrator.resume(checkpoint, {
    task,
    workerId: profile.actorId,
    adapterId: definition.identity.adapterId,
    leaseDurationSeconds: config.leaseDurationSeconds,
    launch,
  });
  console.log(`Resumed ${ticketId} with explicitly selected profile ${profile.label}.`);
  const result = await waitForWorker(orchestrator, session);
  if (result && result.exitCode !== 0) {
    const quota = await session.worker.quota();
    await orchestrator.checkpoint(session, {
      ...checkpoint.progress,
      stopReason: quota.state === "exhausted" ? "quota-limit" : "client-failure",
    });
    throw new Error("Resumed Codex session failed; a new durable checkpoint was written.");
  }
};

async function main(): Promise<void> {
  const arguments_ = parseArguments(process.argv.slice(2));
  if (arguments_.command === "init") {
    await initialise(arguments_.configPath);
    return;
  }
  if (!arguments_.profileLabel) throw new Error("Pass --profile <label>; profile selection is always explicit.");
  const config = await loadConfig(arguments_.configPath);
  const profile = selectProfile(config, arguments_.profileLabel);
  const cwd = resolve(config.workingDirectory);
  const client = new WorkGraphCommandClient(cwd);
  const graph = new WorkGraphCoordinator(client);

  if (arguments_.command === "propose") {
    await propose(config, profile, cwd, graph, arguments_.proposalPath);
    return;
  }

  if (arguments_.command === "confirm") {
    await confirm(config, profile, cwd, graph, arguments_.proposalPath);
    return;
  }

  if (arguments_.command === "resume") {
    if (!arguments_.ticketId) throw new Error("Pass --ticket <id> when resuming.");
    await resume(config, profile, cwd, graph, client, arguments_.ticketId);
    return;
  }

  throw new Error("Usage: mise //:agent-coordinator -- <init|propose|confirm|resume> [--profile label] [--ticket id] [--config path] [--proposal path]");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await main();
  } catch (error: unknown) {
    console.error(redactAdapterText(error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  }
}
