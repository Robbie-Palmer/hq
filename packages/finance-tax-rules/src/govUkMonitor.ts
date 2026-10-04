import { createHash } from "node:crypto";
import { z } from "zod";
import { ruleDataset } from "./data";
import type { RuleDataset } from "./schema";

type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

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

export type SourceChange = {
  area: "content" | "document-link" | "metadata";
  path: string;
  before: string | null;
  after: string | null;
};

export type RuleUpdateProposal = {
  id: string;
  kind: "initial-baseline" | "source-change";
  sourceId: string;
  sourceTitle: string;
  pageUrl: string;
  baseFingerprint: string | null;
  candidateFingerprint: string;
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
    if (!Number.isFinite(value)) {
      throw new Error("Content contains a non-finite number");
    }
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
  return [
    ...value.matchAll(
      /(?:href|src)=["']([^"']+)["']|https?:\/\/[^\s"'<>]+/g,
    ),
  ].flatMap((match) => {
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

export function sha256Hex(value: string): string {
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
  const sortedLinks = [...documentLinks].toSorted(compareText);
  const monitored = normalizeJson({
    details,
    documentLinks: sortedLinks,
    metadata,
  });
  return {
    fingerprint: sha256Hex(canonicalJson(monitored)),
    metadata,
    details,
    documentLinks: sortedLinks,
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

function stripMarkup(value: JsonValue): JsonValue {
  if (typeof value === "string") return plainText(value);
  if (Array.isArray(value)) return value.map(stripMarkup);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, stripMarkup(item)]),
  );
}

function summarize(value: JsonValue | undefined): string | null {
  if (value === undefined) return null;
  const raw =
    typeof value === "string"
      ? plainText(value)
      : JSON.stringify(stripMarkup(value));
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

export function createRuleUpdateProposal(
  source: GovUkSourceSpec,
  base: GovUkContentSnapshot | null,
  candidate: GovUkContentSnapshot,
  detectedAt: string,
): RuleUpdateProposal | null {
  if (base?.fingerprint === candidate.fingerprint) return null;
  const detectedDate = datePart(detectedAt);
  const publicationDate = datePart(candidate.metadata.publicUpdatedAt);
  const proposalDigest = sha256Hex(
    [
      source.id,
      base?.fingerprint ?? "initial",
      candidate.fingerprint,
      detectedAt,
    ].join(":"),
  );
  return {
    id: `${source.id}-${proposalDigest.slice(0, 24)}`,
    kind: base === null ? "initial-baseline" : "source-change",
    sourceId: source.id,
    sourceTitle: source.title,
    pageUrl: source.pageUrl,
    baseFingerprint: base?.fingerprint ?? null,
    candidateFingerprint: candidate.fingerprint,
    affectedRuleIds: source.ruleIds,
    changes:
      base === null
        ? [
            {
              area: "metadata",
              path: "/snapshot",
              before: null,
              after: candidate.fingerprint,
            },
          ]
        : diffGovUkSnapshots(base, candidate),
    dates: {
      publicationDate,
      detectedDate,
      potentialEffectivePeriods: source.effectivePeriods,
      reviewedEffectiveDate: null,
      activationDate: null,
    },
    timing: timingFor(publicationDate, detectedDate, source.effectivePeriods),
    activationGate: {
      status: "review-and-validation-required",
      activeDatasetVersion: ruleDataset.datasetVersion,
      validationCommand: "mise run //packages/finance-tax-rules:check",
      previousArtifactMustRemain: `artifacts/enacted/${ruleDataset.datasetVersion}.json`,
    },
  };
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
