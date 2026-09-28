export interface GuardrailConfiguration {
  AI_REVIEW_PUBLICATION_POLICY_VERSION?: string;
  AI_REVIEW_MAX_VISIBLE_FINDINGS?: string;
  AI_REVIEW_RELIABILITY_POLICY_VERSION?: string;
  AI_REVIEW_MODEL_FAILURE_THRESHOLD?: string;
  AI_REVIEW_MODEL_COOLDOWN_SECONDS?: string;
}

export const DEFAULT_PUBLICATION_POLICY_VERSION =
  "deterministic-publication-v1";
export const DEFAULT_RELIABILITY_POLICY_VERSION =
  "consecutive-failures-v1";
export const DEFAULT_MAX_VISIBLE_FINDINGS = 7;
export const DEFAULT_MODEL_FAILURE_THRESHOLD = 3;
export const DEFAULT_MODEL_COOLDOWN_SECONDS = 3_600;

const MAX_VISIBLE_FINDINGS_LIMIT = 25;
const MAX_FAILURE_THRESHOLD = 20;
const MAX_COOLDOWN_SECONDS = 7 * 24 * 60 * 60;

export interface PublicationPolicy {
  version: string;
  maxVisibleFindings: number;
  rejectedLanguage: string[];
}

export interface ReliabilityPolicy {
  version: string;
  consecutiveFailureThreshold: number;
  cooldownSeconds: number;
}

export interface GuardrailPolicy {
  publication: PublicationPolicy;
  reliability: ReliabilityPolicy;
}

export type PublicationGuardrailReason =
  | "publication-limit"
  | "speculative-language";

export interface HiddenFinding<T> {
  finding: T;
  reason: PublicationGuardrailReason;
}

interface GuardrailFinding {
  findingId: string;
  severity: "critical" | "high" | "medium" | "low";
  confidence: number;
  file: string;
  line: number | null;
  title: string;
  evidence: string;
  recommendation: string;
  status: "open" | "resolved";
}

const REJECTED_LANGUAGE = [
  "consider",
  "verify",
  "no fix needed",
  "no fix is needed",
  "no fix required",
  "no fix is required",
];

function boundedInteger(
  raw: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function configuredVersion(raw: string | undefined, fallback: string): string {
  const value = raw?.trim();
  return value ? value.slice(0, 100) : fallback;
}

export function guardrailPolicy(
  env: GuardrailConfiguration,
): GuardrailPolicy {
  return {
    publication: {
      version: configuredVersion(
        env.AI_REVIEW_PUBLICATION_POLICY_VERSION,
        DEFAULT_PUBLICATION_POLICY_VERSION,
      ),
      maxVisibleFindings: boundedInteger(
        env.AI_REVIEW_MAX_VISIBLE_FINDINGS,
        DEFAULT_MAX_VISIBLE_FINDINGS,
        1,
        MAX_VISIBLE_FINDINGS_LIMIT,
      ),
      rejectedLanguage: REJECTED_LANGUAGE,
    },
    reliability: {
      version: configuredVersion(
        env.AI_REVIEW_RELIABILITY_POLICY_VERSION,
        DEFAULT_RELIABILITY_POLICY_VERSION,
      ),
      consecutiveFailureThreshold: boundedInteger(
        env.AI_REVIEW_MODEL_FAILURE_THRESHOLD,
        DEFAULT_MODEL_FAILURE_THRESHOLD,
        1,
        MAX_FAILURE_THRESHOLD,
      ),
      cooldownSeconds: boundedInteger(
        env.AI_REVIEW_MODEL_COOLDOWN_SECONDS,
        DEFAULT_MODEL_COOLDOWN_SECONDS,
        1,
        MAX_COOLDOWN_SECONDS,
      ),
    },
  };
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasSpeculativeLanguage(
  finding: GuardrailFinding,
  rejectedLanguage: string[],
): boolean {
  const text = [finding.title, finding.evidence, finding.recommendation].join(
    "\n",
  );
  return rejectedLanguage.some((phrase) => {
    const normalized = phrase.trim();
    return normalized.length > 0 && new RegExp(
      `\\b${escapeRegularExpression(normalized).replace(/\s+/g, "\\s+")}\\b`,
      "i",
    ).test(text);
  });
}

const SEVERITY_ORDER: Record<GuardrailFinding["severity"], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function publicationOrder<T extends GuardrailFinding>(left: T, right: T) {
  return (
    SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity] ||
    right.confidence - left.confidence ||
    left.file.localeCompare(right.file) ||
    (left.line ?? 0) - (right.line ?? 0) ||
    left.title.localeCompare(right.title) ||
    left.findingId.localeCompare(right.findingId)
  );
}

export function selectPublishedFindings<T extends GuardrailFinding>(
  findings: T[],
  policy: PublicationPolicy,
): { published: T[]; hidden: Array<HiddenFinding<T>> } {
  const resolved = findings.filter(({ status }) => status === "resolved");
  const open = findings
    .filter(({ status }) => status === "open")
    .sort(publicationOrder);
  const published: T[] = [];
  const hidden: Array<HiddenFinding<T>> = [];
  const seen = new Set<string>();

  for (const finding of open) {
    if (seen.has(finding.findingId)) continue;
    seen.add(finding.findingId);
    if (hasSpeculativeLanguage(finding, policy.rejectedLanguage)) {
      hidden.push({ finding, reason: "speculative-language" });
      continue;
    }
    if (published.length >= policy.maxVisibleFindings) {
      hidden.push({ finding, reason: "publication-limit" });
      continue;
    }
    published.push(finding);
  }

  return {
    published: [
      ...published,
      ...resolved
        .filter(({ findingId }) => !seen.has(findingId))
        .sort(publicationOrder),
    ],
    hidden,
  };
}

export function manualGuardrailStatement(policy: GuardrailPolicy): string {
  return [
    `Publication policy ${policy.publication.version} allows at most ` +
      `${policy.publication.maxVisibleFindings} visible open findings.`,
    `Reliability policy ${policy.reliability.version} pauses a model after ` +
      `${policy.reliability.consecutiveFailureThreshold} consecutive failures ` +
      `for ${policy.reliability.cooldownSeconds} seconds.`,
  ].join(" ");
}
