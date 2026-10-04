import { compile } from "html-to-text";
import diff, { type Difference } from "microdiff";
import { sha256Hex } from "ts-base/crypto";
import { isoDatePart } from "ts-base/dates";
import {
  canonicalJson,
  type JsonValue,
  jsonPointer,
  mapJsonStrings,
} from "ts-base/json";
import {
  compareStrings,
  normalizeWhitespace,
  truncateWithEllipsis,
} from "ts-base/strings";
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
const jsonObjectSchema = z.record(z.string(), jsonValueSchema);

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
    withdrawnNotice: Record<string, JsonValue>;
  };
  details: Record<string, JsonValue>;
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

export async function snapshotGovUkContent(
  input: unknown,
): Promise<GovUkContentSnapshot> {
  const item = contentItemSchema.parse(input);
  const details = jsonObjectSchema.parse(item.details ?? {});
  const linkedContent = jsonObjectSchema.parse(item.links);
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
    withdrawnNotice: jsonObjectSchema.parse(item.withdrawn_notice ?? {}),
  };
  const sortedLinks = [...documentLinks].toSorted(compareStrings);
  const monitored = {
    details,
    documentLinks: sortedLinks,
    metadata,
  };
  return {
    fingerprint: await sha256Hex(canonicalJson(monitored)),
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
    ...dataset.householdTax,
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
      ruleIds: supportedRules.map(({ id }) => id).toSorted(compareStrings),
      effectivePeriods: [
        ...new Map(
          supportedRules.map(({ effectiveFrom, effectiveTo }) => [
            `${effectiveFrom}:${effectiveTo}`,
            { from: effectiveFrom, to: effectiveTo },
          ]),
        ).values(),
      ].toSorted((left, right) => compareStrings(left.from, right.from)),
      defaultCheckIntervalHours: 24 * 7,
    };
  });
}

const htmlToReviewText = compile({
  selectors: [
    { selector: "a", options: { ignoreHref: true } },
    { selector: "img", format: "skip" },
  ],
  wordwrap: false,
});

function summarizeSourceValue(value: JsonValue | undefined): string | null {
  if (value === undefined) return null;
  const normalized = mapJsonStrings(value, (text) =>
    normalizeWhitespace(htmlToReviewText(text)),
  );
  const summary =
    typeof normalized === "string" ? normalized : JSON.stringify(normalized);
  return truncateWithEllipsis(summary, 240);
}

function valueBefore(change: Difference): JsonValue | undefined {
  return change.type === "CREATE"
    ? undefined
    : jsonValueSchema.parse(change.oldValue);
}

function valueAfter(change: Difference): JsonValue | undefined {
  return change.type === "REMOVE"
    ? undefined
    : jsonValueSchema.parse(change.value);
}

function diffSourceJson(
  before: Record<string, JsonValue>,
  after: Record<string, JsonValue>,
  area: "content" | "metadata",
  root: "details" | "metadata",
  limit: number,
): SourceChange[] {
  return diff(before, after, { cyclesFix: false })
    .map((change) => ({
      area,
      path: jsonPointer([root, ...change.path]),
      before: summarizeSourceValue(valueBefore(change)),
      after: summarizeSourceValue(valueAfter(change)),
    }))
    .toSorted((left, right) => compareStrings(left.path, right.path))
    .slice(0, limit);
}

export function diffGovUkSnapshots(
  reviewed: GovUkContentSnapshot,
  candidate: GovUkContentSnapshot,
): SourceChange[] {
  const changes = diffSourceJson(
    jsonObjectSchema.parse(reviewed.metadata),
    jsonObjectSchema.parse(candidate.metadata),
    "metadata",
    "metadata",
    100,
  );
  changes.push(
    ...diffSourceJson(
      reviewed.details,
      candidate.details,
      "content",
      "details",
      100 - changes.length,
    ),
  );
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

export async function createRuleUpdateProposal(
  source: GovUkSourceSpec,
  base: GovUkContentSnapshot | null,
  candidate: GovUkContentSnapshot,
  detectedAt: string,
): Promise<RuleUpdateProposal | null> {
  if (base?.fingerprint === candidate.fingerprint) return null;
  const detectedDate = isoDatePart(detectedAt);
  const publicationDate = isoDatePart(candidate.metadata.publicUpdatedAt);
  const proposalDigest = await sha256Hex(
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
    withdrawnNotice: jsonObjectSchema,
  }),
  details: jsonObjectSchema,
  documentLinks: z.array(z.string()),
});
