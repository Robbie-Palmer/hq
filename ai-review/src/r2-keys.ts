export type ReviewRunTerminalStatus =
  | "denied"
  | "failed"
  | "published"
  | "skipped";

interface PullRequestKeyParts {
  repository: string;
  pullRequestNumber: number;
}

export function isCanonicalRepository(
  repository: unknown,
): repository is string {
  if (typeof repository !== "string" || repository.length > 255) return false;
  const segments = repository.split("/");
  return (
    segments.length === 2 &&
    segments.every(
      (segment) =>
        segment.length > 0 &&
        segment.trim() === segment &&
        segment !== "." &&
        segment !== "..",
    )
  );
}

function repositoryKeyPath(repository: string): string {
  if (!isCanonicalRepository(repository)) {
    throw new TypeError("repository must use the canonical owner/name form");
  }
  return repository;
}

function keySegment(name: string, value: string): string {
  if (
    value.length === 0 ||
    value.trim() !== value ||
    value.includes("/") ||
    value === "." ||
    value === ".."
  ) {
    throw new TypeError(`${name} must be a single R2 key segment`);
  }
  return value;
}

export function findingRecordsPrefix(parts: PullRequestKeyParts): string {
  return [
    "v2",
    repositoryKeyPath(parts.repository),
    `pr-${parts.pullRequestNumber}`,
    "findings",
  ].join("/");
}

export function findingOutcomeKey(
  parts: PullRequestKeyParts & {
    findingId: string;
    outcomeVersion: number;
  },
): string {
  return [
    findingRecordsPrefix(parts),
    keySegment("findingId", parts.findingId),
    "outcomes",
    `v${parts.outcomeVersion}.json`,
  ].join("/");
}

export function findingEvidenceKey(
  parts: PullRequestKeyParts & {
    findingId: string;
    deliveryId: string;
  },
): string {
  return [
    findingRecordsPrefix(parts),
    keySegment("findingId", parts.findingId),
    "evidence",
    `${keySegment("deliveryId", parts.deliveryId)}.json`,
  ].join("/");
}

export function reviewRunTerminalKey(
  parts: PullRequestKeyParts & {
    headSha: string;
    instanceId: string;
    status: ReviewRunTerminalStatus;
  },
): string {
  return [
    "v2",
    repositoryKeyPath(parts.repository),
    `pr-${parts.pullRequestNumber}`,
    keySegment("headSha", parts.headSha),
    keySegment("instanceId", parts.instanceId),
    `${parts.status}.json`,
  ].join("/");
}
