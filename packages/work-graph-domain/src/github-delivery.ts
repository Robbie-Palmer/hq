import { normalizeEvidenceObservation } from "./evidence";
import type { DeliveryEvidenceObservation, PullRequestSnapshot } from "./model";

export interface GitHubDelivery {
  readonly deliveryId: string;
  readonly event: string;
  readonly installationId: number;
  readonly payload: Record<string, unknown>;
  readonly payloadDigest: string;
  readonly receivedAt: string;
  readonly repository: string;
}

export interface GitHubObservation {
  readonly evidence: DeliveryEvidenceObservation;
  readonly pullRequest: PullRequestSnapshot | null;
  readonly providerSequence: number;
}

export class InvalidGitHubDelivery extends Error {
  constructor() {
    super("Malformed GitHub observation");
  }
}

type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvalidGitHubDelivery();
  }
  return value as RecordValue;
}
function text(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new InvalidGitHubDelivery();
  }
  return value;
}
function id(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new InvalidGitHubDelivery();
  }
  return value;
}
function sha(value: unknown): string {
  const result = text(value).toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(result)) throw new InvalidGitHubDelivery();
  return result;
}

function mergeability(value: unknown): PullRequestSnapshot["mergeability"] {
  if (value === true) return "mergeable";
  if (value === false) return "conflicting";
  return "unknown";
}

function workflowState(value: unknown): DeliveryEvidenceObservation["state"] {
  if (value === "success") return "success";
  if (value === "cancelled") return "cancelled";
  return "failure";
}

function deploymentState(value: unknown): DeliveryEvidenceObservation["state"] {
  if (value === "success") return "success";
  if (value === "inactive") return "cancelled";
  if (value === "failure" || value === "error") return "failure";
  return "pending";
}

function pullRequestObservation(delivery: GitHubDelivery): GitHubObservation {
  const pr = record(delivery.payload.pull_request);
  const headSha = sha(record(pr.head).sha);
  if (
    typeof pr.merged !== "boolean" ||
    typeof pr.draft !== "boolean" ||
    (pr.state !== "open" && pr.state !== "closed")
  ) {
    throw new InvalidGitHubDelivery();
  }
  const merged = pr.merged;
  const state = merged ? "merged" : pr.state;
  const stateDetails = {
    merged: { sequence: 2, evidenceState: "success" },
    closed: { sequence: 1, evidenceState: "cancelled" },
    open: { sequence: 0, evidenceState: "pending" },
  } as const;
  if (merged && pr.state !== "closed") throw new InvalidGitHubDelivery();
  // GitHub uses merge_commit_sha for a speculative test merge on open PRs.
  const mergeCommitSha = merged ? sha(pr.merge_commit_sha) : null;
  const snapshot: PullRequestSnapshot = {
    repository: delivery.repository.toLowerCase(),
    number: id(pr.number),
    url: text(pr.html_url),
    headSha,
    acceptedHeadSha: merged ? headSha : null,
    mergeCommitSha,
    state,
    draft: pr.draft,
    mergeability: mergeability(pr.mergeable),
    reviewDecision: null,
    checkSummary: "unknown",
    observedAt: text(pr.updated_at),
  };
  return {
    pullRequest: snapshot,
    providerSequence: stateDetails[state].sequence,
    evidence: evidence(delivery, {
      externalId: `${snapshot.repository}/pull/${snapshot.number}`,
      commitSha: mergeCommitSha ?? headSha,
      kind: "pull_request",
      state: stateDetails[state].evidenceState,
      sourceUrl: snapshot.url,
      providerObservedAt: snapshot.observedAt,
    }),
  };
}

type Fact = Pick<
  DeliveryEvidenceObservation,
  | "externalId"
  | "commitSha"
  | "kind"
  | "state"
  | "sourceUrl"
  | "providerObservedAt"
> &
  Partial<Pick<DeliveryEvidenceObservation, "name" | "environment">>;

function evidence(
  delivery: GitHubDelivery,
  fact: Fact,
): DeliveryEvidenceObservation {
  return normalizeEvidenceObservation({
    id: delivery.deliveryId,
    deliveryProvider: "github",
    deliveryExternalId: delivery.deliveryId,
    provider: "github",
    repository: delivery.repository,
    ingestedAt: delivery.receivedAt,
    name: null,
    environment: null,
    correlationKind: "unmatched",
    pullRequestRepository: null,
    pullRequestNumber: null,
    ...fact,
  });
}

function workflowObservation(
  delivery: GitHubDelivery,
): GitHubObservation | null {
  if (delivery.payload.action !== "completed") return null;
  const run = record(delivery.payload.workflow_run);
  id(run.run_attempt);
  if (run.status !== "completed") throw new InvalidGitHubDelivery();
  const conclusions = [
    "success",
    "failure",
    "neutral",
    "cancelled",
    "skipped",
    "timed_out",
    "action_required",
    "stale",
    "startup_failure",
  ];
  if (!conclusions.includes(text(run.conclusion)))
    throw new InvalidGitHubDelivery();
  return {
    pullRequest: null,
    providerSequence: id(run.run_attempt),
    evidence: evidence(delivery, {
      externalId: `${delivery.repository.toLowerCase()}/actions/runs/${id(run.id)}`,
      commitSha: sha(run.head_sha),
      kind: "ci",
      state: workflowState(run.conclusion),
      name: text(run.name),
      sourceUrl: text(run.html_url),
      providerObservedAt: text(run.updated_at),
    }),
  };
}

function deploymentObservation(delivery: GitHubDelivery): GitHubObservation {
  const deployment = record(delivery.payload.deployment);
  const status = record(delivery.payload.deployment_status);
  id(status.id);
  const states = [
    "error",
    "failure",
    "inactive",
    "in_progress",
    "queued",
    "pending",
    "success",
  ];
  if (!states.includes(text(status.state))) throw new InvalidGitHubDelivery();
  return {
    pullRequest: null,
    providerSequence: id(status.id),
    evidence: evidence(delivery, {
      externalId: `${delivery.repository.toLowerCase()}/deployments/${id(deployment.id)}`,
      commitSha: sha(deployment.sha),
      kind: "deployment",
      state: deploymentState(status.state),
      environment: text(status.environment ?? deployment.environment),
      // The status API URL identifies the observation even without a log URL.
      sourceUrl: text(status.url),
      providerObservedAt: text(status.created_at),
    }),
  };
}

/** Normalize verified deliveries only. No lifecycle or lease authority is exposed. */
export function normalizeGitHubDelivery(
  delivery: GitHubDelivery,
): GitHubObservation | null {
  const payloadRepository = text(
    record(delivery.payload.repository).full_name,
  ).toLowerCase();
  if (
    payloadRepository !== delivery.repository.toLowerCase() ||
    id(record(delivery.payload.installation).id) !== delivery.installationId
  ) {
    throw new InvalidGitHubDelivery();
  }
  if (delivery.event === "pull_request")
    return pullRequestObservation(delivery);
  if (delivery.event === "workflow_run") return workflowObservation(delivery);
  if (delivery.event === "deployment_status")
    return deploymentObservation(delivery);
  return null;
}
