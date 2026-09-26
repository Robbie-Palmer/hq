import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

type Json = Record<string, unknown>;

interface FrozenPullRequest {
  pullRequestNumber: number;
  headSha: string;
  promptVersion: string;
}

interface Manifest {
  repository: string;
  manifestId: string;
  createdAt: string;
  pullRequests: FrozenPullRequest[];
}

interface Execution {
  pullRequestNumber: number;
  headSha: string;
  promptVersion: string;
  status: "executed" | "executor-failed" | "skipped-budget-exhausted";
  costUsd: number;
  budgetRemainingUsd: number | null;
  result: Json | null;
  error: string | null;
}

const EXECUTION_USAGE =
  "executing a replay is opt-in and budget-capped: pass --yes --max-cost-usd <n> --models <m1,m2> --executor <command>";
const REPLAY_EXECUTOR_TIMEOUT_MS = Number(process.env.AI_REVIEW_EXECUTOR_TIMEOUT_MS ?? "") || 300_000;

class UsageError extends Error {}

const USAGE =
  "usage: tsx analytics/replay.ts --manifest <file> --output <dir> [--max-cost-usd <n>] " +
  "[--models <m1,m2>] [--executor <command>] [--yes]";

function fail(message: string): never {
  throw new Error(message);
}

function usageError(message: string): never {
  throw new UsageError(message);
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function validateFrozenPullRequests(rawPullRequests: unknown): FrozenPullRequest[] {
  if (!Array.isArray(rawPullRequests) || rawPullRequests.length === 0) {
    fail("manifest pullRequests must be a non-empty array");
  }
  const seen = new Set<number>();
  const pullRequests = rawPullRequests.map((entry) => {
    const candidate = entry as Json;
    const pullRequestNumber =
      typeof candidate.pullRequestNumber === "number" ? candidate.pullRequestNumber : Number.NaN;
    const headSha = typeof candidate.headSha === "string" ? candidate.headSha : "";
    const promptVersion = typeof candidate.promptVersion === "string" ? candidate.promptVersion : "";
    if (!Number.isInteger(pullRequestNumber) || !headSha || !promptVersion) {
      fail("each manifest pull request requires pullRequestNumber, headSha, and promptVersion");
    }
    if (seen.has(pullRequestNumber)) {
      fail(`manifest lists pull request ${pullRequestNumber} more than once`);
    }
    seen.add(pullRequestNumber);
    return { pullRequestNumber, headSha, promptVersion };
  });
  return pullRequests;
}

function loadManifest(file: string): Manifest {
  if (!fs.existsSync(file)) fail(`manifest not found: ${file}`);
  let parsed: Json;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Json;
  } catch (error) {
    fail(`manifest is not valid JSON: ${String(error)}`);
  }
  if (parsed.schemaVersion !== 2) {
    fail(`unsupported manifest schema version: ${String(parsed.schemaVersion)}`);
  }
  if (parsed.recordType !== "replay-manifest") {
    fail(`unsupported manifest record type: ${String(parsed.recordType)}`);
  }
  const repository = typeof parsed.repository === "string" ? parsed.repository : "";
  const manifestId = typeof parsed.manifestId === "string" ? parsed.manifestId : "";
  const createdAt = typeof parsed.createdAt === "string" ? parsed.createdAt : "";
  if (!repository || !manifestId || !createdAt) {
    fail("manifest requires repository, manifestId, and createdAt");
  }
  return {
    repository,
    manifestId,
    createdAt,
    pullRequests: validateFrozenPullRequests(parsed.pullRequests),
  };
}

function runExecutor(
  command: string,
  request: Json,
): { ok: true; result: Json; costUsd: number } | { ok: false; error: string } {
  const outcome = spawnSync(command, {
    shell: true,
    input: `${JSON.stringify(request)}\n`,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: REPLAY_EXECUTOR_TIMEOUT_MS,
  });
  if (outcome.error) {
    return {
      ok: false,
      error: outcome.error.message + (outcome.signal ? ` (signal ${outcome.signal})` : ""),
    };
  }
  if (outcome.status !== 0) {
    return {
      ok: false,
      error: `executor exited with status ${outcome.status}: ${(outcome.stderr ?? "").trim()}`,
    };
  }
  const lines = (outcome.stdout ?? "").split("\n").filter((line) => line.trim() !== "");
  const last = lines.at(-1);
  if (!last) return { ok: false, error: "executor produced no output" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(last);
  } catch (error) {
    return { ok: false, error: `executor output is not JSON: ${String(error)}` };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: "executor output must be a JSON object" };
  }
  const result = parsed as Json;
  const rawCost = result.costUsd;
  if (typeof rawCost !== "number" || !Number.isFinite(rawCost) || rawCost < 0) {
    return {
      ok: false,
      error: `executor reported an invalid costUsd: ${JSON.stringify(rawCost)}`,
    };
  }
  return { ok: true, result, costUsd: rawCost };
}

function renderMarkdown(result: Json): string {
  const lines: string[] = [];
  lines.push(`# Controlled replay ${String(result.manifestId)}`, "");
  lines.push(`Repository: \`${String(result.repository)}\`; manifest frozen at ${String(result.manifestCreatedAt)}.`, "");
  const frozen = result.frozen as Json;
  lines.push(`Models: \`${String(frozen.models)}\`.`, "");
  const budget = result.budget as Json;
  lines.push(
    `Budget: cap $${Number(budget.capUsd).toFixed(2)}, spent $${Number(budget.spentUsd).toFixed(6)}, within budget: ${String(budget.withinBudget)}.`,
    "",
  );
  lines.push(
    "| PR | Head | Prompt | Status | Cost (USD) |",
    "| --- | --- | --- | --- | --- |",
  );
  for (const execution of result.executions as Execution[]) {
    lines.push(
      `| ${execution.pullRequestNumber} | ${execution.headSha} | ${execution.promptVersion} | ${execution.status} | ${execution.costUsd.toFixed(6)} |`,
    );
  }
  lines.push("", "Replays are evidence, not adjudication; outcomes require trusted reviewer dispositions.", "");
  return lines.join("\n");
}

function parseModelList(raw: string | undefined): string[] | null {
  const models = (raw ?? "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  return models.length > 0 ? models : null;
}

function executionRequirements(values: { "max-cost-usd"?: string; models?: string; executor?: string }): { capUsd: number; models: string[]; executor: string } {
  const capUsd = Number(values["max-cost-usd"]);
  if (!Number.isFinite(capUsd) || capUsd <= 0) usageError("--max-cost-usd must be a positive number");
  const models = (values.models ?? "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  if (models.length === 0) usageError("--models is required to execute a replay");
  if (!values.executor) usageError("--executor is required to execute a replay");
  return { capUsd, models, executor: values.executor };
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing function predates the complexity limit; new violations remain prohibited.
function executeReplay(
  manifest: Manifest,
  capUsd: number,
  models: string[],
  executor: string,
): Json {
  const executions: Execution[] = [];
  let spentUsd = 0;
  let overBudget = false;
  for (const frozen of manifest.pullRequests) {
    const budgetRemainingUsd = round6(capUsd - spentUsd);
    const execution: Execution = {
      pullRequestNumber: frozen.pullRequestNumber,
      headSha: frozen.headSha,
      promptVersion: frozen.promptVersion,
      status: "executed",
      costUsd: 0,
      budgetRemainingUsd,
      result: null,
      error: null,
    };
    if (budgetRemainingUsd <= 0 || overBudget) {
      execution.status = "skipped-budget-exhausted";
    } else {
      const outcome = runExecutor(executor, {
        repository: manifest.repository,
        manifestId: manifest.manifestId,
        pullRequestNumber: frozen.pullRequestNumber,
        headSha: frozen.headSha,
        promptVersion: frozen.promptVersion,
        models,
        budgetRemainingUsd,
      });
      if (!outcome.ok) {
        execution.status = "executor-failed";
        execution.error = outcome.error;
      } else {
        spentUsd = round6(spentUsd + outcome.costUsd);
        if (spentUsd > capUsd) overBudget = true;
        execution.costUsd = outcome.costUsd;
        execution.result = outcome.result;
      }
    }
    executions.push(execution);
    if (execution.status === "executor-failed") break;
  }
  return {
    schemaVersion: 1,
    recordType: "controlled-replay-result",
    manifestId: manifest.manifestId,
    repository: manifest.repository,
    manifestCreatedAt: manifest.createdAt,
    frozen: {
      pullRequests: manifest.pullRequests,
      models,
    },
    budget: {
      capUsd,
      spentUsd,
      withinBudget: spentUsd <= capUsd,
    },
    executions,
    aborted:
      spentUsd > capUsd || executions.some((execution) => execution.status === "executor-failed"),
    abortReason:
      spentUsd > capUsd
        ? "budget exceeded"
        : (executions.find((execution) => execution.status === "executor-failed")?.error ?? null),
  };
}


function main(): void {
  const args = parseArgs({
    options: {
      manifest: { type: "string" },
      output: { type: "string" },
      "max-cost-usd": { type: "string" },
      models: { type: "string" },
      executor: { type: "string" },
      yes: { type: "boolean", default: false },
    },
  });
  const { values } = args;
  if (!values.manifest) usageError("--manifest is required");
  if (!values.output) usageError("--output is required");
  const manifest = loadManifest(values.manifest);
  const outputDir = values.output;
  fs.mkdirSync(outputDir, { recursive: true });

  if (!values.yes) {
    const plan: Json = {
      schemaVersion: 1,
      recordType: "controlled-replay-plan",
      manifestId: manifest.manifestId,
      repository: manifest.repository,
      manifestCreatedAt: manifest.createdAt,
      manifestPath: values.manifest,
      frozen: {
        pullRequests: manifest.pullRequests,
        models: parseModelList(values.models),
      },
      budget: { capUsd: values["max-cost-usd"] ? Number(values["max-cost-usd"]) : null },
      execution: {
        optIn: false,
        note: `no replay was executed; ${EXECUTION_USAGE}`,
      },
    };
    fs.writeFileSync(path.join(outputDir, "replay-plan.json"), `${JSON.stringify(plan, null, 2)}\n`);
    console.log(`Wrote replay plan for ${manifest.pullRequests.length} frozen pull requests to ${outputDir}`);
    console.log(`No replay was executed; ${EXECUTION_USAGE}`);
    return;
  }

  const { capUsd, models, executor } = executionRequirements(values);
  const result = executeReplay(manifest, capUsd, models, executor);
  fs.writeFileSync(
    path.join(outputDir, "controlled-replay-result.json"),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  fs.writeFileSync(path.join(outputDir, "controlled-replay-result.md"), renderMarkdown(result));
  const executed = (result.executions as Execution[]).filter(
    (execution) => execution.status === "executed",
  ).length;
  const budget = result.budget as { capUsd: number; spentUsd: number };
  console.log(
    `Replay ${manifest.manifestId}: ${executed}/${manifest.pullRequests.length} executed, $${budget.spentUsd.toFixed(6)} of $${budget.capUsd.toFixed(2)} spent`,
  );
  if (result.aborted === true) process.exit(1);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  if (error instanceof UsageError) console.error(USAGE);
  process.exit(error instanceof UsageError ? 2 : 1);
}
