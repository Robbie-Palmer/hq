import fs from "node:fs";
import path from "node:path";
import { completePullRequestMetadata } from "ai-review-domain/pull-request-metadata";
import {
  expandHome,
  listJsonFiles,
  readJson,
  resetDirectory,
  sha256,
  stableJson,
  writeJson,
} from "./artifact-files";
import { parseArgs } from "./cli-arguments";
import { changeSizeBand, languagesForPaths, outcomeClass } from "./corpus-strata";
import {
  DatasetManifestSchema,
  FindingOutcomeSchema,
  PipelineParamsSchema,
  ReplayInputSnapshotSchema,
  ReviewTerminalSchema,
  type DatasetManifest,
  type FindingOutcome,
  type HistoricalFinding,
  type ReplayInputSnapshot,
  type ReviewTerminal,
} from "./schemas";

interface SourceObject<T> {
  key: string;
  sha256: string;
  record: T;
}

function terminalRank(record: ReviewTerminal): number {
  if (record.status === "published") return 0;
  if (record.status === "skipped") return 1;
  if (record.status === "denied") return 2;
  return 3;
}

function latestOutcomes(records: SourceObject<unknown>[]): Map<string, SourceObject<FindingOutcome>> {
  const latest = new Map<string, SourceObject<FindingOutcome>>();
  for (const item of records) {
    const parsed = FindingOutcomeSchema.safeParse(item.record);
    if (!parsed.success) continue;
    const record = parsed.data;
    const key = `${record.repository}#${record.pullRequestNumber}#${record.findingId}`;
    const version = record.outcomeVersion;
    const previous = latest.get(key);
    const typedItem = { ...item, record };
    if (!previous || version > previous.record.outcomeVersion) latest.set(key, typedItem);
    else if (version === previous.record.outcomeVersion) {
      throw new Error(`duplicate outcome version for ${key}`);
    }
  }
  return latest;
}

function outcomeAvailability(labels: HistoricalFinding[]): "no-findings" | "complete" | "partial" | "missing" | "censored" {
  if (labels.length === 0) return "no-findings";
  const classes = labels.map((label) => outcomeClass(label.outcome?.outcome));
  const adjudicated = classes.filter((value) => value === "accepted" || value === "rejected").length;
  if (adjudicated === labels.length) return "complete";
  if (adjudicated > 0) return "partial";
  if (classes.every((value) => value === "missing")) return "missing";
  return "censored";
}

function sourceObject<T>(root: string, file: string, record: T): SourceObject<T> {
  const content = fs.readFileSync(file, "utf8");
  return {
    key: path.relative(root, file).split(path.sep).join("/"),
    sha256: sha256(content),
    record,
  };
}

function pullRequestMetadata(
  terminal: ReviewTerminal,
  snapshot: ReplayInputSnapshot,
): DatasetManifest["entries"][number]["pullRequest"] {
  const recorded = terminal.pullRequest ?? snapshot.pullRequest;
  return recorded ? completePullRequestMetadata(recorded) : undefined;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing function predates the complexity limit; new violations remain prohibited.
export function extractCorpus({
  input,
  output,
  paramsFile,
}: {
  input?: string;
  output: string;
  paramsFile: string;
}): DatasetManifest {
  const params = PipelineParamsSchema.parse(readJson(paramsFile));
  const repository = params.source.repository;
  const sourceRoot = path.resolve(expandHome(input ?? params.source.exportPath));
  const outputRoot = path.resolve(output);
  const records = listJsonFiles(sourceRoot).map((file) => {
    const record = readJson(file);
    return sourceObject(sourceRoot, file, record);
  });
  const snapshots = records.flatMap((item): SourceObject<ReplayInputSnapshot>[] => {
    const parsed = ReplayInputSnapshotSchema.safeParse(item.record);
    return parsed.success && parsed.data.repository === repository
      ? [{ ...item, record: parsed.data }]
      : [];
  });
  if (snapshots.length === 0) throw new Error(`no replay snapshots found for ${repository}`);

  const terminals = new Map<string, SourceObject<ReviewTerminal>>();
  const terminalSourceRecords: ReviewTerminal[] = [];
  for (const item of records) {
    const parsed = ReviewTerminalSchema.safeParse(item.record);
    if (!parsed.success) continue;
    const record = parsed.data;
    if (record.repository === repository) terminalSourceRecords.push(record);
    const key = `${record.repository}#${record.pullRequestNumber}#${record.workflow?.instanceId}`;
    const previous = terminals.get(key);
    if (!previous || terminalRank(record) < terminalRank(previous.record)) terminals.set(key, { ...item, record });
  }
  const outcomes = latestOutcomes(records);
  const entries: DatasetManifest["entries"] = [];
  resetDirectory(outputRoot);
  const entriesRoot = path.join(outputRoot, "entries");
  fs.mkdirSync(entriesRoot, { recursive: true });

  for (const snapshotItem of snapshots.toSorted((left, right) => left.key.localeCompare(right.key))) {
    const snapshot = snapshotItem.record;
    const terminalKey = `${snapshot.repository}#${snapshot.pullRequestNumber}#${snapshot.productionRunId}`;
    const terminalItem = terminals.get(terminalKey);
    if (!terminalItem) continue;
    const terminal = terminalItem.record;
    const snapshotContent = fs.readFileSync(path.join(sourceRoot, snapshotItem.key), "utf8");
    const corpusId = sha256(snapshotContent);
    const labels = (terminal.findings?.published ?? []).map((finding) => {
      const key = `${snapshot.repository}#${snapshot.pullRequestNumber}#${finding.findingId}`;
      const outcomeItem = outcomes.get(key);
      return {
        finding,
        outcome: outcomeItem?.record ?? null,
        outcomeSource: outcomeItem ? { key: outcomeItem.key, sha256: outcomeItem.sha256 } : null,
      };
    });
    const paths = snapshot.decision?.paths ?? [];
    const riskSignals = terminal.change?.riskSignals ?? [];
    const repositoryAreas = [...new Set(terminal.change?.repositoryAreas ?? [])]
      .sort((left, right) => left.localeCompare(right));
    const languages = languagesForPaths(paths);
    const coverage = terminal.coverage ?? snapshot.decision?.coverage ?? null;
    const changedLines = (terminal.change?.additions ?? 0) + (terminal.change?.deletions ?? 0);
    const pullRequest = pullRequestMetadata(terminal, snapshot);
    const entryPath = `entries/${corpusId}.json`;
    fs.writeFileSync(path.join(outputRoot, entryPath), snapshotContent);
    entries.push({
      corpusId,
      snapshotPath: entryPath,
      repository: snapshot.repository,
      pullRequestNumber: snapshot.pullRequestNumber,
      capturedAt: snapshot.provenance.capturedAt,
      changedLines,
      pullRequest,
      productionRunId: snapshot.productionRunId,
      headSha: snapshot.git?.headSha,
      promptVersion: snapshot.prompt?.version,
      strata: {
        risk: riskSignals.length > 0 ? "elevated" : "standard",
        riskSignals: [...riskSignals].sort((left, right) => left.localeCompare(right)),
        changeSize: changeSizeBand(changedLines, params.cohort.changeSizeBands),
        languages,
        repositoryAreas,
        taskType: pullRequest?.taskType ?? null,
        originatingAgent: pullRequest?.originatingAgent ?? null,
        outcomeAvailability: outcomeAvailability(labels),
      },
      coverage,
      historicalFindings: labels,
      source: {
        snapshot: { key: snapshotItem.key, sha256: snapshotItem.sha256 },
        productionTerminal: { key: terminalItem.key, sha256: terminalItem.sha256 },
      },
    });
  }
  if (entries.length === 0) throw new Error("replay snapshots did not join to production terminal records");
  entries.sort((left, right) => left.corpusId.localeCompare(right.corpusId));
  const terminalWorkflowRuns = [...terminals.values()].filter((item) => item.record.repository === repository);
  const capturedAt = entries.map((entry) => entry.capturedAt)
    .sort((left, right) => left.localeCompare(right));
  const earliestCapturedAt = capturedAt[0];
  const latestCapturedAt = capturedAt.at(-1);
  if (!earliestCapturedAt || !latestCapturedAt) throw new Error("replay snapshot capture range is empty");
  const manifestBody = {
    schemaVersion: 1,
    recordType: "ai-review-evaluation-dataset",
    repository,
    sourceSummary: {
      terminalRecords: terminalSourceRecords.length,
      terminalWorkflowRuns: terminalWorkflowRuns.length,
      terminalPullRequests: new Set(terminalSourceRecords.map((record) => record.pullRequestNumber)).size,
      replaySnapshots: entries.length,
      replayablePullRequests: new Set(entries.map((entry) => entry.pullRequestNumber)).size,
      replaySnapshotCapturedAt: { earliest: earliestCapturedAt, latest: latestCapturedAt },
    },
    entries,
  };
  const manifest = DatasetManifestSchema.parse({
    ...manifestBody,
    datasetId: sha256(stableJson(manifestBody)),
  });
  writeJson(path.join(outputRoot, "manifest.json"), manifest, true);
  return manifest;
}

function main() {
  const args = parseArgs(process.argv.slice(2), ["output", "params"]);
  const manifest = extractCorpus({ input: args.input, output: args.output, paramsFile: args.params });
  process.stdout.write(
    `Extracted ${manifest.sourceSummary.replaySnapshots} replay snapshots across ${manifest.sourceSummary.replayablePullRequests} pull requests `
    + `from ${manifest.sourceSummary.terminalPullRequests} pull requests with terminal records into dataset ${manifest.datasetId}\n`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  try { main(); } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
