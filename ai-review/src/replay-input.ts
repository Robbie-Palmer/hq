import type { Env, ReviewWorkflowParams } from "./env";
import type { PreparedReview } from "./review-engine";
import { ReplayInputSnapshotSchema } from "ai-review-domain/records";
import { sha256Hex as sha256 } from "ts-base/crypto";
import {
  findingRecordsPrefix,
  reviewRunTerminalKey,
  type ReviewRunTerminalStatus,
} from "./r2-keys";

export const REPLAY_INPUT_SCHEMA_VERSION = 1;
export const REPLAY_MANIFEST_SCHEMA_VERSION = 1;

export function assertReplaySchemaCompatible(value: unknown): asserts value is {
  schemaVersion: typeof REPLAY_INPUT_SCHEMA_VERSION;
  recordType: "ai-review-replay-input";
} {
  const record = value as { schemaVersion?: unknown };
  if (record?.schemaVersion !== REPLAY_INPUT_SCHEMA_VERSION) {
    throw new Error(`Unsupported replay input schema version: ${String(record?.schemaVersion)}`);
  }
  const result = ReplayInputSnapshotSchema.safeParse(value);
  if (result.success) return;
  throw new Error(
    `Invalid replay input schema: ${result.error.issues[0]?.message ?? "invalid record"}`,
  );
}

const SECRET_PATTERNS: Array<[string, RegExp]> = [
  ["private-key", /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g],
  ["authorization", /\b(?:authorization:\s*)?(?:basic|bearer)\s+[^\s"']+/gi],
  ["github-token", /\b(?:gh[opsu]_\w{20,}|github_pat_\w{20,})\b/g],
  ["connection-uri", /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s"']+/gi],
];
const ASSIGNMENT_IDENTIFIER = String.raw`[\p{L}\p{N}_-]+`;
const ASSIGNMENT_NAME = `(${ASSIGNMENT_IDENTIFIER})`;
const ASSIGNMENT_VALUE = String.raw`(?:"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|[^\s,;]+)`;
const ASSIGNMENT_PATTERNS = [
  new RegExp(String.raw`"${ASSIGNMENT_NAME}"\s*[:=]\s*${ASSIGNMENT_VALUE}`, "gu"),
  new RegExp(String.raw`'${ASSIGNMENT_NAME}'\s*[:=]\s*${ASSIGNMENT_VALUE}`, "gu"),
  new RegExp(String.raw`(?<![\p{L}\p{N}_-])${ASSIGNMENT_NAME}\s*[:=]\s*${ASSIGNMENT_VALUE}`, "gu"),
];
const YAML_BLOCK_HEADER = new RegExp(
  String.raw`^((?:-[ \t]+)?)(?:"(${ASSIGNMENT_IDENTIFIER})"|'(${ASSIGNMENT_IDENTIFIER})'|(${ASSIGNMENT_IDENTIFIER}))[ \t]*:[ \t]*[|>](?:[+-]|[1-9][+-]?|[+-][1-9])?[ \t]*(?:#[^\r\n]*)?$`,
  "u",
);
function isSecretName(name: string): boolean {
  const normalized = name
    .normalize("NFKC")
    .replace(/([A-Z])(?=[A-Z][a-z])/g, "$1_")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase();
  // Prefer false-positive redaction over letting confusable Unicode key names
  // disguise a credential label that the ASCII rules below would recognize.
  if (/\P{ASCII}/u.test(normalized)) return true;
  return (
    normalized === "database_url" ||
    /(?:^|[_-])(?:secret|token|password|passwd|credential|cookie|bearer|session)(?:$|[_-])/.test(normalized) ||
    /(?:^|[_-])(?:api|private|encryption|signing)_key(?:$|[_-])/.test(normalized)
  );
}

function assignedSecret(counts: Record<string, number>): string {
  counts["assigned-secret"] = (counts["assigned-secret"] ?? 0) + 1;
  return "[REDACTED:assigned-secret]";
}

function yamlLine(value: string): { body: string; indent: number; prefix: string } {
  const leading = /^[ \t]*/.exec(value)?.[0] ?? "";
  let bodyOffset = leading.length;
  if (bodyOffset === 0 && (value.startsWith("+") || value.startsWith("-"))) bodyOffset = 1;
  const afterMarker = /^[ \t]*/.exec(value.slice(bodyOffset))?.[0] ?? "";
  bodyOffset += afterMarker.length;
  return {
    body: value.slice(bodyOffset),
    indent: leading.length + afterMarker.length,
    prefix: value.slice(0, bodyOffset),
  };
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing function predates the complexity limit; new violations remain prohibited.
function redactYamlBlockAssignments(value: string, counts: Record<string, number>): string {
  const parts = value.split(/(\r\n|\n|\r)/);
  for (let index = 0; index < parts.length; index += 2) {
    const line = yamlLine(parts[index] ?? "");
    const match = YAML_BLOCK_HEADER.exec(line.body);
    const name = match?.[2] ?? match?.[3] ?? match?.[4];
    if (!match || !name || !isSecretName(name)) continue;
    parts[index] = `${line.prefix}${match[1] ?? ""}${assignedSecret(counts)}`;
    for (let bodyIndex = index + 2; bodyIndex < parts.length; bodyIndex += 2) {
      const blockLine = yamlLine(parts[bodyIndex] ?? "");
      if (blockLine.body.trim().length > 0 && blockLine.indent <= line.indent) break;
      if (blockLine.body.trim().length > 0) parts[bodyIndex] = blockLine.prefix;
    }
  }
  return parts.join("");
}

function redact(value: string, counts: Record<string, number>): string {
  const patternsRedacted = SECRET_PATTERNS.reduce(
    (current, [kind, pattern]) => current.replace(pattern, () => {
      counts[kind] = (counts[kind] ?? 0) + 1;
      return `[REDACTED:${kind}]`;
    }),
    value,
  );
  const blockScalarsRedacted = redactYamlBlockAssignments(patternsRedacted, counts);
  return ASSIGNMENT_PATTERNS.reduce(
    (current, pattern) => current.replace(pattern, (assignment, name: string) =>
      isSecretName(name) ? assignedSecret(counts) : assignment),
    blockScalarsRedacted,
  );
}

function redactValue(value: unknown, counts: Record<string, number>): unknown {
  if (typeof value === "string") return redact(value, counts);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, counts));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) =>
        [key, isSecretName(key) ? assignedSecret(counts) : redactValue(item, counts)],
      ),
    );
  }
  return value;
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function finite(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function persistReplayInput(options: {
  env: Env;
  params: ReviewWorkflowParams;
  instanceId: string;
  status: ReviewRunTerminalStatus;
  prepared: PreparedReview;
  timestamp: Date;
  prompt: {
    version: string;
    scoutSystem: string;
    scoutSchema: unknown;
    mergerSystem: string;
    mergerSchema: unknown;
  };
  modelSettings: {
    openRouterScouts: string[];
    openCodeScouts: string[];
    merger: string;
    requireZeroDataRetention: boolean;
    scoutMaxTokens: number;
    mergerMaxTokens: number;
    openRouterScoutMaxPrices: unknown;
  };
  policy: unknown;
}): Promise<{ manifestKey: string; snapshotKey: string; snapshotSha256: string }> {
  const { env, params, prepared } = options;
  if (!prepared.baseSha || !prepared.headSha || prepared.fullDiff === undefined) {
    throw new Error("Cannot persist replay input without immutable Git refs and full diff");
  }
  const redactions: Record<string, number> = {};
  const root = ["v2", params.repository, `pr-${params.pullRequestNumber}`, prepared.headSha, options.instanceId, "replay"].join("/");
  const snapshotKey = `${root}/input-v${REPLAY_INPUT_SCHEMA_VERSION}.json`;
  const manifestKey = `${root}/manifest-v${REPLAY_MANIFEST_SCHEMA_VERSION}.json`;
  const productionRecordKey = reviewRunTerminalKey({
    repository: params.repository,
    pullRequestNumber: params.pullRequestNumber,
    headSha: prepared.headSha,
    instanceId: options.instanceId,
    status: options.status,
  });
  const rawSnapshot = {
    schemaVersion: REPLAY_INPUT_SCHEMA_VERSION,
    recordType: "ai-review-replay-input",
    repository: params.repository,
    pullRequestNumber: params.pullRequestNumber,
    productionRunId: options.instanceId,
    pullRequest: prepared.pullRequest,
    git: { baseSha: prepared.baseSha, headSha: prepared.headSha },
    input: {
      fullDiff: prepared.fullDiff,
      reviewedDiff: prepared.diff ?? "",
      boundedFileContext: prepared.context ?? "",
      repositoryGuidelines: prepared.guidelines ?? "",
      reviewThreads: prepared.threads ?? "",
      priorOpenFindings: prepared.priorOpenFindings ?? [],
      affectedOpenFindings: prepared.replayFindings ?? [],
    },
    decision: {
      changeProfile: prepared.changeProfile,
      coverage: prepared.coverage,
      paths: prepared.paths,
      omittedPaths: prepared.omitted,
      reviewedHunks: prepared.hunks,
    },
    prompt: options.prompt,
    policy: options.policy,
    modelRequest: options.modelSettings,
    budget: {
      maxRunsPerPullRequest: finite(env.AI_REVIEW_MAX_RUNS_PER_PR, 20),
      maxCostUsdPerPullRequest: finite(env.AI_REVIEW_MAX_PR_COST_USD, 5),
    },
    provenance: {
      diffFingerprint: prepared.diffFingerprint,
      configFingerprint: prepared.configFingerprint,
      trigger: { deliveryId: params.deliveryId, eventName: params.eventName, action: params.action, force: params.force },
      capturedAt: options.timestamp.toISOString(),
    },
  };
  const redactedSnapshot = redactValue(rawSnapshot, redactions) as typeof rawSnapshot;
  Object.assign(redactedSnapshot.provenance, {
    redactions,
    liveCredentialsIncluded: false,
  });
  const snapshot = ReplayInputSnapshotSchema.parse(redactedSnapshot);
  const snapshotJson = stableJson(snapshot);
  const snapshotSha256 = await sha256(snapshotJson);
  const retentionDays = finite(env.AI_REVIEW_DATA_RETENTION_DAYS, 365);
  const expiresAt = new Date(options.timestamp.getTime() + retentionDays * 86_400_000).toISOString();
  const manifest = {
    schemaVersion: REPLAY_MANIFEST_SCHEMA_VERSION,
    recordType: "ai-review-replay-manifest",
    productionRunId: options.instanceId,
    productionRecordKey,
    snapshot: { key: snapshotKey, sha256: snapshotSha256, schemaVersion: REPLAY_INPUT_SCHEMA_VERSION },
    findingOutcomesPrefix: findingRecordsPrefix({
      repository: params.repository,
      pullRequestNumber: params.pullRequestNumber,
    }),
    retention: { days: retentionDays, expiresAt },
  };
  await env.REVIEW_DATA.put(snapshotKey, snapshotJson, {
    httpMetadata: { contentType: "application/json" },
    customMetadata: { sha256: snapshotSha256, schemaVersion: String(REPLAY_INPUT_SCHEMA_VERSION) },
  });
  await env.REVIEW_DATA.put(manifestKey, stableJson(manifest), {
    httpMetadata: { contentType: "application/json" },
  });
  return { manifestKey, snapshotKey, snapshotSha256 };
}
