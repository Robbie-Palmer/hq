import { createHash } from "node:crypto";
import { fetchWithRetry } from "ts-base/http";
import { z } from "zod";
import { ruleDataset } from "./data";
import type { RuleDataset } from "./schema";

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

const contentItemSchema = z.object({
  base_path: z.string().startsWith("/"),
  content_id: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  details: z.record(z.string(), z.unknown()).nullable().optional(),
  document_type: z.string(),
  first_published_at: z.string(),
  links: z.record(z.string(), z.unknown()),
  public_updated_at: z.string(),
  schema_name: z.string(),
  title: z.string().nullable().optional(),
  updated_at: z.string(),
  withdrawn_notice: z.record(z.string(), z.unknown()).nullable().optional(),
});

type JsonPrimitive = string | number | boolean | null;
type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export type GovUkSourceSpec = {
  id: string;
  title: string;
  pageUrl: string;
  contentApiUrl: string;
  ruleIds: string[];
  effectivePeriods: Array<{ from: string; to: string }>;
  defaultCheckIntervalHours: number;
};

export type GovUkContentSnapshot = {
  fingerprint: string;
  metadata: {
    basePath: string;
    contentId: string | null;
    description: string | null;
    documentType: string;
    firstPublishedAt: string;
    publicUpdatedAt: string;
    schemaName: string;
    title: string | null;
    withdrawnNotice: JsonValue;
  };
  details: JsonValue;
  documentLinks: string[];
};

export type GovUkMonitorState = {
  schemaVersion: 1;
  lastSuccessfulCheckAt: string | null;
  sources: Record<
    string,
    {
      lastSuccessfulCheckAt: string;
      snapshot: GovUkContentSnapshot;
    }
  >;
};

export type SourceChange = {
  area: "content" | "document-link" | "metadata";
  path: string;
  before: string | null;
  after: string | null;
};

export type RuleUpdateProposal = {
  id: string;
  sourceId: string;
  sourceTitle: string;
  pageUrl: string;
  affectedRuleIds: string[];
  changes: SourceChange[];
  dates: {
    publicationDate: string;
    detectedDate: string;
    potentialEffectivePeriods: Array<{ from: string; to: string }>;
    reviewedEffectiveDate: null;
    activationDate: null;
  };
  timing:
    | "future-announcement"
    | "historical-correction-candidate"
    | "current-or-unknown";
  activationGate: {
    status: "review-and-validation-required";
    activeDatasetVersion: string;
    validationCommand: string;
    previousArtifactMustRemain: string;
  };
  candidateSnapshot: GovUkContentSnapshot;
};

export type GovUkMonitorReport = {
  checkedAt: string;
  status: "changes-detected" | "degraded" | "unchanged";
  checkedSourceIds: string[];
  cachedSourceIds: string[];
  proposals: RuleUpdateProposal[];
  failures: Array<{ sourceId: string; message: string }>;
  state: GovUkMonitorState;
};

type MonitorOptions = {
  reviewedSnapshots: Record<string, GovUkContentSnapshot>;
  previousState?: GovUkMonitorState;
  fetchImpl?: typeof fetch;
  checkedAt?: string;
  attempts?: number;
  checkIntervalHours?: number;
};

const canonicalJson = (value: JsonValue): string => JSON.stringify(value);
const compareText = (left: string, right: string): number =>
  left.localeCompare(right, "en");

function normalizeJson(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Content contains a non-finite number");
    return value;
  }
  if (Array.isArray(value)) return value.map(normalizeJson);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalizeJson(item)]),
    );
  }
  throw new Error(`Content contains unsupported ${typeof value} value`);
}

function linksInString(value: string): string[] {
  return [...value.matchAll(
    /(?:href|src)=["']([^"']+)["']|https?:\/\/[^\s"'<>]+/g,
  )].flatMap((match) => {
    const candidate = match[1] ?? match[0];
    return candidate ? [candidate.replaceAll("&amp;", "&")] : [];
  });
}

function collectDocumentLinks(value: JsonValue, links: Set<string>): void {
  if (typeof value === "string") {
    for (const link of linksInString(value)) links.add(link);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectDocumentLinks(item, links);
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (
      typeof item === "string" &&
      (key === "href" || key.endsWith("_url") || key === "url")
    ) {
      links.add(item);
    }
    collectDocumentLinks(item, links);
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function snapshotGovUkContent(input: unknown): GovUkContentSnapshot {
  const item = contentItemSchema.parse(input);
  const details = normalizeJson(item.details ?? {});
  const linkedContent = normalizeJson(item.links);
  const documentLinks = new Set<string>();
  collectDocumentLinks(details, documentLinks);
  collectDocumentLinks(linkedContent, documentLinks);
  const metadata = {
    basePath: item.base_path,
    contentId: item.content_id ?? null,
    description: item.description ?? null,
    documentType: item.document_type,
    firstPublishedAt: item.first_published_at,
    publicUpdatedAt: item.public_updated_at,
    schemaName: item.schema_name,
    title: item.title ?? null,
    withdrawnNotice: normalizeJson(item.withdrawn_notice ?? {}),
  };
  const monitored = normalizeJson({
    details,
    documentLinks: [...documentLinks].toSorted(compareText),
    metadata,
  });
  return {
    fingerprint: sha256(canonicalJson(monitored)),
    metadata,
    details,
    documentLinks: [...documentLinks].toSorted(compareText),
  };
}

function govUkContentApiUrl(pageUrl: string): string {
  const url = new URL(pageUrl);
  if (url.origin !== "https://www.gov.uk") {
    throw new Error(`GOV.UK monitor source has untrusted origin ${url.origin}`);
  }
  return `https://www.gov.uk/api/content${url.pathname}`;
}

export function buildGovUkSourceRegistry(
  dataset: RuleDataset = ruleDataset,
): GovUkSourceSpec[] {
  const rules = [
    ...dataset.incomeTax,
    ...dataset.nationalInsurance,
    ...dataset.pensions,
  ];
  return dataset.sources.map((source) => {
    const supportedRules = rules.filter((rule) =>
      rule.provenance.sourceIds.includes(source.id),
    );
    if (supportedRules.length === 0) {
      throw new Error(`${source.id} does not govern a supported rule`);
    }
    return {
      id: source.id,
      title: source.title,
      pageUrl: source.url,
      contentApiUrl: govUkContentApiUrl(source.url),
      ruleIds: supportedRules.map(({ id }) => id).toSorted(compareText),
      effectivePeriods: [
        ...new Map(
          supportedRules.map(({ effectiveFrom, effectiveTo }) => [
            `${effectiveFrom}:${effectiveTo}`,
            { from: effectiveFrom, to: effectiveTo },
          ]),
        ).values(),
      ].toSorted((left, right) => left.from.localeCompare(right.from)),
      defaultCheckIntervalHours: 24 * 7,
    };
  });
}

function plainText(value: string): string {
  const decoded = value
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&");
  let result = "";
  let insideTag = false;
  let needsSpace = false;
  for (const character of decoded) {
    if (character === "<") {
      insideTag = true;
      needsSpace = result.length > 0;
      continue;
    }
    if (insideTag) {
      if (character === ">") insideTag = false;
      continue;
    }
    if (" \n\r\t\f\v".includes(character)) {
      needsSpace = result.length > 0;
      continue;
    }
    if (needsSpace) result += " ";
    result += character;
    needsSpace = false;
  }
  return result;
}

function summarize(value: JsonValue | undefined): string | null {
  if (value === undefined) return null;
  const raw =
    typeof value === "string" ? plainText(value) : JSON.stringify(value);
  return raw.length <= 240 ? raw : `${raw.slice(0, 237)}...`;
}

function diffJson(
  before: JsonValue,
  after: JsonValue,
  area: "content" | "metadata",
  path: string,
  changes: SourceChange[],
): void {
  if (changes.length >= 100 || canonicalJson(before) === canonicalJson(after)) {
    return;
  }
  if (
    before !== null &&
    after !== null &&
    typeof before === "object" &&
    typeof after === "object" &&
    !Array.isArray(before) &&
    !Array.isArray(after)
  ) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of [...keys].toSorted(compareText)) {
      const beforeValue = before[key];
      const afterValue = after[key];
      if (beforeValue === undefined || afterValue === undefined) {
        changes.push({
          area,
          path: `${path}/${key}`,
          before: summarize(beforeValue),
          after: summarize(afterValue),
        });
      } else {
        diffJson(beforeValue, afterValue, area, `${path}/${key}`, changes);
      }
    }
    return;
  }
  changes.push({
    area,
    path,
    before: summarize(before),
    after: summarize(after),
  });
}

export function diffGovUkSnapshots(
  reviewed: GovUkContentSnapshot,
  candidate: GovUkContentSnapshot,
): SourceChange[] {
  const changes: SourceChange[] = [];
  diffJson(
    normalizeJson(reviewed.metadata),
    normalizeJson(candidate.metadata),
    "metadata",
    "/metadata",
    changes,
  );
  diffJson(reviewed.details, candidate.details, "content", "/details", changes);
  const reviewedLinks = new Set(reviewed.documentLinks);
  const candidateLinks = new Set(candidate.documentLinks);
  for (const link of reviewed.documentLinks) {
    if (!candidateLinks.has(link)) {
      changes.push({
        area: "document-link",
        path: "/documentLinks",
        before: link,
        after: null,
      });
    }
  }
  for (const link of candidate.documentLinks) {
    if (!reviewedLinks.has(link)) {
      changes.push({
        area: "document-link",
        path: "/documentLinks",
        before: null,
        after: link,
      });
    }
  }
  return changes;
}

function datePart(timestamp: string): string {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.valueOf())) {
    throw new TypeError(`GOV.UK returned invalid timestamp ${timestamp}`);
  }
  return parsed.toISOString().slice(0, 10);
}

function timingFor(
  publicationDate: string,
  detectedDate: string,
  effectivePeriods: GovUkSourceSpec["effectivePeriods"],
): RuleUpdateProposal["timing"] {
  if (publicationDate > detectedDate) return "future-announcement";
  if (
    effectivePeriods.length > 0 &&
    effectivePeriods.every(({ to }) => to < publicationDate)
  ) {
    return "historical-correction-candidate";
  }
  return "current-or-unknown";
}

function proposalFor(
  source: GovUkSourceSpec,
  reviewed: GovUkContentSnapshot,
  candidate: GovUkContentSnapshot,
  checkedAt: string,
): RuleUpdateProposal | null {
  if (reviewed.fingerprint === candidate.fingerprint) return null;
  const detectedDate = datePart(checkedAt);
  const publicationDate = datePart(candidate.metadata.publicUpdatedAt);
  return {
    id: `${source.id}-${candidate.fingerprint.slice(0, 12)}`,
    sourceId: source.id,
    sourceTitle: source.title,
    pageUrl: source.pageUrl,
    affectedRuleIds: source.ruleIds,
    changes: diffGovUkSnapshots(reviewed, candidate),
    dates: {
      publicationDate,
      detectedDate,
      potentialEffectivePeriods: source.effectivePeriods,
      reviewedEffectiveDate: null,
      activationDate: null,
    },
    timing: timingFor(
      publicationDate,
      detectedDate,
      source.effectivePeriods,
    ),
    activationGate: {
      status: "review-and-validation-required",
      activeDatasetVersion: ruleDataset.datasetVersion,
      validationCommand: "mise run //packages/finance-tax-rules:check",
      previousArtifactMustRemain: `artifacts/enacted/${ruleDataset.datasetVersion}.json`,
    },
    candidateSnapshot: candidate,
  };
}

export async function fetchGovUkSourceSnapshot(
  source: GovUkSourceSpec,
  fetchImpl: typeof fetch,
  attempts: number,
): Promise<GovUkContentSnapshot> {
  const response = await fetchWithRetry(source.contentApiUrl, {
    attempts,
    fetch: fetchImpl,
    init: {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "personal-site-finance-tax-rule-monitor/1.0",
      },
    },
  });
  if (!response.ok) {
    throw new Error(`GOV.UK Content API returned ${response.status}`);
  }
  return snapshotGovUkContent(await response.json());
}

function isDue(
  source: GovUkSourceSpec,
  state: GovUkMonitorState["sources"][string] | undefined,
  checkedAt: string,
  configuredHours: number | undefined,
): boolean {
  if (!state) return true;
  const intervalHours = configuredHours ?? source.defaultCheckIntervalHours;
  if (!Number.isFinite(intervalHours) || intervalHours < 0) {
    throw new Error("Check interval hours must be a non-negative number");
  }
  return (
    new Date(checkedAt).valueOf() -
      new Date(state.lastSuccessfulCheckAt).valueOf() >=
    intervalHours * 60 * 60 * 1_000
  );
}

type SourceCheckResult =
  | { success: true; snapshot: GovUkContentSnapshot }
  | { success: false; message: string };

async function checkSource(
  source: GovUkSourceSpec,
  fetchImpl: typeof fetch,
  attempts: number,
): Promise<SourceCheckResult> {
  try {
    return {
      success: true,
      snapshot: await fetchGovUkSourceSnapshot(source, fetchImpl, attempts),
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

type MonitoredSourceResult =
  | { kind: "cached"; proposal: RuleUpdateProposal | null }
  | { kind: "checked"; snapshot: GovUkContentSnapshot; proposal: RuleUpdateProposal | null }
  | { kind: "failed"; message: string };

async function monitorSource(
  source: GovUkSourceSpec,
  reviewed: GovUkContentSnapshot | undefined,
  previous: GovUkMonitorState["sources"][string] | undefined,
  checkedAt: string,
  options: Pick<MonitorOptions, "checkIntervalHours" | "fetchImpl">,
  attempts: number,
): Promise<MonitoredSourceResult> {
  if (!reviewed) {
    return {
      kind: "failed",
      message: "No reviewed Content API snapshot is checked in",
    };
  }
  if (!isDue(source, previous, checkedAt, options.checkIntervalHours) && previous) {
    return {
      kind: "cached",
      proposal: proposalFor(source, reviewed, previous.snapshot, checkedAt),
    };
  }
  const result = await checkSource(source, options.fetchImpl ?? fetch, attempts);
  return result.success
    ? {
        kind: "checked",
        snapshot: result.snapshot,
        proposal: proposalFor(source, reviewed, result.snapshot, checkedAt),
      }
    : { kind: "failed", message: result.message };
}

type MonitorAccumulator = {
  checkedAt: string;
  checkedSourceIds: string[];
  cachedSourceIds: string[];
  proposals: RuleUpdateProposal[];
  failures: GovUkMonitorReport["failures"];
  state: GovUkMonitorState;
};

function recordSourceResult(
  source: GovUkSourceSpec,
  result: MonitoredSourceResult,
  output: MonitorAccumulator,
): void {
  if (result.kind === "cached") {
    output.cachedSourceIds.push(source.id);
    if (result.proposal) output.proposals.push(result.proposal);
    return;
  }
  if (result.kind === "failed") {
    output.failures.push({ sourceId: source.id, message: result.message });
    return;
  }
  output.checkedSourceIds.push(source.id);
  output.state.sources[source.id] = {
    lastSuccessfulCheckAt: output.checkedAt,
    snapshot: result.snapshot,
  };
  if (result.proposal) output.proposals.push(result.proposal);
}

function reportStatus(output: MonitorAccumulator): GovUkMonitorReport["status"] {
  if (output.failures.length > 0) return "degraded";
  if (output.proposals.length > 0) return "changes-detected";
  return "unchanged";
}

export async function monitorGovUkSources(
  sources: readonly GovUkSourceSpec[],
  options: MonitorOptions,
): Promise<GovUkMonitorReport> {
  const checkedAt = options.checkedAt ?? new Date().toISOString();
  datePart(checkedAt);
  const attempts = options.attempts ?? 3;
  if (!Number.isSafeInteger(attempts) || attempts < 1) {
    throw new Error("Fetch attempts must be a positive integer");
  }
  const state: GovUkMonitorState = structuredClone(
    options.previousState ?? {
      schemaVersion: 1,
      lastSuccessfulCheckAt: null,
      sources: {},
    },
  );
  const output: MonitorAccumulator = {
    checkedAt,
    checkedSourceIds: [],
    cachedSourceIds: [],
    proposals: [],
    failures: [],
    state,
  };
  const results = await Promise.all(
    sources.map(async (source) => ({
      source,
      result: await monitorSource(
        source,
        options.reviewedSnapshots[source.id],
        state.sources[source.id],
        checkedAt,
        options,
        attempts,
      ),
    })),
  );
  for (const { source, result } of results) {
    recordSourceResult(source, result, output);
  }

  if (output.failures.length === 0) state.lastSuccessfulCheckAt = checkedAt;
  return {
    checkedAt,
    status: reportStatus(output),
    checkedSourceIds: output.checkedSourceIds,
    cachedSourceIds: output.cachedSourceIds,
    proposals: output.proposals,
    failures: output.failures,
    state,
  };
}

function markdownCell(value: string | null): string {
  return value ?? "_(not set; reviewer required)_";
}

function formatEffectivePeriods(
  periods: RuleUpdateProposal["dates"]["potentialEffectivePeriods"],
): string {
  return periods.map(({ from, to }) => `${from} to ${to}`).join(", ");
}

export function renderGovUkMonitorReport(report: GovUkMonitorReport): string {
  const lines = [
    "# GOV.UK tax-rule source monitor",
    "",
    `Checked at: ${report.checkedAt}`,
    "",
    `Status: ${report.status}`,
    "",
    `Fetched ${report.checkedSourceIds.length} source(s); used ${report.cachedSourceIds.length} cached source(s).`,
  ];
  if (report.failures.length > 0) {
    lines.push("", "## Source failures", "");
    for (const failure of report.failures) {
      lines.push(`- ${failure.sourceId}: ${failure.message}`);
    }
  }
  for (const proposal of report.proposals) {
    lines.push(
      "",
      `## ${proposal.sourceTitle}`,
      "",
      `Source: ${proposal.pageUrl}`,
      "",
      `Proposal: ${proposal.id}`,
      "",
      `Timing: ${proposal.timing}`,
      "",
      `Affected rules: ${proposal.affectedRuleIds.join(", ")}`,
      "",
      `Potential effective periods: ${formatEffectivePeriods(proposal.dates.potentialEffectivePeriods)}`,
      "",
      "| Date | Value |",
      "| --- | --- |",
      `| Publication | ${proposal.dates.publicationDate} |`,
      `| Detection | ${proposal.dates.detectedDate} |`,
      `| Effective | ${markdownCell(proposal.dates.reviewedEffectiveDate)} |`,
      `| Activation | ${markdownCell(proposal.dates.activationDate)} |`,
      "",
      "The monitor does not activate rule changes. A reviewer must set the effective date, classify announced or enacted rules, update the versioned dataset, and run:",
      "",
      `\`${proposal.activationGate.validationCommand}\``,
      "",
      `Keep \`${proposal.activationGate.previousArtifactMustRemain}\` for rollback and historical recalculation.`,
      "",
      "### Detected differences",
      "",
    );
    for (const change of proposal.changes) {
      lines.push(
        `- ${change.area} \`${change.path}\`: ${markdownCell(change.before)} -> ${markdownCell(change.after)}`,
      );
    }
  }
  if (report.proposals.length === 0 && report.failures.length === 0) {
    lines.push("", "No reviewed source changed.");
  }
  return `${lines.join("\n")}\n`;
}

export const govUkContentSnapshotSchema = z.object({
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  metadata: z.object({
    basePath: z.string().startsWith("/"),
    contentId: z.string().nullable(),
    description: z.string().nullable(),
    documentType: z.string(),
    firstPublishedAt: z.string(),
    publicUpdatedAt: z.string(),
    schemaName: z.string(),
    title: z.string().nullable(),
    withdrawnNotice: jsonValueSchema,
  }),
  details: jsonValueSchema,
  documentLinks: z.array(z.string()),
});

export const govUkMonitorStateSchema = z.object({
  schemaVersion: z.literal(1),
  lastSuccessfulCheckAt: z.string().nullable(),
  sources: z.record(
    z.string(),
    z.object({
      lastSuccessfulCheckAt: z.string(),
      snapshot: govUkContentSnapshotSchema,
    }),
  ),
});
