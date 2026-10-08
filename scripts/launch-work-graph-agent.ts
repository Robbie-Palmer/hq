import { randomUUID } from "node:crypto";

import { schemas, T3Client, threadId } from "@wyrd-company/t3code-client";

const prompt =
  "Using the Work Graph CLI, pick up and execute the next task. Continue through the full repository SDLC when it is safe and authorized. If the work requires a human decision, approval, credential, or materially broader authority, request attention on the ticket and ask me in this T3 Code thread.";
const runtimeModes = [
  "approval-required",
  "auto-accept-edits",
  "auto",
  "full-access",
] as const;
type RuntimeMode = (typeof runtimeModes)[number];

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function isRuntimeMode(value: string): value is RuntimeMode {
  return runtimeModes.some((candidate) => candidate === value);
}

async function main(): Promise<void> {
  const accessToken = requiredEnvironment("T3_ACCESS_TOKEN");
  const baseBranch = requiredEnvironment("T3_WORK_GRAPH_BASE_BRANCH");
  const origin = requiredEnvironment("T3_WORK_GRAPH_ORIGIN");
  const projectRoot = requiredEnvironment("T3_WORK_GRAPH_PROJECT_ROOT");
  const provider = requiredEnvironment("T3_WORK_GRAPH_PROVIDER");
  const model = requiredEnvironment("T3_WORK_GRAPH_MODEL");
  const effort = requiredEnvironment("T3_WORK_GRAPH_EFFORT");
  const serviceTier = requiredEnvironment("T3_WORK_GRAPH_SERVICE_TIER");
  const parsedRuntimeMode = schemas.orchestrationModel.RuntimeMode.parse(
    process.env.T3_WORK_GRAPH_RUNTIME_MODE ?? "full-access",
  );
  if (!isRuntimeMode(parsedRuntimeMode)) {
    throw new Error(`Unsupported T3 runtime mode: ${parsedRuntimeMode}`);
  }
  const runtimeMode = parsedRuntimeMode;
  const modelSelection = schemas.orchestrationModel.ModelSelection.parse({
    instanceId: provider,
    model,
    options: [
      { id: "reasoningEffort", value: effort },
      { id: "serviceTier", value: serviceTier },
    ],
  });

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
    if ((await client.server.findModel(provider, model)) === undefined) {
      throw new Error(`T3 Code provider ${provider} does not offer model ${model}`);
    }

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
          title: "Work Graph: next ticket",
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
          threadId: id,
          turn: {
            commandId: turn.commandId,
            messageId: turn.messageId,
            sequence: turn.sequence,
          },
          url: url.toString(),
          provider,
          model,
          reasoningEffort: effort,
          runtimeMode,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await client.close();
  }
}

await main();
