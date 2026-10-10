import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

import {
  schemas,
  T3Client,
  threadId,
} from "@wyrd-company/t3code-client";
import { z } from "zod";

const RoutingProviderSchema = z.looseObject({
  instanceId: z.string().min(1),
  driver: z.string().min(1),
  enabled: z.boolean(),
  installed: z.boolean(),
  status: z.string().min(1),
  availability: z.string().optional(),
  auth: z.looseObject({ status: z.string().min(1) }),
  models: z.array(
    z.looseObject({
      slug: z.string().min(1),
      isLegacy: z.boolean().optional(),
      capabilities: z
        .looseObject({
          optionDescriptors: z
            .array(
              z.looseObject({
                type: z.string().optional(),
                id: z.string().optional(),
                options: z
                  .array(z.looseObject({ id: z.string().min(1) }))
                  .optional(),
              }),
            )
            .optional(),
        })
        .nullable(),
    }),
  ),
});
type RoutingProvider = z.infer<typeof RoutingProviderSchema>;

const RuntimeModeSchema = z.enum([
  "approval-required",
  "auto-accept-edits",
  "auto",
  "full-access",
]);
const WorkGraphTicketSchema = z.looseObject({
  id: z.string().min(1),
  title: z.string().min(1),
  expedited: z.boolean(),
  expediteReason: z.string().nullable().optional(),
});
const WorkGraphSelectionSchema = z.object({
  ticket: WorkGraphTicketSchema,
  context: z.array(
    z.looseObject({
      kind: z.string().min(1),
      content: z.string().optional(),
      title: z.string().optional(),
      role: z.string().optional(),
    }),
  ),
});

type WorkGraphSelection = z.infer<typeof WorkGraphSelectionSchema>;
type RuntimeMode = z.infer<typeof RuntimeModeSchema>;
type Complexity = "routine" | "standard" | "complex" | "critical";
type WorkKind = "implementation" | "documentation";

export interface TicketRoute {
  complexity: Complexity;
  workKind: WorkKind;
  preferredModels: readonly string[];
  reasoningEffort: string;
  runtimeMode: RuntimeMode;
  serviceTier: string;
  reasons: readonly string[];
}

const architectureSignal =
  /\b(?:architecture|architectural|adr|cross[- ]cutting|system design|protocol|schema design)\b/iu;
const securitySignal =
  /\b(?:authentication|authorization|credential|secret|security|privacy|threat model|access control)\b/iu;
const broadChangeSignal =
  /\b(?:migration|infrastructure|terraform|kubernetes|platform|distributed|concurrency|orchestration|database schema)\b/iu;
const protectedMutationSignals = [
  /\b(?:(?:deploy|deployment) to production|production (?:deploy|deployment))\b/iu,
  /\bprovision(?:ing)?\b/iu,
  /\brotate (?:a |the )?(?:credential|key|secret)\b/iu,
  /\b(?:database|schema) migration\b/iu,
  /\b(?:delete production|destructive operation)\b/iu,
  /\b(?:terraform|kubectl) apply\b/iu,
  /\b(?:payment|billing)\b/iu,
];
const routineSignal =
  /\b(?:typo|copy edit|broken link|link fix|rename|small prose|single page)\b/iu;
const documentationActionSignal =
  /^(?:add|author|create|document|draft|edit|fix|publish|rewrite|update|write)\b/iu;
const documentationArtifactSignals = [
  /\b(?:article|copy edit|documentation|docs?|guide)\b/iu,
  /\b(?:idea page|ideas|markdown|mdx)\b/iu,
  /\b(?:pitch deck|prose|readme|runbook)\b/iu,
];
const documentationOnlyTitleSignals = [
  /^(?:documentation|docs?|readme|runbook|writing)\b/iu,
  /^preserve\b.*\bdesign\b/iu,
  /^define\b.*\bquestions\b/iu,
];

export function isDocumentationOnlyTicket(
  selection: WorkGraphSelection,
): boolean {
  const { title } = selection.ticket;
  return (
    documentationOnlyTitleSignals.some((signal) => signal.test(title)) ||
    (documentationActionSignal.test(title) &&
      documentationArtifactSignals.some((signal) => signal.test(title)))
  );
}

export function classifyDocumentationTicketIds(tickets: unknown): string[] {
  return z
    .array(WorkGraphTicketSchema)
    .parse(tickets)
    .filter((ticket) => isDocumentationOnlyTicket({ ticket, context: [] }))
    .map(({ id }) => id);
}

function selectionText(selection: WorkGraphSelection): string {
  return [
    selection.ticket.title,
    selection.ticket.expediteReason,
    ...selection.context.flatMap(({ content, title }) => [title, content]),
  ]
    .filter((value): value is string => value !== undefined && value !== null)
    .join("\n");
}

function complexityForScore(score: number): Complexity {
  if (score >= 6) return "critical";
  if (score >= 4) return "complex";
  if (score >= 2) return "standard";
  return "routine";
}

function codexModelPolicy(complexity: Complexity): {
  models: readonly string[];
  effort: string;
} {
  switch (complexity) {
    case "critical":
      return {
        models: ["gpt-5.6-sol"],
        effort: "xhigh",
      };
    case "complex":
    case "standard":
      return {
        models: ["gpt-5.6-sol"],
        effort: "high",
      };
    case "routine":
      return {
        models: ["gpt-5.6-sol"],
        effort: "medium",
      };
  }
}

export function deriveTicketRoute(selection: WorkGraphSelection): TicketRoute {
  const text = selectionText(selection);
  const workKind: WorkKind = isDocumentationOnlyTicket(selection)
    ? "documentation"
    : "implementation";
  const reasons: string[] = [];
  let score = 0;

  if (selection.context.some(({ kind }) => kind === "acceptance_criteria")) {
    score += 1;
    reasons.push("acceptance criteria");
  }
  if (selection.context.some(({ kind }) => kind === "architecture_decision")) {
    score += 1;
    reasons.push("linked architecture decision");
  }
  if (architectureSignal.test(text)) {
    score += 2;
    reasons.push("architectural scope");
  }
  if (securitySignal.test(text)) {
    score += 2;
    reasons.push("security or access scope");
  }
  if (broadChangeSignal.test(text)) {
    score += 2;
    reasons.push("broad system change");
  }
  if (text.length > 2_500) {
    score += 1;
    reasons.push("large resolved context");
  }
  if (selection.ticket.expedited) {
    score += 1;
    reasons.push("expedited ticket");
  }
  if (routineSignal.test(text) && score <= 1) {
    score = 0;
    reasons.push("bounded routine change");
  }

  const complexity = complexityForScore(score);
  const policy = codexModelPolicy(complexity);
  const protectedMutation = protectedMutationSignals.some((signal) =>
    signal.test(text),
  );
  if (protectedMutation) reasons.push("protected external mutation");

  return {
    complexity,
    workKind,
    preferredModels: policy.models,
    reasoningEffort: policy.effort,
    runtimeMode: protectedMutation ? "auto-accept-edits" : "full-access",
    serviceTier: selection.ticket.expedited ? "priority" : "default",
    reasons: reasons.length === 0 ? ["bounded ticket context"] : reasons,
  };
}

export function buildWorkerPrompt(ticketId: string): string {
  return `Using the Work Graph CLI, claim and execute ticket ${ticketId}. Follow its context and the repository instructions through the SDLC. T3 has already run the worktree setup and trusted the repository's mise configuration, so do not run mise trust again. If the ticket is no longer claimable, stop and report that here.`;
}

export function assertTicketRouteSupported(
  ticketId: string,
  route: TicketRoute,
): void {
  if (route.workKind === "documentation") {
    throw new Error(
      `Documentation ticket ${ticketId} is excluded until the writing skill and review gate are ready`,
    );
  }
}

interface ProviderRefreshClient {
  server: {
    refreshProviders(input: {
      refreshModels: boolean;
    }): Promise<{ providers: unknown }>;
  };
}

export async function refreshRoutingProviders(
  client: ProviderRefreshClient,
): Promise<RoutingProvider[]> {
  const refreshed = await client.server.refreshProviders({
    refreshModels: false,
  });
  return z.array(RoutingProviderSchema).parse(refreshed.providers);
}

function requiredEnvironment(name: string): string {
  return z.string().min(1).parse(process.env[name]);
}

function environmentOverride(name: string): string | undefined {
  return z.string().min(1).optional().parse(process.env[name]);
}

function eligibleCodexProviders(providers: readonly RoutingProvider[]) {
  return providers
    .filter(
      (provider) =>
        provider.driver === "codex" &&
        provider.enabled &&
        provider.installed &&
        provider.status === "ready" &&
        provider.auth.status === "authenticated" &&
        provider.availability !== "unavailable",
    )
    .toSorted((left, right) => left.instanceId.localeCompare(right.instanceId));
}

function stableIndex(value: string, length: number): number {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) % length;
}

export function selectCodexProvider(
  providers: readonly RoutingProvider[],
  ticketId: string,
  model: string,
  override?: string,
): RoutingProvider {
  const eligible = eligibleCodexProviders(providers).filter((provider) =>
    provider.models.some(({ slug }) => slug === model),
  );
  if (override !== undefined) {
    const selected = eligible.find(({ instanceId }) => instanceId === override);
    if (selected === undefined) {
      throw new Error(
        `Codex provider ${override} is not ready, authenticated, and compatible with ${model}`,
      );
    }
    return selected;
  }
  if (eligible.length === 0) {
    throw new Error(`No ready authenticated Codex provider offers ${model}`);
  }
  const selected = eligible.at(stableIndex(ticketId, eligible.length));
  if (selected === undefined) {
    throw new Error("Codex provider selection produced no result");
  }
  return selected;
}

export function selectModel(
  providers: readonly RoutingProvider[],
  route: TicketRoute,
  override?: string,
): string {
  const offered = new Set(
    eligibleCodexProviders(providers).flatMap(({ models }) =>
      // A legacy label does not withdraw a model explicitly selected by policy.
      models.map(({ slug }) => slug),
    ),
  );
  const selected = override ?? route.preferredModels.find((model) => offered.has(model));
  if (selected === undefined || !offered.has(selected)) {
    const modelDescription =
      override === undefined
        ? "the selected policy model"
        : `model ${override}`;
    throw new Error(
      `No ready authenticated Codex provider offers ${modelDescription}`,
    );
  }
  return selected;
}

function optionValues(
  provider: RoutingProvider,
  model: string,
  optionId: string,
) {
  const descriptor = provider.models
    .find(({ slug }) => slug === model)
    ?.capabilities?.optionDescriptors?.find(
      (option) => option.type === "select" && option.id === optionId,
    );
  return descriptor?.type === "select" && descriptor.options !== undefined
    ? new Set(descriptor.options.map(({ id }) => id))
    : new Set<string>();
}

function validatedOption(
  provider: RoutingProvider,
  model: string,
  optionId: string,
  value: string,
): string {
  if (!optionValues(provider, model, optionId).has(value)) {
    throw new Error(`${provider.instanceId}/${model} does not support ${optionId}=${value}`);
  }
  return value;
}

async function main(): Promise<void> {
  if (process.env.T3_WORK_GRAPH_CLASSIFY_ONLY === "true") {
    const documentationTicketIds = classifyDocumentationTicketIds(
      JSON.parse(requiredEnvironment("T3_WORK_GRAPH_TICKETS")),
    );
    process.stdout.write(`${JSON.stringify({ documentationTicketIds })}\n`);
    return;
  }

  const selection = WorkGraphSelectionSchema.parse(
    JSON.parse(requiredEnvironment("T3_WORK_GRAPH_SELECTION")),
  );
  const route = deriveTicketRoute(selection);
  assertTicketRouteSupported(selection.ticket.id, route);
  const accessToken = requiredEnvironment("T3_ACCESS_TOKEN");
  const baseBranch = requiredEnvironment("T3_WORK_GRAPH_BASE_BRANCH");
  const origin = requiredEnvironment("T3_WORK_GRAPH_ORIGIN");
  const projectRoot = requiredEnvironment("T3_WORK_GRAPH_PROJECT_ROOT");

  const client = T3Client.create({
    accessToken,
    baseUrl: origin,
    clientLabel: "work-graph-agent-launcher",
  });

  try {
    const project = await client.projects.findByWorkspaceRoot(projectRoot);
    if (project === undefined) {
      throw new Error(`T3 Code has no project for ${projectRoot}`);
    }

    const providers = await refreshRoutingProviders(client);
    const model = selectModel(
      providers,
      route,
      environmentOverride("T3_WORK_GRAPH_MODEL"),
    );
    const provider = selectCodexProvider(
      providers,
      selection.ticket.id,
      model,
      environmentOverride("T3_WORK_GRAPH_PROVIDER"),
    );
    const effort = validatedOption(
      provider,
      model,
      "reasoningEffort",
      environmentOverride("T3_WORK_GRAPH_EFFORT") ?? route.reasoningEffort,
    );
    const serviceTier = validatedOption(
      provider,
      model,
      "serviceTier",
      environmentOverride("T3_WORK_GRAPH_SERVICE_TIER") ?? route.serviceTier,
    );
    const runtimeMode = RuntimeModeSchema.parse(
      environmentOverride("T3_WORK_GRAPH_RUNTIME_MODE") ?? route.runtimeMode,
    );
    const modelSelection = schemas.orchestrationModel.ModelSelection.parse({
      instanceId: provider.instanceId,
      model,
      options: [
        { id: "reasoningEffort", value: effort },
        { id: "serviceTier", value: serviceTier },
      ],
    });
    const prompt = buildWorkerPrompt(selection.ticket.id);

    const id = threadId(randomUUID());
    const createdAt = new Date().toISOString();
    const turn = await client.threads.startTurn({
      threadId: id,
      text: prompt,
      modelSelection,
      runtimeMode,
      interactionMode: "default",
      bootstrap: {
        createThread: {
          projectId: project.id,
          title: `Work Graph: ${selection.ticket.title}`,
          modelSelection,
          runtimeMode,
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt,
        },
        prepareWorktree: {
          projectCwd: project.workspaceRoot,
          baseBranch,
          branch: `work-graph/${id}`,
          startFromOrigin: true,
          requireWorktree: true,
        },
        runSetupScript: true,
      },
    });
    const descriptor = await client.server.environment();
    const url = new URL(`/${descriptor.environmentId}/${id}`, origin);

    process.stdout.write(
      `${JSON.stringify(
        {
          ticket: {
            id: selection.ticket.id,
            title: selection.ticket.title,
          },
          route: {
            provider: provider.instanceId,
            model,
            reasoningEffort: effort,
            serviceTier,
            runtimeMode,
            complexity: route.complexity,
            reasons: route.reasons,
          },
          threadId: id,
          turn: {
            commandId: turn.commandId,
            messageId: turn.messageId,
            sequence: turn.sequence,
          },
          url: url.toString(),
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await client.close();
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
