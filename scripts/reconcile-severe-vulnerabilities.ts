import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  schemas,
  T3Client,
  threadId,
} from "@wyrd-company/t3code-client";
import {
  createControllerAuthorizer,
  createVulnerabilityIncidentId,
  decideVulnerabilityAdmission,
  decideVulnerabilityCorrelation,
  queryGithubVulnerability,
  VulnerabilityControllerPolicySchema,
  VulnerabilityIncidentLedger,
  type ControllerAuthorizer,
  type VulnerabilityControllerPolicy,
  type VulnerabilityCorrelationDecision,
  type VulnerabilityIncidentWorkGraphPort,
} from "agent-coordinator-domain";
import { GithubClient } from "github-client";
import { z } from "zod";

import {
  buildProviderTurnAttempts,
  refreshRoutingProviders,
  selectCodexProviders,
  startTurnWithProviderRecovery,
} from "./launch-work-graph-agent.js";
import { WorkGraphClient } from "../packages/work-graph-cli/src/client.js";
import { resolveClientConfig } from "../packages/work-graph-cli/src/config.js";

const POLICY_PROJECT = "agent-coordinator";
const CONTROLLER_ID = "controller:severe-vulnerability";
const WORKER_MODEL = "gpt-5.6-sol";
const INCIDENT_ID_PATTERN = /^github:repository:\d+:dependabot-alert:\d+$/;

const GithubAlertListItemSchema = z.looseObject({
  number: z.number().int().positive(),
  state: z.literal("open"),
  security_advisory: z.looseObject({
    severity: z.enum(["low", "moderate", "high", "critical"]),
  }),
});

const WorkItemPageSchema = z.looseObject({
  items: z.array(
    z.looseObject({
      id: z.string().min(1),
      stage: z.enum([
        "blocked",
        "ready",
        "in_progress",
        "stale",
        "needs_attention",
        "released",
        "cancelled",
      ]),
      currentLease: z
        .looseObject({
          expiresAt: z.iso.datetime(),
          endedAt: z.iso.datetime().nullable(),
        })
        .nullable(),
    }),
  ),
  nextCursor: z.string().nullable(),
});

const WorkItemNotePageSchema = z.looseObject({
  items: z.array(z.looseObject({ content: z.string() })),
  nextCursor: z.string().nullable(),
});

const IncidentTransitionNoteSchema = z.looseObject({
  recordType: z.literal("vulnerability-incident-event"),
  incidentId: z.string().min(1),
  transition: z.string().min(1),
});

export interface ReconcilerDependencies {
  authorizer: ControllerAuthorizer;
  github: GithubClient;
  launchWorker(decision: VulnerabilityCorrelationDecision): Promise<{
    threadId: string;
    url: string;
  }>;
  now(): Date;
  policy: VulnerabilityControllerPolicy;
  workGraph: WorkGraphClient;
}

function deterministicUuid(value: string): string {
  const bytes = createHash("sha256").update(value).digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function controllerReference(policy: VulnerabilityControllerPolicy) {
  return {
    kind: "service" as const,
    id: CONTROLLER_ID,
    version: `policy-${String(policy.revision)}-${policy.authorization.bundle.sha256.slice(0, 12)}`,
  };
}

function admissionSeverity(severity: string): "low" | "medium" | "high" | "critical" {
  if (severity === "moderate") return "medium";
  return z.enum(["low", "high", "critical"]).parse(severity);
}

export function workerRequired(decision: VulnerabilityCorrelationDecision): boolean {
  return (
    decision.decision.outcome === "repair" ||
    decision.decision.outcome === "replace" ||
    decision.decision.reason === "no-fix-available"
  );
}

export function vulnerabilityWorkerThreadId(incidentId: string): string {
  return threadId(deterministicUuid(`t3-worker:${incidentId}`));
}

export function vulnerabilityWorkerIdentity(incidentId: string): string {
  return `codex:${vulnerabilityWorkerThreadId(incidentId)}`;
}

export function buildVulnerabilityWorkerPrompt(
  decision: VulnerabilityCorrelationDecision,
): string {
  const selected = decision.decision.selectedPullRequest;
  const proposal = selected
    ? `Repair Renovate pull request #${String(selected.number)} when it remains the safest route.`
    : "Implement the smallest safe remediation because no usable Renovate pull request exists.";
  return [
    `Resolve Work Graph incident ${decision.incidentId}.`,
    `The current ${decision.alert.severity} Dependabot alert is #${String(decision.alert.number)} for ${decision.alert.package.name} in ${decision.repository.fullName}.`,
    proposal,
    "Claim only this incident and follow AGENTS.md plus docs/runbooks/agent-coordinator-hq-delivery.md.",
    "Complete the implementation, review loop, merge, deployment, production proof, and final alert recheck. Record exact evidence or request precise attention when policy or authority blocks a safe result.",
  ].join(" ");
}

async function listOpenAlertNumbers(
  github: GithubClient,
  repository: string,
  severities: readonly string[],
): Promise<number[]> {
  const page = await github.paginateByPageNumber<unknown>(
    `/repos/${repository.split("/").map(encodeURIComponent).join("/")}/dependabot/alerts`,
    { perPage: 100, maxPages: 10, query: { state: "open" } },
  );
  if (!page.complete) throw new Error(`Dependabot alert listing for ${repository} was incomplete`);
  const admitted = new Set(severities);
  return page.items
    .map((value) => GithubAlertListItemSchema.parse(value))
    .filter(({ security_advisory }) =>
      admitted.has(admissionSeverity(security_advisory.severity)),
    )
    .map(({ number }) => number)
    .toSorted((left, right) => left - right);
}

async function incidentTransitions(
  workGraph: WorkGraphClient,
  incidentId: string,
): Promise<Set<string>> {
  const transitions = new Set<string>();
  let cursor: string | undefined;
  for (let pageNumber = 0; pageNumber < 10; pageNumber += 1) {
    const page = WorkItemNotePageSchema.parse(
      await workGraph.listWorkItemNotes(incidentId, {
        limit: 100,
        ...(cursor === undefined ? {} : { cursor }),
      }),
    );
    for (const { content } of page.items) {
      try {
        const parsed = IncidentTransitionNoteSchema.parse(JSON.parse(content));
        if (parsed.incidentId === incidentId) {
          transitions.add(parsed.transition);
        }
      } catch {
        // Non-event notes are not part of the controller state machine.
      }
    }
    if (page.nextCursor === null) return transitions;
    cursor = page.nextCursor;
  }
  throw new Error(`Incident notes for ${incidentId} exceeded the page limit`);
}

function hasActiveWorkerLease(
  item: z.infer<typeof WorkItemPageSchema>["items"][number],
  evaluatedAt: number,
): boolean {
  return (
    item.stage === "in_progress" &&
    item.currentLease !== null &&
    item.currentLease.endedAt === null &&
    Date.parse(item.currentLease.expiresAt) > evaluatedAt
  );
}

function currentIncidentCount(
  items: z.infer<typeof WorkItemPageSchema>["items"],
  candidateId: string,
  evaluatedAt: number,
): number {
  return items.filter(
    (item) =>
      item.id !== candidateId &&
      INCIDENT_ID_PATTERN.test(item.id) &&
      hasActiveWorkerLease(item, evaluatedAt),
  ).length;
}

async function recordWorker(
  ledger: VulnerabilityIncidentLedger,
  policy: VulnerabilityControllerPolicy,
  decision: VulnerabilityCorrelationDecision,
  worker: { threadId: string; url: string },
  occurredAt: string,
): Promise<void> {
  await ledger.recordTransition({
    schemaVersion: 1,
    recordType: "vulnerability-incident-event",
    eventId: deterministicUuid(`worker-linked:${decision.incidentId}`),
    incidentId: decision.incidentId,
    occurredAt,
    transition: "worker-linked",
    controller: controllerReference(policy),
    workerThread: worker,
  });
}

interface ReconciliationResult {
  admitted: string[];
  launched: string[];
  observed: number;
}

async function reconcileAlert(
  dependencies: ReconcilerDependencies,
  input: {
    alertNumber: number;
    configured: VulnerabilityControllerPolicy["repositories"][number];
    items: z.infer<typeof WorkItemPageSchema>["items"];
    owner: string;
    repository: string;
    result: ReconciliationResult;
  },
): Promise<boolean> {
  const { authorizer, github, now, policy, workGraph } = dependencies;
  input.result.observed += 1;
  const observedAt = now();
  const snapshot = await queryGithubVulnerability(
    github,
    {
      owner: input.owner,
      repository: input.repository,
      alertNumber: input.alertNumber,
    },
    {
      now: observedAt,
      maxProviderAgeMs: policy.reconciliation.maximumProviderAgeSeconds * 1_000,
    },
  );
  const evaluatedAt = now();
  const incidentId = createVulnerabilityIncidentId(
    snapshot.repository.id,
    snapshot.alert.number,
  );
  const correlation = decideVulnerabilityCorrelation(snapshot, {
    now: evaluatedAt.getTime(),
  });
  if (!workerRequired(correlation)) return false;

  const admission = decideVulnerabilityAdmission(
    policy,
    {
      currentAlert: {
        repository: snapshot.repository.fullName,
        number: snapshot.alert.number,
        state: snapshot.alert.state,
        severity: admissionSeverity(snapshot.alert.severity),
        observedAt: snapshot.observedAt,
      },
      activeIncidentCount: currentIncidentCount(
        input.items,
        incidentId,
        evaluatedAt.getTime(),
      ),
      evaluatedAt: evaluatedAt.toISOString(),
    },
    authorizer,
  );
  if (admission.decision === "reject") return false;

  const existing = input.items.find(({ id }) => id === incidentId);
  const transitions =
    existing === undefined
      ? new Set<string>()
      : await incidentTransitions(workGraph, incidentId);
  if (
    existing !== undefined &&
    !["ready", "in_progress", "stale"].includes(existing.stage)
  ) {
    return false;
  }

  const ledger = new VulnerabilityIncidentLedger(
    workGraph as VulnerabilityIncidentWorkGraphPort,
    {
      writerId: vulnerabilityWorkerIdentity(incidentId),
      now: () => now().getTime(),
    },
  );
  if (!transitions.has("admitted")) {
    await ledger.admit({
      eventId: deterministicUuid(`admitted:${incidentId}`),
      occurredAt: evaluatedAt.toISOString(),
      policy: { policyId: policy.policyId, revision: policy.revision },
      controller: controllerReference(policy),
      workerThread: null,
      decision: correlation,
      schedulingProjectId: POLICY_PROJECT,
    });
    input.result.admitted.push(incidentId);
  }

  if (
    existing !== undefined &&
    transitions.has("worker-linked") &&
    hasActiveWorkerLease(existing, evaluatedAt.getTime())
  ) {
    return true;
  }
  const launchAuthorization = authorizer.authorize({
    action: "t3.worker.launch",
    authorityProfileId: input.configured.authorityProfileId,
    resource: {
      uid: { type: "AgentCoordinator::Incident", id: incidentId },
      attrs: {
        repository: {
          type: "AgentCoordinator::Repository",
          id: input.configured.repository.toLowerCase(),
        },
        controllerOwned: true,
        productionValidated: false,
        alertOpen: true,
      },
      parents: [],
    },
    supportingEntities: [
      {
        uid: {
          type: "AgentCoordinator::Repository",
          id: input.configured.repository.toLowerCase(),
        },
        attrs: { fullName: input.configured.repository, provider: "github" },
        parents: [],
      },
    ],
    context: {},
    providerCapability: {
      granted: true,
      source: "t3-client-session",
    },
  });
  if (launchAuthorization.decision !== "allow") return true;
  const worker = await dependencies.launchWorker(correlation);
  await recordWorker(
    ledger,
    policy,
    correlation,
    worker,
    evaluatedAt.toISOString(),
  );
  input.result.launched.push(incidentId);
  return true;
}

export async function reconcileSevereVulnerabilities(
  dependencies: ReconcilerDependencies,
): Promise<{ admitted: string[]; launched: string[]; observed: number }> {
  const { github, policy, workGraph } = dependencies;
  const listed = WorkItemPageSchema.parse(
    await workGraph.listWorkItems({
      includeProjectIds: [POLICY_PROJECT],
      limit: 100,
    }),
  );
  if (listed.nextCursor !== null) {
    throw new Error("Agent Coordinator incidents exceed the reconciliation page limit");
  }
  const result: ReconciliationResult = {
    admitted: [],
    launched: [],
    observed: 0,
  };

  for (const configured of policy.repositories) {
    const [owner, repository] = configured.repository.split("/");
    if (owner === undefined || repository === undefined) {
      throw new Error(`Invalid configured repository ${configured.repository}`);
    }
    const alertNumbers = await listOpenAlertNumbers(
      github,
      configured.repository,
      policy.admittedSeverities,
    );
    for (const alertNumber of alertNumbers) {
      const admitted = await reconcileAlert(dependencies, {
        alertNumber,
        configured,
        items: listed.items,
        owner,
        repository,
        result,
      });
      if (admitted) return result;
    }
  }
  return result;
}

function requiredEnvironment(name: string): string {
  return z.string().min(1).parse(process.env[name]);
}

export function loadPolicy(directory: string): {
  authorizer: ControllerAuthorizer;
  policy: VulnerabilityControllerPolicy;
} {
  const policy = VulnerabilityControllerPolicySchema.parse(
    JSON.parse(readFileSync(`${directory}/controller-policy.json`, "utf8")),
  );
  const bundle = policy.authorization.bundle;
  const files = Object.fromEntries(
    [bundle.schemaFile, ...bundle.policyFiles].map((fileName) => [
      fileName,
      readFileSync(`${directory}/${fileName}`, "utf8"),
    ]),
  );
  return {
    policy,
    authorizer: createControllerAuthorizer(policy.authorization, files, policy.revision),
  };
}

export type T3ControllerClient = ReturnType<typeof T3Client.create>;

export function t3WorkerLauncher(input: {
  accessToken: string;
  baseBranch: string;
  client?: T3ControllerClient;
  origin: string;
  projectRoot: string;
  startTurn?: typeof startTurnWithProviderRecovery;
}) {
  const client =
    input.client ??
    T3Client.create({
      accessToken: input.accessToken,
      baseUrl: input.origin,
      clientLabel: "severe-vulnerability-controller",
    });
  const startTurn = input.startTurn ?? startTurnWithProviderRecovery;
  return {
    client,
    async launch(decision: VulnerabilityCorrelationDecision) {
      const id = threadId(vulnerabilityWorkerThreadId(decision.incidentId));
      const descriptor = await client.server.environment();
      const url = new URL(`/${descriptor.environmentId}/${id}`, input.origin).toString();
      let existing = await client.threads.get(id);
      if (
        existing?.latestTurn?.state === "running" ||
        existing?.latestTurn?.state === "completed"
      ) {
        return { threadId: id, url };
      }
      if (
        existing !== undefined &&
        existing.latestTurn === null &&
        existing.worktreePath === null
      ) {
        await client.threads.delete(id);
        existing = undefined;
      }

      const project = await client.projects.findByWorkspaceRoot(input.projectRoot);
      if (project === undefined) {
        throw new Error(`T3 Code has no project for ${input.projectRoot}`);
      }
      const providers = await refreshRoutingProviders(client);
      const providerCandidates = selectCodexProviders(
        providers,
        decision.incidentId,
        WORKER_MODEL,
      );
      const attempts = buildProviderTurnAttempts({
        effort: "high",
        model: WORKER_MODEL,
        providers: providerCandidates,
        serviceTier: "priority",
      });
      const prompt = buildVulnerabilityWorkerPrompt(decision);
      const createdAt = new Date().toISOString();
      await startTurn({
        attempts,
        threadId: id,
        threads: client.threads,
        buildTurnInput: (attempt, attemptIndex) => ({
          threadId: id,
          text:
            attemptIndex === 0
              ? prompt
              : `The previous approved provider failed before work began. Resume this exact incident instruction:\n\n${prompt}`,
          modelSelection: schemas.orchestrationModel.ModelSelection.parse(
            attempt.modelSelection,
          ),
          runtimeMode: "full-access",
          interactionMode: "default",
          ...(existing === undefined && attemptIndex === 0
            ? {
                bootstrap: {
                  createThread: {
                    projectId: project.id,
                    title: `Severe vulnerability: ${decision.alert.package.name}`,
                    modelSelection: attempt.modelSelection,
                    runtimeMode: "full-access" as const,
                    interactionMode: "default" as const,
                    branch: null,
                    worktreePath: null,
                    createdAt,
                  },
                  prepareWorktree: {
                    projectCwd: project.workspaceRoot,
                    baseBranch: input.baseBranch,
                    branch: `agent-coordinator/${id}`,
                    startFromOrigin: true,
                    requireWorktree: true,
                  },
                  runSetupScript: true,
                },
              }
            : {}),
        }),
      });
      return { threadId: id, url };
    },
  };
}

async function main(): Promise<void> {
  const { authorizer, policy } = loadPolicy(
    process.env.AGENT_COORDINATOR_POLICY_DIRECTORY ?? "/etc/agent-coordinator",
  );
  const github = new GithubClient(requiredEnvironment("GH_TOKEN"), {
    userAgent: "hq-severe-vulnerability-controller",
  });
  const workGraph = new WorkGraphClient(
    resolveClientConfig({ accessAllowedOrigins: [] }, process.env),
  );
  const launcher = t3WorkerLauncher({
    accessToken: requiredEnvironment("T3_ACCESS_TOKEN"),
    baseBranch: process.env.AGENT_COORDINATOR_BASE_BRANCH ?? "main",
    origin: requiredEnvironment("T3_ORIGIN"),
    projectRoot: requiredEnvironment("AGENT_COORDINATOR_PROJECT_ROOT"),
  });
  try {
    while (true) {
      const result = await reconcileSevereVulnerabilities({
        authorizer,
        github,
        launchWorker: (decision) => launcher.launch(decision),
        now: () => new Date(),
        policy,
        workGraph,
      });
      process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), ...result })}\n`);
      await new Promise((resolve) =>
        setTimeout(resolve, policy.reconciliation.intervalSeconds * 1_000),
      );
    }
  } finally {
    await launcher.client.close();
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
