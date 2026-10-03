import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildGovUkSourceRegistry,
  fetchGovUkSourceSnapshot,
  govUkContentSnapshotSchema,
  govUkMonitorStateSchema,
  monitorGovUkSources,
  renderGovUkMonitorReport,
  type GovUkContentSnapshot,
  type GovUkMonitorState,
} from "../src/govUkMonitor";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

type Arguments = {
  attempts: number;
  bootstrap: boolean;
  checkIntervalHours: number | undefined;
  proposalsDirectory: string;
  reportPath: string;
  resultPath: string;
  reviewedDirectory: string;
  statePath: string;
};

function valueAfter(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value) throw new Error(`${flag} requires a value`);
  return value;
}

function parseArguments(args: string[]): Arguments {
  const parsed: Arguments = {
    attempts: 3,
    bootstrap: false,
    checkIntervalHours: undefined,
    proposalsDirectory: resolve(packageRoot, ".cache/govuk-monitor/proposals"),
    reportPath: resolve(packageRoot, ".cache/govuk-monitor/report.md"),
    resultPath: resolve(packageRoot, ".cache/govuk-monitor/result.json"),
    reviewedDirectory: resolve(packageRoot, "monitoring/reviewed"),
    statePath: resolve(packageRoot, ".cache/govuk-monitor/state.json"),
  };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    switch (flag) {
      case "--attempts":
        parsed.attempts = Number(valueAfter(args, index, flag));
        index += 1;
        break;
      case "--bootstrap-reviewed-snapshots":
        parsed.bootstrap = true;
        break;
      case "--check-interval-hours":
        parsed.checkIntervalHours = Number(valueAfter(args, index, flag));
        index += 1;
        break;
      case "--proposals-directory":
        parsed.proposalsDirectory = resolve(valueAfter(args, index, flag));
        index += 1;
        break;
      case "--report":
        parsed.reportPath = resolve(valueAfter(args, index, flag));
        index += 1;
        break;
      case "--result":
        parsed.resultPath = resolve(valueAfter(args, index, flag));
        index += 1;
        break;
      case "--reviewed-directory":
        parsed.reviewedDirectory = resolve(valueAfter(args, index, flag));
        index += 1;
        break;
      case "--state":
        parsed.statePath = resolve(valueAfter(args, index, flag));
        index += 1;
        break;
      default:
        throw new Error(`Unknown monitor argument ${flag}`);
    }
  }
  return parsed;
}

async function readJson(path: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return undefined;
    }
    throw error;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function readReviewedSnapshots(
  directory: string,
  sourceIds: readonly string[],
): Promise<Record<string, GovUkContentSnapshot>> {
  const entries = await Promise.all(
    sourceIds.map(async (sourceId) => {
      const input = await readJson(resolve(directory, `${sourceId}.json`));
      if (input === undefined) return null;
      return [sourceId, govUkContentSnapshotSchema.parse(input)] as const;
    }),
  );
  return Object.fromEntries(entries.filter((entry) => entry !== null));
}

async function bootstrapReviewedSnapshots(args: Arguments): Promise<void> {
  const sources = buildGovUkSourceRegistry();
  await mkdir(args.reviewedDirectory, { recursive: true });
  for (const source of sources) {
    const path = resolve(args.reviewedDirectory, `${source.id}.json`);
    if ((await readJson(path)) !== undefined) {
      throw new Error(`Refusing to overwrite reviewed snapshot ${path}`);
    }
    const snapshot = await fetchGovUkSourceSnapshot(source, fetch, args.attempts);
    await writeJson(path, snapshot);
    process.stdout.write(`Recorded initial reviewed snapshot for ${source.id}.\n`);
  }
}

async function writeGitHubOutputs(
  status: string,
  proposalCount: number,
  failureCount: number,
): Promise<void> {
  const output = process.env.GITHUB_OUTPUT;
  if (!output) return;
  await appendFile(
    output,
    `status=${status}\nchanges=${proposalCount > 0}\nfailures=${failureCount > 0}\n`,
  );
}

async function runMonitor(args: Arguments): Promise<void> {
  const sources = buildGovUkSourceRegistry();
  const reviewedSnapshots = await readReviewedSnapshots(
    args.reviewedDirectory,
    sources.map(({ id }) => id),
  );
  const previousStateInput = await readJson(args.statePath);
  const previousState: GovUkMonitorState | undefined =
    previousStateInput === undefined
      ? undefined
      : govUkMonitorStateSchema.parse(previousStateInput);
  const report = await monitorGovUkSources(sources, {
    attempts: args.attempts,
    checkIntervalHours: args.checkIntervalHours,
    previousState,
    reviewedSnapshots,
  });
  await writeJson(args.statePath, report.state);
  await mkdir(dirname(args.reportPath), { recursive: true });
  await writeFile(args.reportPath, renderGovUkMonitorReport(report));
  await writeJson(args.resultPath, {
    checkedAt: report.checkedAt,
    status: report.status,
    checkedSourceIds: report.checkedSourceIds,
    cachedSourceIds: report.cachedSourceIds,
    proposals: report.proposals.map(({ candidateSnapshot: _snapshot, ...proposal }) =>
      proposal
    ),
    failures: report.failures,
  });
  await Promise.all(
    report.proposals.map((proposal) =>
      writeJson(resolve(args.proposalsDirectory, `${proposal.id}.json`), proposal),
    ),
  );
  await writeGitHubOutputs(
    report.status,
    report.proposals.length,
    report.failures.length,
  );
  process.stdout.write(
    `GOV.UK source monitor: ${report.status}; ${report.proposals.length} proposal(s), ${report.failures.length} failure(s).\n`,
  );
}

try {
  const args = parseArguments(process.argv.slice(2));
  if (args.bootstrap) {
    await bootstrapReviewedSnapshots(args);
  } else {
    await runMonitor(args);
  }
} catch (error: unknown) {
  console.error(error);
  process.exitCode = 1;
}
