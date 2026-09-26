import {
  DEFAULT_IGNORED_AUTHORS,
  DEFAULT_MERGER,
  DEFAULT_OPENROUTER_SCOUTS,
  MAX_OPENCODE_SCOUTS,
  MAX_OPENROUTER_SCOUTS,
  MERGER_MAX_TOKENS,
  OPENROUTER_MERGER_MAX_PRICES,
  OPENROUTER_SCOUT_MAX_PRICES,
  Reviewer,
  SCOUT_CONCURRENCY,
  csv,
  dataPrompt,
  duplicateScoutModels,
  ignored,
  isEligibleFreeScoutModelId,
  mergerSchema,
  mergerSystem,
  renderComment,
  scoutSchema,
  scoutSystem,
  validateFindings,
  type Finding,
  type MergedFinding,
  type ModelResult,
  type ReviewState,
  type Scout,
  type Settings,
} from "ai-review-domain/reviewer";
import {
  TRUSTED_AUTHOR_ASSOCIATIONS,
  type Env,
  type ReviewWorkflowParams,
} from "./env";
import {
  guardrailPolicy,
  manualGuardrailStatement,
  selectPublishedFindings,
  type HiddenFinding,
  type PublicationPolicy,
} from "./guardrails";
import type {
  ChangeProfile,
  ModelMetric,
  OpenFindingBaseline,
  PullRequestMetadata,
  ReviewCoverage,
  ReviewCoverageMode,
  ReviewHunk,
} from "ai-review-domain/records";
import {
  inferOriginatingAgent,
  inferPullRequestTaskType,
} from "ai-review-domain/pull-request-metadata";
import { sha256Hex as sha256 } from "ts-base/crypto";
import { createInstallationToken } from "./github-app";
import {
  publishFindingComments,
  renderFallbackFindings,
  type FindingPublication,
} from "./finding-lifecycle";
import { persistReplayInput } from "./replay-input";
import {
  reviewRunTerminalKey,
  type ReviewRunTerminalStatus,
} from "./r2-keys";

export type {
  ChangeProfile,
  ModelMetric,
  OpenFindingBaseline,
  PullRequestMetadata,
  ReviewCoverage,
  ReviewCoverageMode,
  ReviewHunk,
} from "ai-review-domain/records";

type JsonObject = Record<string, unknown>;

export const STATEFUL_REVIEW_MARKER = "<!-- stateful-ai-code-review -->";

export interface PreparedReview {
  skipReason?: string;
  baseSha?: string;
  headSha?: string;
  diffFingerprint?: string;
  configFingerprint?: string;
  diff?: string;
  fullDiff?: string;
  paths: string[];
  omitted: string[];
  hunks?: ReviewHunk[];
  allHunks?: ReviewHunk[];
  changeProfile?: ChangeProfile;
  coverage?: ReviewCoverage;
  pullRequest?: PullRequestMetadata;
  context?: string;
  guidelines?: string;
  threads?: string;
  replayFindings?: OpenFindingBaseline[];
  priorOpenFindings?: OpenFindingBaseline[];
}

export interface FindingResolution {
  findingId: string;
  verdict: "fixed" | "still-present" | "uncertain";
  evidence: string;
}

export interface ReviewBaseline {
  headSha?: string;
  hunkIds: string[];
  openFindings: OpenFindingBaseline[];
}

export interface CircuitSkippedModel {
  model: string;
  provider: "opencode" | "openrouter";
  consecutiveFailures: number;
  cooldownUntil: string;
}

export interface ScoutRun {
  models: string[];
  candidates: Record<string, Finding[]>;
  failed: string[];
  candidateCounts: Record<string, number>;
  invalidCounts: Record<string, number>;
  outOfScopeCounts: Record<string, number>;
  costs: Record<string, number>;
  metrics: ModelMetric[];
  circuitSkipped?: CircuitSkippedModel[];
}

export interface ScoutRunOptions {
  providers?: Array<Scout["provider"]>;
  observationId?: string;
  isolated?: boolean;
  systemPrompt?: string;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface MergeRunOptions {
  observationId?: string;
  isolated?: boolean;
  systemPrompt?: string;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface MergedRun {
  result: JsonObject;
  cost: number;
  metric?: ModelMetric;
}

export class MergerOutputError extends Error {
  constructor(message: string, readonly costUsd: number) {
    super(message);
    this.name = "MergerOutputError";
  }
}

export function modelFailureCostUsd(error: unknown): number {
  return error instanceof MergerOutputError ? error.costUsd : 0;
}

const findingResolutionProperties = {
  finding_id: { type: "string" },
  verdict: {
    type: "string",
    enum: ["fixed", "still-present", "uncertain"],
  },
  evidence: { type: "string" },
};

const statefulMergerSchema = {
  ...mergerSchema,
  properties: {
    ...mergerSchema.properties,
    finding_resolutions: {
      type: "array",
      items: {
        type: "object",
        properties: findingResolutionProperties,
        required: Object.keys(findingResolutionProperties),
        additionalProperties: false,
      },
    },
  },
  required: [...mergerSchema.required, "finding_resolutions"],
};

const statefulMergerSystem = `${mergerSystem}
For every durable open finding supplied for controlled replay, also return one
finding_resolutions entry. Mark it fixed only when the supplied current diff and
file context directly demonstrate that the finding's root cause was removed.
Mark it still-present when the defect is directly visible, and uncertain when
the evidence is insufficient. A missing scout finding or a resolved GitHub
thread is never by itself evidence of a fix. Copy each durable finding_id
exactly and give concise code evidence for the verdict.`;

export interface IdentifiedFinding extends Finding {
  findingId: string;
  hunkIds: string[];
}

export interface IdentifiedMergedFinding extends MergedFinding {
  findingId: string;
  hunkIds: string[];
}

export interface IdentifiedReviewArtifacts {
  hunks: ReviewHunk[];
  candidates: Record<string, IdentifiedFinding[]>;
  publishedFindings: IdentifiedMergedFinding[];
  hiddenFindings?: Array<HiddenFinding<IdentifiedMergedFinding>>;
}

export interface ReviewPublication {
  commentId?: number;
  runCostUsd: number;
  findings: FindingPublication[];
}

export type ReviewRecordStatus = ReviewRunTerminalStatus;

function coverageStatement(coverage: ReviewCoverage): string {
  let label = "Skipped coverage";
  if (coverage.mode === "full") label = "Full coverage";
  if (coverage.mode === "incremental") label = "Incremental coverage";
  const counts =
    coverage.mode === "skipped"
      ? `${coverage.unchangedHunkIds.length} unchanged hunk(s) were not reviewed again`
      : `${coverage.reviewedHunkIds.length}/${coverage.totalHunks} semantic hunk(s) reviewed`;
  const unchanged =
    coverage.mode === "incremental"
      ? `; ${coverage.unchangedHunkIds.length} unchanged hunk(s) were not reviewed again`
      : "";
  return `**Coverage: ${label}.** ${counts}${unchanged}. ${coverage.reason}.`;
}

function affectedFindingContext(
  baseline: ReviewBaseline,
  coverage: ReviewCoverage,
): string {
  const affected = new Set(coverage.affectedFindingIds);
  return baseline.openFindings
    .filter(({ findingId }) => affected.has(findingId))
    .map(
      ({ findingId, file, title }) =>
        `DURABLE OPEN FINDING ${findingId} at ${file}: ${title.slice(0, 300)}`,
    )
    .join("\n")
    .slice(0, 4_000);
}

interface ClaimResponse {
  claimed: boolean;
  reason?: string;
  previousState: ReviewState;
}

interface ParsedDiffHunk extends ReviewHunk {
  body: string[];
  header: string;
  prelude: string[];
}

function finiteNumber(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function modelSettings(
  env: Env,
  params: ReviewWorkflowParams,
  githubToken: string,
): Settings {
  const openRouterScouts = csv(
    env.AI_REVIEW_MODELS,
    DEFAULT_OPENROUTER_SCOUTS,
  );
  const openCodeScouts = csv(env.AI_REVIEW_OPENCODE_MODELS, []);
  if (openRouterScouts.length > MAX_OPENROUTER_SCOUTS) {
    throw new Error(
      `AI_REVIEW_MODELS must contain at most ${MAX_OPENROUTER_SCOUTS} model IDs`,
    );
  }
  if (openCodeScouts.length > MAX_OPENCODE_SCOUTS) {
    throw new Error(
      `AI_REVIEW_OPENCODE_MODELS must contain at most ${MAX_OPENCODE_SCOUTS} model IDs`,
    );
  }
  const rejectedScouts = openCodeScouts.filter(
    (model) => !isEligibleFreeScoutModelId(model),
  );
  if (rejectedScouts.length > 0) {
    throw new Error(
      `AI_REVIEW_OPENCODE_MODELS contains ineligible IDs: ${rejectedScouts.join(", ")}`,
    );
  }
  return {
    githubToken,
    openRouterKey: env.OPENROUTER_API_KEY,
    openCodeKey: env.OPENCODE_API_KEY,
    repository: params.repository,
    prNumber: params.pullRequestNumber,
    openRouterScouts,
    openCodeScouts,
    merger: env.AI_REVIEW_MERGER_MODEL?.trim() || DEFAULT_MERGER,
    ignoredAuthors: csv(
      env.AI_REVIEW_IGNORED_AUTHORS,
      DEFAULT_IGNORED_AUTHORS,
    ).map((author) => author.toLowerCase()),
    requireZdr: ["1", "true", "yes", "on"].includes(
      env.AI_REVIEW_ZDR?.trim().toLowerCase() ?? "",
    ),
  };
}

async function installationToken(env: Env): Promise<string> {
  return createInstallationToken({
    appId: env.AI_REVIEW_APP_ID,
    installationId: env.AI_REVIEW_APP_INSTALLATION_ID,
    privateKey: env.AI_REVIEW_APP_PRIVATE_KEY,
  });
}

const EXTENSION_LANGUAGE: Record<string, string> = {
  css: "CSS",
  go: "Go",
  html: "HTML",
  java: "Java",
  js: "JavaScript",
  json: "JSON",
  jsx: "JavaScript",
  md: "Markdown",
  mdx: "MDX",
  py: "Python",
  rs: "Rust",
  sh: "Shell",
  sql: "SQL",
  tf: "Terraform",
  toml: "TOML",
  ts: "TypeScript",
  tsx: "TypeScript",
  yaml: "YAML",
  yml: "YAML",
};

function countPatchLines(diff: string, prefix: "+" | "-"): number {
  return diff
    .split("\n")
    .filter(
      (line) =>
        line.startsWith(prefix) &&
        !line.startsWith(prefix === "+" ? "+++" : "---"),
    ).length;
}

export function reviewRiskSignals(paths: string[]): string[] {
  return [
    paths.some((path) =>
      /(^|\/)(auth|authentication|authorization|credentials?|oauth|security|secrets?|sessions?)(\/|\.|-|_|$)/i.test(
        path,
      ) ||
      /(^|\/)\.env(?:\.|$)/i.test(path) ||
      /\.(key|p12|pem|pfx)$/i.test(path),
    )
      ? "authentication-or-secrets"
      : undefined,
    paths.some(
      (path) =>
        /(^|\/)(drizzle|migrations?|schema)(\/|\.|-|_|$)/i.test(path) ||
        /\.(prisma|sql)$/i.test(path),
    )
      ? "database-schema"
      : undefined,
    paths.some(
      (path) =>
        /(^|\/)(infra|terraform|k8s|kubernetes)(\/|$)/i.test(
          path,
        ) || /(^|\/)(Dockerfile|docker-compose[^/]*)$/i.test(path) || /\.tf$/i.test(path),
    )
      ? "infrastructure"
      : undefined,
    paths.some(
      (path) =>
        path.startsWith(".github/workflows/") ||
        /(^|\/)(deploy|deployment)(\/|\.|-|_|$)/i.test(path) ||
        /(^|\/)(wrangler|vercel|netlify)\.[^/]+$/i.test(path),
    )
      ? "ci-or-deployment"
      : undefined,
  ].filter((signal): signal is string => signal !== undefined);
}

function summarizeChange(
  diff: string,
  paths: string[],
  omitted: string[],
  hunks: ReviewHunk[],
  skippedPaths: string[] = [],
): ChangeProfile {
  const allPaths = [...new Set([...paths, ...omitted, ...skippedPaths])];
  const languages = [
    ...new Set(
      allPaths
        .map((path) => path.split(".").at(-1)?.toLowerCase())
        .map((extension) =>
          extension ? EXTENSION_LANGUAGE[extension] : undefined,
        )
        .filter((language): language is string => language !== undefined),
    ),
  ].sort((left, right) => left.localeCompare(right));
  const repositoryAreas = [
    ...new Set(
      allPaths.map((path) => {
        const [first] = path.split("/");
        return path.includes("/") && first ? first : "root";
      }),
    ),
  ].sort((left, right) => left.localeCompare(right));
  const riskSignals = reviewRiskSignals(allPaths);
  return {
    diffCharacters: diff.length,
    additions: countPatchLines(diff, "+"),
    deletions: countPatchLines(diff, "-"),
    changedFiles: allPaths.length,
    reviewableFiles: paths.length,
    omittedFiles: omitted.length,
    hunks: hunks.length,
    languages,
    repositoryAreas,
    riskSignals,
  };
}

function parseHunkHeader(line: string): {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
} | null {
  const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
  if (!match) return null;
  return {
    oldStart: Number(match[1]),
    oldLines: Number(match[2] ?? 1),
    newStart: Number(match[3]),
    newLines: Number(match[4] ?? 1),
  };
}

async function parseDiffHunks(diff: string): Promise<ParsedDiffHunk[]> {
  const pending: Array<{
    file: string;
    body: string[];
    header: string;
    prelude: string[];
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
  }> = [];
  let file: string | undefined;
  let prelude: string[] = [];
  let current: (typeof pending)[number] | undefined;
  for (const line of diff.split("\n")) {
    const fileMatch = /^diff --git a\/.* b\/(.+)$/.exec(line);
    if (fileMatch) {
      file = fileMatch[1];
      prelude = [line];
      current = undefined;
      continue;
    }
    const header = parseHunkHeader(line);
    if (header && file) {
      current = {
        file,
        body: [],
        header: line,
        prelude: [...prelude],
        ...header,
      };
      pending.push(current);
      continue;
    }
    if (current && line !== String.raw`\ No newline at end of file`) {
      current.body.push(line);
    } else if (file && !current) {
      prelude.push(line);
    }
  }

  const occurrences = new Map<string, number>();
  return Promise.all(
    pending.map(async ({
      file: path,
      body,
      header,
      prelude: filePrelude,
      ...coordinates
    }) => {
      const canonical = `${path}\n${body.join("\n")}`;
      const occurrence = (occurrences.get(canonical) ?? 0) + 1;
      occurrences.set(canonical, occurrence);
      const fingerprint = await sha256(canonical);
      const identity = await sha256(`${canonical}\noccurrence:${occurrence}`);
      return {
        hunkId: `h_${identity.slice(0, 24)}`,
        fingerprint,
        file: path,
        body,
        header,
        prelude: filePrelude,
        ...coordinates,
      };
    }),
  );
}

export async function identifyDiffHunks(diff: string): Promise<ReviewHunk[]> {
  return (await parseDiffHunks(diff)).map(
    ({ body: _body, header: _header, prelude: _prelude, ...hunk }) => hunk,
  );
}

function hunkHasSemanticChange(hunk: ParsedDiffHunk): boolean {
  // Treat indentation, trailing whitespace, and blank-line-only edits as
  // non-semantic. Internal whitespace can change strings or language syntax,
  // so it deliberately remains material.
  const normalize = (line: string) => line.slice(1).trim();
  const removed = hunk.body
    .filter((line) => line.startsWith("-"))
    .map(normalize)
    .filter(Boolean);
  const added = hunk.body
    .filter((line) => line.startsWith("+"))
    .map(normalize)
    .filter(Boolean);
  return JSON.stringify(removed) !== JSON.stringify(added);
}

function renderSelectedDiff(
  hunks: ParsedDiffHunk[],
  selected: Set<string>,
): string {
  const blocks: string[] = [];
  let previousFile: string | undefined;
  for (const hunk of hunks) {
    if (!selected.has(hunk.hunkId)) continue;
    if (hunk.file !== previousFile) {
      blocks.push(...hunk.prelude);
      previousFile = hunk.file;
    }
    blocks.push(hunk.header, ...hunk.body);
  }
  return blocks.length > 0 ? `${blocks.join("\n")}\n` : "";
}

export function decideReviewCoverage(options: {
  force: boolean;
  riskSignals: string[];
  hunks: ReviewHunk[];
  baseline: ReviewBaseline;
  skippedHunkIds?: string[];
  skippedPaths?: string[];
}): ReviewCoverage {
  const currentIds = new Set(options.hunks.map(({ hunkId }) => hunkId));
  const baselineIds = new Set(options.baseline.hunkIds);
  const newHunks = options.hunks.filter(({ hunkId }) => !baselineIds.has(hunkId));
  const changedFiles = new Set(newHunks.map(({ file }) => file));
  const affectedFindings = options.baseline.openFindings.filter((finding) =>
    changedFiles.has(finding.file),
  );
  const affectedIds = new Set(
    affectedFindings.flatMap(({ hunkIds }) =>
      hunkIds.filter((id) => currentIds.has(id)),
    ),
  );
  const incrementalIds = new Set([
    ...newHunks.map(({ hunkId }) => hunkId),
    ...affectedIds,
  ]);
  let mode: ReviewCoverageMode;
  let reason: string;
  let reviewedIds: Set<string>;
  if (options.force) {
    mode = "full";
    reason = "explicit forced full review";
    reviewedIds = currentIds;
  } else if (options.riskSignals.length > 0) {
    mode = "full";
    reason = `risk escalation: ${options.riskSignals.join(", ")}`;
    reviewedIds = currentIds;
  } else if (!options.baseline.headSha) {
    mode = currentIds.size > 0 ? "full" : "skipped";
    reason =
      currentIds.size > 0
        ? "no completed review baseline"
        : "no semantic hunks to review";
    reviewedIds = currentIds;
  } else if (incrementalIds.size > 0) {
    mode = "incremental";
    reason = "new or materially changed hunks since the last completed review";
    reviewedIds = incrementalIds;
  } else {
    mode = "skipped";
    reason = "all current semantic hunks were covered by the last completed review";
    reviewedIds = new Set();
  }
  return {
    mode,
    reason,
    baselineHeadSha: options.baseline.headSha,
    totalHunks: options.hunks.length,
    reviewedHunkIds: options.hunks
      .filter(({ hunkId }) => reviewedIds.has(hunkId))
      .map(({ hunkId }) => hunkId),
    unchangedHunkIds: options.hunks
      .filter(({ hunkId }) => baselineIds.has(hunkId) && !reviewedIds.has(hunkId))
      .map(({ hunkId }) => hunkId),
    skippedHunkIds: options.skippedHunkIds ?? [],
    affectedFindingIds: affectedFindings
      .map(({ findingId }) => findingId)
      .sort((left, right) => left.localeCompare(right)),
    paths: [
      ...new Set(
        options.hunks
          .filter(({ hunkId }) => reviewedIds.has(hunkId))
          .map(({ file }) => file),
      ),
    ].sort((left, right) => left.localeCompare(right)),
    skippedPaths: [...new Set(options.skippedPaths ?? [])].sort((left, right) =>
      left.localeCompare(right),
    ),
  };
}

function normalizedFindingTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function hunkIdsForFinding(
  finding: Pick<Finding, "file" | "line">,
  hunks: ReviewHunk[],
): string[] {
  const sameFile = hunks.filter((hunk) => hunk.file === finding.file);
  if (finding.line === null) return sameFile.map(({ hunkId }) => hunkId);
  const containing = sameFile.filter(
    (hunk) =>
      finding.line !== null &&
      finding.line >= hunk.newStart &&
      finding.line < hunk.newStart + Math.max(hunk.newLines, 1),
  );
  if (containing.length > 0) return containing.map(({ hunkId }) => hunkId);
  const nearest = [...sameFile].sort(
    (left, right) =>
      Math.abs(left.newStart - (finding.line ?? 0)) -
      Math.abs(right.newStart - (finding.line ?? 0)),
  )[0];
  return nearest ? [nearest.hunkId] : [];
}

async function findingIdentity(finding: Pick<Finding, "file" | "title">) {
  const digest = await sha256(
    `${finding.file.toLowerCase()}\n${normalizedFindingTitle(finding.title)}`,
  );
  return `f_${digest.slice(0, 24)}`;
}

function findingSimilarity(left: Finding, right: Finding): number {
  if (left.file !== right.file) return Number.NEGATIVE_INFINITY;
  const leftTokens = new Set(normalizedFindingTitle(left.title).split(" "));
  const rightTokens = new Set(normalizedFindingTitle(right.title).split(" "));
  const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size || 1;
  const lineDistance =
    left.line === null || right.line === null ? 0 : Math.abs(left.line - right.line);
  return overlap / union - Math.min(lineDistance, 100) / 1_000;
}

export async function identifyReviewArtifacts(
  prepared: PreparedReview,
  scouts: ScoutRun,
  merged: MergedRun,
  publicationPolicy: PublicationPolicy = guardrailPolicy({}).publication,
): Promise<IdentifiedReviewArtifacts> {
  const hunks = prepared.hunks ?? [];
  const candidates: Record<string, IdentifiedFinding[]> = {};
  for (const [model, findings] of Object.entries(scouts.candidates)) {
    candidates[model] = await Promise.all(
      findings.map(async (finding) => ({
        ...finding,
        findingId: await findingIdentity(finding),
        hunkIds: hunkIdsForFinding(finding, hunks),
      })),
    );
  }
  const mergedFindings = Array.isArray(merged.result.findings)
    ? (merged.result.findings as MergedFinding[])
    : [];
  const identifiedFindings = await Promise.all(
    mergedFindings.map(async (finding): Promise<IdentifiedMergedFinding> => {
      const sourceCandidates = finding.source_models.flatMap(
        (model) => candidates[model] ?? [],
      );
      const closest = [...sourceCandidates].sort(
        (left, right) =>
          findingSimilarity(finding, right) - findingSimilarity(finding, left),
      )[0];
      const sufficientlySimilar =
        closest && findingSimilarity(finding, closest) >= 0.25;
      return {
        ...finding,
        findingId: sufficientlySimilar
          ? closest.findingId
          : await findingIdentity(finding),
        hunkIds: hunkIdsForFinding(finding, hunks),
      };
    }),
  );
  const { published, hidden } = selectPublishedFindings(
    identifiedFindings,
    publicationPolicy,
  );
  return {
    hunks,
    candidates,
    publishedFindings: published,
    hiddenFindings: hidden,
  };
}

function coordinatorStub(env: Env, params: ReviewWorkflowParams) {
  const name = `${params.repository}#${params.pullRequestNumber}`;
  return env.PR_STATE.get(env.PR_STATE.idFromName(name));
}

async function coordinatorRequest<T>(
  env: Env,
  params: ReviewWorkflowParams,
  path: string,
  body: unknown,
): Promise<T> {
  const response = await coordinatorStub(env, params).fetch(
    `https://coordinator.internal${path}`,
    {
      method: "POST",
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) {
    throw new Error(`Coordinator ${path} failed (${response.status})`);
  }
  return response.json<T>();
}

async function reviewBaseline(
  env: Env,
  params: ReviewWorkflowParams,
  headSha: string,
): Promise<ReviewBaseline> {
  // Small unit-level consumers of the engine may not bind a coordinator. The
  // deployed Worker always does; treating the missing binding as an empty
  // baseline keeps those consumers conservative (a full review).
  if (!env.PR_STATE) return { hunkIds: [], openFindings: [] };
  return coordinatorRequest<ReviewBaseline>(
    env,
    params,
    "/reviews/baseline",
    { headSha },
  );
}

export async function prepareReview(
  env: Env,
  params: ReviewWorkflowParams,
): Promise<PreparedReview> {
  const settings = modelSettings(env, params, await installationToken(env));
  const reviewer = new Reviewer(settings);
  const pr = await reviewer.getPr();
  if (pr.state !== "open") {
    return { skipReason: `pull request is ${pr.state}`, paths: [], omitted: [] };
  }
  if (pr.draft && !params.force) {
    return { skipReason: "pull request is draft", paths: [], omitted: [] };
  }
  if (
    !params.force &&
    (!pr.author_association ||
      !TRUSTED_AUTHOR_ASSOCIATIONS.has(pr.author_association) ||
      pr.head.repo?.full_name !== params.repository)
  ) {
    return {
      skipReason: "automatic review is not eligible for this author or fork",
      paths: [],
      omitted: [],
    };
  }
  if (
    !params.force &&
    settings.ignoredAuthors.includes(pr.user.login.toLowerCase())
  ) {
    return {
      skipReason: `ignored author ${pr.user.login}`,
      paths: [],
      omitted: [],
    };
  }

  const headSha = pr.head.sha;
  const { diff: rawDiff, paths: rawPaths, omitted } = await reviewer.changedFiles({
    includeIgnored: true,
  });
  const parsedHunks = await parseDiffHunks(rawDiff);
  const rawHunks = parsedHunks.map(
    ({ body: _body, header: _header, prelude: _prelude, ...hunk }) => hunk,
  );
  const baseline = await reviewBaseline(env, params, headSha);
  const baselineIds = new Set(baseline.hunkIds);
  const materiallyChangedHunks = baseline.headSha
    ? rawHunks.filter(({ hunkId }) => !baselineIds.has(hunkId))
    : rawHunks;
  const materiallyChangedPaths = [
    ...new Set(materiallyChangedHunks.map(({ file }) => file)),
  ];
  const triggerRiskSignals = summarizeChange(
    rawDiff,
    materiallyChangedPaths,
    omitted,
    materiallyChangedHunks,
  ).riskSignals;
  const preliminaryProfile = {
    ...summarizeChange(rawDiff, rawPaths, omitted, rawHunks),
    riskSignals: triggerRiskSignals,
  };
  const riskEscalated = triggerRiskSignals.length > 0;
  const eligibleParsed = parsedHunks.filter(
    (hunk) =>
      params.force ||
      (!ignored(hunk.file) &&
        (riskEscalated || hunkHasSemanticChange(hunk))),
  );
  const eligibleHunkIds = new Set(eligibleParsed.map(({ hunkId }) => hunkId));
  const eligibleHunks = rawHunks.filter(({ hunkId }) => eligibleHunkIds.has(hunkId));
  const skippedHunks = rawHunks.filter(({ hunkId }) => !eligibleHunkIds.has(hunkId));
  const skippedPaths = rawPaths.filter(
    (path) => !eligibleHunks.some((hunk) => hunk.file === path),
  );
  const coverage = decideReviewCoverage({
    force: params.force,
    riskSignals: triggerRiskSignals,
    hunks: eligibleHunks,
    baseline,
    skippedHunkIds: skippedHunks.map(({ hunkId }) => hunkId),
    skippedPaths,
  });
  const reviewedIds = new Set(coverage.reviewedHunkIds);
  const selectedParsed = eligibleParsed.filter(({ hunkId }) =>
    reviewedIds.has(hunkId),
  );
  const selectedHunks = eligibleHunks.filter(({ hunkId }) =>
    reviewedIds.has(hunkId),
  );
  const selectedPaths = [...new Set(selectedHunks.map(({ file }) => file))];
  const selectedDiff = renderSelectedDiff(selectedParsed, reviewedIds);
  const labels = (pr.labels ?? [])
    .map(({ name }) => name?.trim())
    .filter((name): name is string => Boolean(name));
  const config = JSON.stringify({
    promptVersion: env.AI_REVIEW_PROMPT_VERSION,
    openRouterScouts: settings.openRouterScouts,
    openCodeScouts: settings.openCodeScouts,
    openRouterScoutMaxPrices: OPENROUTER_SCOUT_MAX_PRICES,
    merger: settings.merger,
    requireZdr: settings.requireZdr,
    scoutSystem,
    scoutSchema,
    statefulMergerSystem,
    statefulMergerSchema,
    guardrails: guardrailPolicy(env),
  });
  const context = selectedDiff.trim()
    ? await reviewer.fileContext(selectedPaths, headSha)
    : "";
  const guidelines = selectedDiff.trim() ? await reviewer.headGuidelines(headSha) : "";
  const reviewContext = selectedDiff.trim()
    ? await reviewer.pullRequestReviewContext(selectedPaths)
    : { threads: "", reviewers: [] };
  return {
    baseSha: pr.base?.sha,
    headSha,
    diffFingerprint: await sha256(rawDiff),
    configFingerprint: await sha256(config),
    ...(coverage.mode === "skipped" ? { skipReason: coverage.reason } : {}),
    diff: selectedDiff,
    fullDiff: rawDiff,
    paths: selectedPaths,
    omitted,
    hunks: selectedHunks,
    allHunks: rawHunks,
    coverage,
    changeProfile: {
      ...preliminaryProfile,
      reviewableFiles: new Set(eligibleHunks.map(({ file }) => file)).size,
      omittedFiles: omitted.length + skippedPaths.length,
      hunks: eligibleHunks.length,
    },
    pullRequest: {
      author: pr.user.login,
      authorAssociation: pr.author_association,
      title: pr.title,
      labels,
      headRef: pr.head.ref,
      taskType: inferPullRequestTaskType({
        author: pr.user.login,
        headRef: pr.head.ref,
        labels,
        title: pr.title,
      }),
      originatingAgent: inferOriginatingAgent({
        headRef: pr.head.ref,
        title: pr.title,
      }),
      reviewers: reviewContext.reviewers,
    },
    context,
    guidelines,
    replayFindings: baseline.openFindings.filter((finding) =>
      coverage.affectedFindingIds.includes(finding.findingId),
    ),
    priorOpenFindings: baseline.openFindings,
    threads: selectedDiff.trim()
      ? [
          affectedFindingContext(baseline, coverage),
          reviewContext.threads,
        ]
          .filter(Boolean)
          .join("\n\n")
      : "",
  };
}

export async function claimReview(
  env: Env,
  params: ReviewWorkflowParams,
  instanceId: string,
  prepared: PreparedReview,
): Promise<ClaimResponse> {
  if (
    !prepared.headSha ||
    !prepared.diffFingerprint ||
    !prepared.configFingerprint
  ) {
    throw new Error("Cannot claim an unprepared review");
  }
  return coordinatorRequest<ClaimResponse>(env, params, "/reviews/claim", {
    runId: instanceId,
    headSha: prepared.headSha,
    diffFingerprint: prepared.diffFingerprint,
    configFingerprint: prepared.configFingerprint,
    force: params.force,
    maxRuns: finiteNumber(env.AI_REVIEW_MAX_RUNS_PER_PR, 20),
    maxCostUsd: finiteNumber(env.AI_REVIEW_MAX_PR_COST_USD, 5),
  });
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

const MODEL_RELIABILITY_COORDINATOR = "__ai-review-model-reliability__";

function isCircuitSkippedModel(value: unknown): value is CircuitSkippedModel {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const decision = value as Partial<CircuitSkippedModel>;
  return (
    typeof decision.model === "string" &&
    (decision.provider === "openrouter" || decision.provider === "opencode") &&
    typeof decision.consecutiveFailures === "number" &&
    Number.isSafeInteger(decision.consecutiveFailures) &&
    decision.consecutiveFailures > 0 &&
    typeof decision.cooldownUntil === "string" &&
    !Number.isNaN(Date.parse(decision.cooldownUntil))
  );
}

function scoutIdentity({ model, provider }: Pick<Scout, "model" | "provider">) {
  return `${provider}\0${model}`;
}

async function plannedCircuitSkips(
  env: Env,
  scouts: Scout[],
): Promise<CircuitSkippedModel[]> {
  if (!env.PR_STATE || scouts.length === 0) return [];
  try {
    const stub = env.PR_STATE.get(
      env.PR_STATE.idFromName(MODEL_RELIABILITY_COORDINATOR),
    );
    const response = await stub.fetch(
      "https://coordinator.internal/models/plan",
      {
        method: "POST",
        body: JSON.stringify({ models: scouts }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) throw new Error(`model plan failed (${response.status})`);
    const result = (await response.json()) as { skipped?: unknown };
    if (!Array.isArray(result.skipped)) return [];
    const requestedScouts = new Set(scouts.map(scoutIdentity));
    return result.skipped.filter(
      (decision): decision is CircuitSkippedModel =>
        isCircuitSkippedModel(decision) &&
        requestedScouts.has(scoutIdentity(decision)),
    );
  } catch (error) {
    console.error("Could not load model circuit-breaker state", {
      type: error instanceof Error ? error.name : typeof error,
    });
    return [];
  }
}

async function recordModelReliability(
  env: Env,
  observationId: string,
  metrics: ModelMetric[],
): Promise<void> {
  if (!env.PR_STATE || metrics.length === 0) return;
  const attempted = metrics.filter(({ skipped }) => !skipped);
  if (attempted.length === 0) return;
  try {
    const stub = env.PR_STATE.get(
      env.PR_STATE.idFromName(MODEL_RELIABILITY_COORDINATOR),
    );
    const response = await stub.fetch(
      "https://coordinator.internal/models/record",
      {
        method: "POST",
        body: JSON.stringify({
          observationId,
          policy: guardrailPolicy(env).reliability,
          metrics: attempted.map(({ model, provider, ok, error }) => ({
            model,
            provider,
            ok,
            error,
          })),
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) {
      throw new Error(`model reliability record failed (${response.status})`);
    }
  } catch (error) {
    // Model calls are not idempotent. Do not replay paid inference merely
    // because the health observation could not be written.
    console.error("Could not record model circuit-breaker state", {
      type: error instanceof Error ? error.name : typeof error,
    });
  }
}

function validateScoutPayload(
  payload: JsonObject,
  allowedFiles: Set<string>,
): {
  accepted: Finding[];
  invalidCount: number;
  outOfScopeCount: number;
} {
  const structurallyValid = validateFindings(payload, {
    merged: false,
  }) as Finding[];
  const accepted = structurallyValid.filter((finding) =>
    allowedFiles.has(finding.file),
  );
  const rawCount = Array.isArray(payload.findings)
    ? payload.findings.length
    : 0;
  return {
    accepted,
    invalidCount: rawCount - structurallyValid.length,
    outOfScopeCount: structurallyValid.length - accepted.length,
  };
}

async function prepareScoutRoster(
  env: Env,
  reviewer: Reviewer,
  settings: Settings,
  providers: Set<Scout["provider"]>,
  isolated: boolean,
) {
  const availability = providers.has("opencode")
    ? await reviewer.openCodeScoutModels()
    : { models: [], unavailable: [] };
  const duplicateModels = duplicateScoutModels(
    settings.openRouterScouts,
    [...availability.models, ...availability.unavailable],
  );
  if (duplicateModels.length > 0) {
    throw new Error(
      `Scout model IDs must be unique across providers: ${duplicateModels.join(", ")}`,
    );
  }
  const configuredScouts: Scout[] = [];
  if (providers.has("openrouter")) {
    configuredScouts.push(...settings.openRouterScouts.map(
      (model): Scout => ({ model, provider: "openrouter" }),
    ));
  }
  if (providers.has("opencode")) {
    configuredScouts.push(...availability.models.map(
      (model): Scout => ({ model, provider: "opencode" }),
    ));
  }
  const unavailableScouts: Scout[] = availability.unavailable.map((model) => ({
    model,
    provider: "opencode",
  }));
  const circuitSkipped = isolated
    ? []
    : await plannedCircuitSkips(env, [...configuredScouts, ...unavailableScouts]);
  const skippedScouts = new Set(circuitSkipped.map(scoutIdentity));
  return {
    availability,
    circuitSkipped,
    configuredScouts,
    runnableScouts: configuredScouts.filter(
      (scout) => !skippedScouts.has(scoutIdentity(scout)),
    ),
  };
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing function predates the complexity limit; new violations remain prohibited.
export async function runScouts(
  env: Env,
  params: ReviewWorkflowParams,
  prepared: PreparedReview,
  options: ScoutRunOptions = {},
): Promise<ScoutRun> {
  if (!prepared.diff || !prepared.headSha) {
    throw new Error("Cannot run scouts without a prepared diff");
  }
  const settings = modelSettings(env, params, "not-used-for-model-calls");
  const reviewer = new Reviewer(settings);
  const providers = new Set(
    options.providers ?? (["openrouter", "opencode"] as const),
  );
  const { availability, circuitSkipped, configuredScouts, runnableScouts } =
    await prepareScoutRoster(
      env,
      reviewer,
      settings,
      providers,
      options.isolated === true,
    );
  const skippedScouts = new Set(circuitSkipped.map(scoutIdentity));
  const isSkipped = (scout: Scout) => skippedScouts.has(scoutIdentity(scout));
  const models = [
    ...configuredScouts.map(({ model }) => model),
    ...availability.unavailable,
  ];
  const source = dataPrompt(
    prepared.diff,
    prepared.context ?? "",
    prepared.guidelines ?? "",
  );
  const scoutCallOptions =
    options.maxTokens !== undefined || options.timeoutMs !== undefined
      ? { maxTokens: options.maxTokens, timeoutMs: options.timeoutMs }
      : undefined;
  const settled: Array<{
    scout: Scout;
    latencyMs: number;
    outcome: PromiseSettledResult<ModelResult>;
  }> = [];
  for (let offset = 0; offset < runnableScouts.length; offset += SCOUT_CONCURRENCY) {
    const batch = runnableScouts.slice(offset, offset + SCOUT_CONCURRENCY);
    const started = batch.map(() => Date.now());
    const callScout = ({ model, provider }: Scout) => {
      const args = [model, options.systemPrompt ?? scoutSystem, source] as const;
      if (provider === "openrouter") {
        if (scoutCallOptions) return reviewer.callOpenRouterScout(...args, scoutCallOptions);
        return reviewer.callOpenRouterScout(...args);
      }
      if (scoutCallOptions) return reviewer.callOpenCodeScout(...args, scoutCallOptions);
      return reviewer.callOpenCodeScout(...args);
    };
    const outcomes = await Promise.allSettled(batch.map(callScout));
    batch.forEach((scout, index) => {
      const outcome = outcomes[index];
      if (outcome) {
        settled.push({
          scout,
          latencyMs: Date.now() - (started[index] ?? Date.now()),
          outcome,
        });
      }
    });
  }

  const candidates: Record<string, Finding[]> = {};
  const costs: Record<string, number> = {};
  const invalidCounts: Record<string, number> = {};
  const outOfScopeCounts: Record<string, number> = {};
  const candidateCounts: Record<string, number> = {};
  const failed = availability.unavailable.filter(
    (model) => !isSkipped({ model, provider: "opencode" }),
  );
  const metrics: ModelMetric[] = [
    ...circuitSkipped.map((decision) => ({
      model: decision.model,
      provider: decision.provider,
      role: "scout" as const,
      ok: false,
      skipped: true,
      consecutiveFailures: decision.consecutiveFailures,
      cooldownUntil: decision.cooldownUntil,
      latencyMs: 0,
      costUsd: 0,
      error: "model skipped during circuit-breaker cooldown",
    })),
    ...availability.unavailable
      .filter((model) => !isSkipped({ model, provider: "opencode" }))
      .map((model) => ({
        model,
        provider: "opencode" as const,
        role: "scout" as const,
        ok: false,
        latencyMs: 0,
        costUsd: 0,
        error: "model is unavailable in the live OpenCode catalogue",
      })),
  ];
  const allowedFiles = new Set(prepared.paths);
  for (const { scout, latencyMs, outcome } of settled) {
    if (outcome.status === "rejected") {
      failed.push(scout.model);
      metrics.push({
        ...scout,
        role: "scout",
        ok: false,
        latencyMs,
        costUsd: 0,
        error: errorMessage(outcome.reason),
      });
      continue;
    }
    costs[scout.model] = outcome.value.cost;
    metrics.push({
      ...scout,
      role: "scout",
      ok: true,
      latencyMs,
      costUsd: outcome.value.cost,
      usage: outcome.value.usage,
    });
    try {
      const { accepted, invalidCount, outOfScopeCount } = validateScoutPayload(
        outcome.value.payload,
        allowedFiles,
      );
      invalidCounts[scout.model] = invalidCount;
      outOfScopeCounts[scout.model] = outOfScopeCount;
      candidateCounts[scout.model] = accepted.length;
      candidates[scout.model] = accepted;
    } catch (error) {
      failed.push(scout.model);
      invalidCounts[scout.model] = 1;
      outOfScopeCounts[scout.model] = 0;
      candidateCounts[scout.model] = 0;
      const metric = metrics.at(-1);
      if (metric) {
        metric.ok = false;
        metric.error = errorMessage(error);
      }
    }
  }
  if (!options.isolated) {
    await recordModelReliability(
      env,
      options.observationId ??
        `${params.deliveryId}:${[...providers]
          .sort((a, b) => a.localeCompare(b))
          .join(",")}`,
      metrics,
    );
  }
  return {
    models,
    candidates,
    failed,
    candidateCounts,
    invalidCounts,
    outOfScopeCounts,
    costs,
    metrics,
    circuitSkipped,
  };
}

export function combineScoutRuns(...runs: ScoutRun[]): ScoutRun {
  return {
    models: runs.flatMap(({ models }) => models),
    candidates: Object.assign({}, ...runs.map(({ candidates }) => candidates)),
    failed: runs.flatMap(({ failed }) => failed),
    candidateCounts: Object.assign(
      {},
      ...runs.map(({ candidateCounts }) => candidateCounts),
    ),
    invalidCounts: Object.assign(
      {},
      ...runs.map(({ invalidCounts }) => invalidCounts),
    ),
    outOfScopeCounts: Object.assign(
      {},
      ...runs.map(({ outOfScopeCounts }) => outOfScopeCounts),
    ),
    costs: Object.assign({}, ...runs.map(({ costs }) => costs)),
    metrics: runs.flatMap(({ metrics }) => metrics),
    circuitSkipped: runs.flatMap(({ circuitSkipped }) => circuitSkipped ?? []),
  };
}

function normalizeMergedPayload(
  payload: JsonObject,
  prepared: PreparedReview,
  scoutModels: string[],
): void {
  const allowedFiles = new Set(prepared.paths);
  payload.findings = (
    validateFindings(payload, {
      merged: true,
      allowedFiles,
    }) as MergedFinding[]
  )
    .map((finding) => ({
      ...finding,
      source_models: [
        ...new Set(
          finding.source_models.filter((model) => scoutModels.includes(model)),
        ),
      ],
    }))
    .filter((finding) => finding.source_models.length > 0);
  const replayIds = new Set(
    (prepared.replayFindings ?? []).map(({ findingId }) => findingId),
  );
  const seenResolutionIds = new Set<string>();
  payload.finding_resolutions = Array.isArray(payload.finding_resolutions)
    ? payload.finding_resolutions.filter((resolution): boolean => {
        if (
          typeof resolution !== "object" ||
          resolution === null ||
          !("finding_id" in resolution) ||
          typeof resolution.finding_id !== "string" ||
          !replayIds.has(resolution.finding_id) ||
          seenResolutionIds.has(resolution.finding_id) ||
          !("verdict" in resolution) ||
          !["fixed", "still-present", "uncertain"].includes(
            String(resolution.verdict),
          ) ||
          !("evidence" in resolution) ||
          typeof resolution.evidence !== "string" ||
          resolution.evidence.trim().length === 0
        ) {
          return false;
        }
        seenResolutionIds.add(resolution.finding_id);
        return true;
      })
        .map((resolution) => ({
          ...resolution,
          evidence: String(resolution.evidence).slice(0, 2_000),
        }))
    : [];
  if (seenResolutionIds.size !== replayIds.size) {
    throw new Error(
      "Merger omitted or invalidated a required controlled replay resolution",
    );
  }
}

function mergerPrompt(prepared: PreparedReview, scouts: ScoutRun): string {
  return `<DATA kind=scout-candidates>
${JSON.stringify(scouts.candidates)}
</DATA>
<DATA kind=durable-open-findings-for-controlled-replay>
${JSON.stringify(prepared.replayFindings ?? [])}
</DATA>
<DATA kind=current-reviewed-diff>
${prepared.diff ?? ""}
</DATA>
<DATA kind=current-file-context>
${prepared.context ?? ""}
</DATA>
<DATA kind=github-review-threads>
${prepared.threads ?? ""}
</DATA>`;
}

export function estimateMergeCostCeilingUsd(
  env: Env,
  params: ReviewWorkflowParams,
  prepared: PreparedReview,
  scouts: ScoutRun,
  options: MergeRunOptions = {},
): number | undefined {
  const settings = modelSettings(env, params, "not-used-for-model-calls");
  const prices = OPENROUTER_MERGER_MAX_PRICES[settings.merger];
  if (!prices) return undefined;
  const requestText = [
    options.systemPrompt ?? statefulMergerSystem,
    JSON.stringify(statefulMergerSchema),
    mergerPrompt(prepared, scouts),
  ].join("\n");
  const promptTokenCeiling = new TextEncoder().encode(requestText).length;
  return (
    promptTokenCeiling * prices.prompt +
    (options.maxTokens ?? MERGER_MAX_TOKENS) * prices.completion
  ) / 1_000_000;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing function predates the complexity limit; new violations remain prohibited.
export async function mergeFindings(
  env: Env,
  params: ReviewWorkflowParams,
  prepared: PreparedReview,
  scouts: ScoutRun,
  options: MergeRunOptions = {},
): Promise<MergedRun> {
  if (Object.keys(scouts.candidates).length === 0) {
    const findingResolutions = (prepared.replayFindings ?? []).map(
      ({ findingId }) => ({
        finding_id: findingId,
        verdict: "uncertain" as const,
        evidence: "No scout produced coverage, so controlled replay could not be evaluated.",
      }),
    );
    return {
      result: {
        summary:
          "All scouts failed or were unavailable, so this run has no review coverage.",
        findings: [],
        ...(findingResolutions.length > 0
          ? { finding_resolutions: findingResolutions }
          : {}),
      },
      cost: 0,
    };
  }
  const settings = modelSettings(env, params, "not-used-for-model-calls");
  const reviewer = new Reviewer(settings);
  const circuitSkip = options.isolated
    ? undefined
    : (await plannedCircuitSkips(env, [{
        model: settings.merger,
        provider: "openrouter",
      }]))[0];
  if (circuitSkip) {
    const findingResolutions = (prepared.replayFindings ?? []).map(
      ({ findingId }) => ({
        finding_id: findingId,
        verdict: "uncertain" as const,
        evidence: "The merger was in circuit-breaker cooldown, so controlled replay could not be evaluated.",
      }),
    );
    return {
      result: {
        summary:
          "The merger was in circuit-breaker cooldown, so this run has no publishable findings.",
        findings: [],
        ...(findingResolutions.length > 0
          ? { finding_resolutions: findingResolutions }
          : {}),
      },
      cost: 0,
      metric: {
        model: circuitSkip.model,
        provider: circuitSkip.provider,
        role: "merger",
        ok: false,
        skipped: true,
        consecutiveFailures: circuitSkip.consecutiveFailures,
        cooldownUntil: circuitSkip.cooldownUntil,
        latencyMs: 0,
        costUsd: 0,
        error: "model skipped during circuit-breaker cooldown",
      },
    };
  }
  const prompt = mergerPrompt(prepared, scouts);
  const started = Date.now();
  let merged: ModelResult | undefined;
  try {
    const mergerArguments = [
      settings.merger,
      options.systemPrompt ?? statefulMergerSystem,
      prompt,
      "merged_code_review",
      statefulMergerSchema,
      options.maxTokens ?? MERGER_MAX_TOKENS,
    ] as const;
    merged = options.timeoutMs === undefined
      ? await reviewer.callMerger(...mergerArguments)
      : await reviewer.callMerger(...mergerArguments, options.timeoutMs);
    const contributingScoutModels = Object.entries(scouts.candidates)
      .filter(([, findings]) => findings.length > 0)
      .map(([model]) => model);
    normalizeMergedPayload(
      merged.payload,
      prepared,
      contributingScoutModels,
    );
  } catch (error) {
    const costUsd = merged?.cost ?? 0;
    if (!options.isolated) {
      await recordModelReliability(
        env,
        options.observationId ?? `${params.deliveryId}:merger`,
        [{
          model: settings.merger,
          provider: "openrouter",
          role: "merger",
          ok: false,
          latencyMs: Date.now() - started,
          costUsd,
          error: errorMessage(error),
        }],
      );
    }
    if (costUsd > 0) {
      throw new MergerOutputError(errorMessage(error), costUsd);
    }
    throw error;
  }
  const metric: ModelMetric = {
    model: settings.merger,
    provider: "openrouter",
    role: "merger",
    ok: true,
    latencyMs: Date.now() - started,
    costUsd: merged.cost,
    usage: merged.usage,
  };
  if (!options.isolated) {
    await recordModelReliability(
      env,
      options.observationId ?? `${params.deliveryId}:merger`,
      [metric],
    );
  }
  return {
    result: merged.payload,
    cost: merged.cost,
    metric,
  };
}

export async function publishReview(
  env: Env,
  params: ReviewWorkflowParams,
  prepared: PreparedReview,
  scouts: ScoutRun,
  merged: MergedRun,
  artifacts: IdentifiedReviewArtifacts,
  previousState: ReviewState,
): Promise<ReviewPublication> {
  if (!prepared.headSha) throw new Error("Cannot publish an unprepared review");
  const token = await installationToken(env);
  const settings = modelSettings(env, params, token);
  const reviewer = new Reviewer(settings);
  const currentHead = (await reviewer.getPr()).head.sha;
  if (currentHead !== prepared.headSha) {
    throw new Error(
      `PR head changed during review (${prepared.headSha.slice(0, 12)} -> ${currentHead.slice(0, 12)}); refusing stale comment`,
    );
  }
  const existing = await reviewer.existingComment(
    STATEFUL_REVIEW_MARKER,
    new Set([env.AI_REVIEW_APP_BOT_LOGIN]),
  );
  const runCostUsd =
    Object.values(scouts.costs).reduce((total, cost) => total + cost, 0) +
    merged.cost;
  const findingPublications = await publishFindingComments({
    token,
    repository: params.repository,
    pullRequestNumber: params.pullRequestNumber,
    botLogin: env.AI_REVIEW_APP_BOT_LOGIN,
    headSha: prepared.headSha,
    findings: artifacts.publishedFindings,
    hunks: artifacts.hunks,
  });
  const fallback = renderFallbackFindings(
    artifacts.publishedFindings,
    findingPublications,
  );
  const openFindingIds = new Set(
    artifacts.publishedFindings
      .filter(({ status }) => status === "open")
      .map(({ findingId }) => findingId),
  );
  const reviewSummary =
    typeof merged.result.summary === "string"
      ? merged.result.summary
      : "Review complete.";
  const policy = guardrailPolicy(env);
  const summaryParts = [
    prepared.coverage ? coverageStatement(prepared.coverage) : undefined,
    reviewSummary,
    "Advisory review: investigate each finding before making a merge decision.",
    params.force ? `Active guardrails: ${manualGuardrailStatement(policy)}` : undefined,
    artifacts.hiddenFindings?.length
      ? `Publication guardrails withheld ${artifacts.hiddenFindings.length} finding(s). Raw scout candidates remain in the versioned review record.`
      : undefined,
    scouts.circuitSkipped?.length
      ? `Incomplete model coverage: circuit-breaker cooldown skipped ${scouts.circuitSkipped
          .map(({ model }) => model)
          .join(", ")}.`
      : undefined,
    merged.metric?.skipped
      ? `Incomplete model coverage: merger ${merged.metric.model} was skipped during circuit-breaker cooldown.`
      : undefined,
  ].filter((part): part is string => Boolean(part));
  const result = {
    ...merged.result,
    summary: summaryParts.join("\n\n"),
  };
  const body = renderComment({
    result,
    headSha: prepared.headSha,
    models: scouts.models,
    merger: settings.merger,
    failed: scouts.failed,
    candidateCounts: scouts.candidateCounts,
    invalidCounts: scouts.invalidCounts,
    outOfScopeCounts: scouts.outOfScopeCounts,
    modelCosts: scouts.costs,
    mergerCost: merged.cost,
    omitted: prepared.omitted,
    runCost: runCostUsd,
    previousState:
      existing.id !== undefined ? existing.state : previousState,
    marker: STATEFUL_REVIEW_MARKER,
    heading: "## Stateful AI code review",
    summaryOnly: true,
    findingDelivery: {
      line: findingPublications.filter(({ delivery }) => delivery === "line")
        .filter(({ findingId }) => openFindingIds.has(findingId)).length,
      fallback: findingPublications.filter(
        ({ delivery, findingId }) =>
          delivery === "fallback" && openFindingIds.has(findingId),
      ).length,
    },
  });
  return {
    commentId: await reviewer.writeComment(
      existing.id,
      fallback ? `${body}\n\n${fallback}` : body,
    ),
    runCostUsd,
    findings: findingPublications,
  };
}

export async function publishSkippedReview(
  env: Env,
  params: ReviewWorkflowParams,
  prepared: PreparedReview,
): Promise<ReviewPublication> {
  if (!prepared.headSha || !prepared.coverage) {
    throw new Error("Cannot publish skipped coverage for an unprepared review");
  }
  const token = await installationToken(env);
  const reviewer = new Reviewer(modelSettings(env, params, token));
  const currentHead = (await reviewer.getPr()).head.sha;
  if (currentHead !== prepared.headSha) {
    throw new Error("PR head changed before skipped coverage could be published");
  }
  const existing = await reviewer.existingComment(
    STATEFUL_REVIEW_MARKER,
    new Set([env.AI_REVIEW_APP_BOT_LOGIN]),
  );
  const statement = coverageStatement(prepared.coverage);
  const headStatus = [
    "<!-- ai-review-coverage-head -->",
    `Head \`${prepared.headSha.slice(0, 12)}\` did not require model review.`,
  ].join("\n");
  let body = existing.body;
  if (body) {
    const coveragePattern = /\*\*Coverage: (?:Full|Incremental|Skipped) coverage\.\*\*[^\n]*/;
    body = coveragePattern.test(body)
      ? body.replace(coveragePattern, statement)
      : body.replace(
          "## Stateful AI code review",
          `## Stateful AI code review\n\n${statement}`,
        );
    const headPattern = /<!-- ai-review-coverage-head -->\n[^\n]*/;
    body = headPattern.test(body)
      ? body.replace(headPattern, headStatus)
      : `${body}\n\n${headStatus}`;
  } else {
    body = [
      STATEFUL_REVIEW_MARKER,
      `<!-- ai-review-cost:${JSON.stringify(existing.state)} -->`,
      "## Stateful AI code review",
      "",
      statement,
      "",
      headStatus,
    ].join("\n");
  }
  return {
    commentId: await reviewer.writeComment(existing.id, body),
    runCostUsd: 0,
    findings: [],
  };
}

export async function recordReview(options: {
  env: Env;
  params: ReviewWorkflowParams;
  instanceId: string;
  prepared: PreparedReview;
  scouts: ScoutRun;
  merged: MergedRun;
  artifacts: IdentifiedReviewArtifacts;
  publication: ReviewPublication;
  timestamp: Date;
}): Promise<void> {
  if (!options.prepared.headSha) {
    throw new Error("Cannot record an unprepared review");
  }
  await recordReviewTerminal({ ...options, status: "published" });
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing function predates the complexity limit; new violations remain prohibited.
export async function recordReviewTerminal(options: {
  env: Env;
  params: ReviewWorkflowParams;
  instanceId: string;
  status: ReviewRecordStatus;
  timestamp: Date;
  prepared?: PreparedReview;
  scouts?: ScoutRun;
  merged?: MergedRun;
  artifacts?: IdentifiedReviewArtifacts;
  publication?: ReviewPublication;
  reason?: string;
  error?: string;
  failedPhase?: string;
  incurredCostUsd?: number;
}): Promise<void> {
  const {
    env,
    params,
    instanceId,
    status,
    timestamp,
    prepared,
    scouts,
    merged,
    artifacts,
    publication,
  } = options;
  const headSha = prepared?.headSha ?? params.headSha ?? "unknown-head";
  const key = reviewRunTerminalKey({
    repository: params.repository,
    pullRequestNumber: params.pullRequestNumber,
    headSha,
    instanceId,
    status,
  });
  const summary =
    merged && typeof merged.result.summary === "string"
      ? merged.result.summary
      : undefined;
  await env.REVIEW_DATA.put(
    key,
    JSON.stringify({
      schemaVersion: 2,
      recordType: "review-run-terminal",
      status,
      repository: params.repository,
      pullRequestNumber: params.pullRequestNumber,
      headSha,
      diffFingerprint: prepared?.diffFingerprint,
      configFingerprint: prepared?.configFingerprint,
      promptVersion: env.AI_REVIEW_PROMPT_VERSION,
      reviewerConfiguration: {
        openRouterScouts: csv(env.AI_REVIEW_MODELS, DEFAULT_OPENROUTER_SCOUTS),
        openCodeScouts: csv(env.AI_REVIEW_OPENCODE_MODELS, []),
        merger: env.AI_REVIEW_MERGER_MODEL?.trim() || DEFAULT_MERGER,
        requireZeroDataRetention: ["1", "true", "yes", "on"].includes(
          env.AI_REVIEW_ZDR?.trim().toLowerCase() ?? "",
        ),
      },
      guardrailPolicy: guardrailPolicy(env),
      trigger: {
        deliveryId: params.deliveryId,
        eventName: params.eventName,
        action: params.action,
        force: params.force,
        webhookHeadSha: params.headSha,
      },
      pullRequest: prepared?.pullRequest,
      change: prepared?.changeProfile,
      coverage: prepared
        ? {
            ...prepared.coverage,
            paths: prepared.paths,
            omitted: prepared.omitted,
          }
        : undefined,
      hunks: artifacts?.hunks ?? prepared?.hunks ?? [],
      candidates: artifacts?.candidates ?? {},
      findings:
        summary !== undefined || artifacts
          ? {
              summary,
              published: artifacts?.publishedFindings ?? [],
              hidden: artifacts?.hiddenFindings ?? [],
            }
          : undefined,
      models: scouts
        ? [...scouts.metrics, ...(merged?.metric ? [merged.metric] : [])]
        : [],
      runCostUsd: publication?.runCostUsd ?? options.incurredCostUsd ?? 0,
      commentId: publication?.commentId,
      findingPublications: publication?.findings ?? [],
      terminal: {
        reason: options.reason,
        error: options.error,
        failedPhase: options.failedPhase,
      },
      workflow: {
        instanceId,
        triggeredAt: timestamp.toISOString(),
        recordedAt: new Date().toISOString(),
      },
    }),
    { httpMetadata: { contentType: "application/json" } },
  );
  if (prepared?.baseSha && prepared.fullDiff !== undefined) {
    await persistReplayInput({
      env,
      params,
      instanceId,
      status,
      prepared,
      timestamp,
      prompt: {
        version: env.AI_REVIEW_PROMPT_VERSION,
        scoutSystem,
        scoutSchema,
        mergerSystem: statefulMergerSystem,
        mergerSchema: statefulMergerSchema,
      },
      modelSettings: {
        openRouterScouts: csv(env.AI_REVIEW_MODELS, DEFAULT_OPENROUTER_SCOUTS),
        openCodeScouts: csv(env.AI_REVIEW_OPENCODE_MODELS, []),
        merger: env.AI_REVIEW_MERGER_MODEL?.trim() || DEFAULT_MERGER,
        requireZeroDataRetention: ["1", "true", "yes", "on"].includes(
          env.AI_REVIEW_ZDR?.trim().toLowerCase() ?? "",
        ),
        scoutMaxTokens: 8_000,
        mergerMaxTokens: MERGER_MAX_TOKENS,
        openRouterScoutMaxPrices: OPENROUTER_SCOUT_MAX_PRICES,
      },
      policy: guardrailPolicy(env),
    });
  }
}

export async function completeReview(
  env: Env,
  params: ReviewWorkflowParams,
  instanceId: string,
  prepared: PreparedReview,
  merged: MergedRun,
  artifacts: IdentifiedReviewArtifacts,
  publication: ReviewPublication,
): Promise<void> {
  const findingResolutions = Array.isArray(merged.result.finding_resolutions)
    ? merged.result.finding_resolutions.map((resolution) => {
        const record = resolution as {
          finding_id: string;
          verdict: FindingResolution["verdict"];
          evidence: string;
        };
        return {
          findingId: record.finding_id,
          verdict: record.verdict,
          evidence: record.evidence,
        };
      })
    : [];
  await coordinatorRequest(env, params, "/reviews/complete", {
    repository: params.repository,
    pullRequestNumber: params.pullRequestNumber,
    runId: instanceId,
    headSha: prepared.headSha,
    costUsd: publication.runCostUsd,
    commentId: publication.commentId,
    findingPublications: publication.findings,
    hunks: artifacts.hunks,
    currentHunks: prepared.allHunks ?? artifacts.hunks,
    findings: artifacts.publishedFindings,
    findingResolutions,
  });
}

export async function failReview(
  env: Env,
  params: ReviewWorkflowParams,
  instanceId: string,
  error: unknown,
  costUsd = 0,
): Promise<void> {
  await coordinatorRequest(env, params, "/reviews/fail", {
    runId: instanceId,
    error: errorMessage(error),
    costUsd,
  });
}
