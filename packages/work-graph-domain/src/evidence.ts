import { isNonBlankString } from "ts-base/strings";
import { WorkGraphError } from "./errors";
import type {
  CompletionCandidateEvaluation,
  CompletionPolicyRevision,
  CurrentDeliveryEvidence,
  DeliveryEvidenceObservation,
  ExternalDelivery,
  PullRequestSnapshot,
} from "./model";
import {
  DELIVERY_EVIDENCE_KINDS,
  DELIVERY_EVIDENCE_STATES,
  EVIDENCE_CORRELATION_KINDS,
  type CompletionCandidateReason,
} from "./vocabulary";

const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

const normalizeTimestamp = (value: string, label: string): string => {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new WorkGraphError(
      "invalid_evidence_observation",
      `${label} must be an ISO timestamp.`,
    );
  }
  return new Date(timestamp).toISOString();
};

const normalizeText = (value: string, label: string): string => {
  if (!isNonBlankString(value)) {
    throw new WorkGraphError(
      "invalid_evidence_observation",
      `${label} cannot be empty.`,
    );
  }
  return value.trim();
};

const normalizeUrl = (value: string): string => {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new WorkGraphError(
      "invalid_evidence_observation",
      "An evidence source URL must be an HTTP or HTTPS URL.",
    );
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    throw new WorkGraphError(
      "invalid_evidence_observation",
      "An evidence source URL must be an HTTP or HTTPS URL without credentials.",
    );
  }
  return parsed.href;
};

export const normalizeExternalDelivery = (
  delivery: ExternalDelivery,
): ExternalDelivery => {
  if (
    !isNonBlankString(delivery.provider) ||
    !isNonBlankString(delivery.externalId) ||
    !/^[0-9a-f]{64}$/i.test(delivery.payloadDigest)
  ) {
    throw new WorkGraphError(
      "invalid_external_delivery",
      "An external delivery needs a provider, external ID, and SHA-256 payload digest.",
    );
  }
  const receivedAt = normalizeTimestamp(delivery.receivedAt, "receivedAt");
  const ingestedAt = normalizeTimestamp(delivery.ingestedAt, "ingestedAt");
  return {
    provider: delivery.provider.trim().toLowerCase(),
    externalId: delivery.externalId.trim(),
    payloadDigest: delivery.payloadDigest.toLowerCase(),
    receivedAt,
    ingestedAt,
  };
};

export const normalizeEvidenceObservation = (
  observation: DeliveryEvidenceObservation,
): DeliveryEvidenceObservation => {
  const hasPullRequest =
    observation.pullRequestRepository !== null ||
    observation.pullRequestNumber !== null;
  const validPullRequest =
    observation.pullRequestRepository !== null &&
    REPOSITORY_PATTERN.test(observation.pullRequestRepository) &&
    observation.pullRequestNumber !== null &&
    Number.isSafeInteger(observation.pullRequestNumber) &&
    observation.pullRequestNumber > 0;
  if (
    !UUID_PATTERN.test(observation.id) ||
    !isNonBlankString(observation.deliveryProvider) ||
    !isNonBlankString(observation.deliveryExternalId) ||
    !isNonBlankString(observation.provider) ||
    !isNonBlankString(observation.externalId) ||
    !REPOSITORY_PATTERN.test(observation.repository) ||
    !SHA_PATTERN.test(observation.commitSha) ||
    !(DELIVERY_EVIDENCE_KINDS as readonly unknown[]).includes(
      observation.kind,
    ) ||
    !(DELIVERY_EVIDENCE_STATES as readonly unknown[]).includes(
      observation.state,
    ) ||
    !(EVIDENCE_CORRELATION_KINDS as readonly unknown[]).includes(
      observation.correlationKind,
    ) ||
    (observation.name !== null && !isNonBlankString(observation.name)) ||
    (observation.environment !== null &&
      !isNonBlankString(observation.environment)) ||
    (observation.correlationKind === "unmatched" && hasPullRequest) ||
    (observation.correlationKind !== "unmatched" && !validPullRequest)
  ) {
    throw new WorkGraphError(
      "invalid_evidence_observation",
      `Evidence observation ${observation.id} is invalid.`,
    );
  }
  return {
    ...observation,
    deliveryProvider: observation.deliveryProvider.trim().toLowerCase(),
    deliveryExternalId: observation.deliveryExternalId.trim(),
    provider: observation.provider.trim().toLowerCase(),
    externalId: observation.externalId.trim(),
    repository: observation.repository.toLowerCase(),
    commitSha: observation.commitSha.toLowerCase(),
    name: observation.name?.trim() ?? null,
    environment: observation.environment?.trim().toLowerCase() ?? null,
    sourceUrl: normalizeUrl(observation.sourceUrl),
    providerObservedAt: normalizeTimestamp(
      observation.providerObservedAt,
      "providerObservedAt",
    ),
    ingestedAt: normalizeTimestamp(observation.ingestedAt, "ingestedAt"),
    pullRequestRepository:
      observation.pullRequestRepository?.toLowerCase() ?? null,
  };
};

const evidenceIdentity = (item: DeliveryEvidenceObservation): string =>
  `${item.provider}\u0000${item.kind}\u0000${item.externalId}`;

export const projectCurrentDeliveryEvidence = (
  observations: readonly DeliveryEvidenceObservation[],
): readonly CurrentDeliveryEvidence[] => {
  const current = new Map<string, DeliveryEvidenceObservation>();
  for (const rawObservation of observations) {
    const observation = normalizeEvidenceObservation(rawObservation);
    const identity = evidenceIdentity(observation);
    const existing = current.get(identity);
    if (
      existing === undefined ||
      observation.providerObservedAt > existing.providerObservedAt ||
      (observation.providerObservedAt === existing.providerObservedAt &&
        (observation.ingestedAt > existing.ingestedAt ||
          (observation.ingestedAt === existing.ingestedAt &&
            observation.id > existing.id)))
    ) {
      current.set(identity, observation);
    }
  }
  return [...current.values()]
    .sort((left, right) => evidenceIdentity(left).localeCompare(evidenceIdentity(right)))
    .map((observation) => ({
      ...observation,
      projectedAt: observation.ingestedAt,
    }));
};

export const normalizeCompletionPolicyRevision = (
  policy: CompletionPolicyRevision,
): CompletionPolicyRevision => {
  const requiredCiNames = [...new Set(policy.requiredCiNames.map((name) => name.trim()))];
  const productionEnvironments = [
    ...new Set(
      policy.productionEnvironments.map((environment) =>
        environment.trim().toLowerCase(),
      ),
    ),
  ];
  if (
    !isNonBlankString(policy.policyId) ||
    !Number.isSafeInteger(policy.revision) ||
    policy.revision <= 0 ||
    requiredCiNames.length === 0 ||
    requiredCiNames.some((name) => name.length === 0) ||
    productionEnvironments.length === 0 ||
    productionEnvironments.some((environment) => environment.length === 0) ||
    !Number.isFinite(Date.parse(policy.createdAt))
  ) {
    throw new WorkGraphError(
      "invalid_completion_policy",
      "A completion policy revision needs a positive revision, required CI names, and production environments.",
    );
  }
  return {
    policyId: policy.policyId.trim(),
    revision: policy.revision,
    requiredCiNames,
    productionEnvironments,
    createdAt: new Date(policy.createdAt).toISOString(),
  };
};

export interface CompletionCandidateInput {
  readonly workItemId: string;
  readonly policy: CompletionPolicyRevision;
  readonly implementationPullRequests: readonly PullRequestSnapshot[];
  readonly evidence: readonly CurrentDeliveryEvidence[];
  readonly hasUnfinishedChildren: boolean;
  readonly hasUnresolvedBlockingAttention: boolean;
  readonly evaluatedAt: string;
}

const matchingSuccess = (
  evidence: readonly CurrentDeliveryEvidence[],
  predicate: (item: CurrentDeliveryEvidence) => boolean,
): CurrentDeliveryEvidence | undefined => {
  const latest = evidence
    .filter(predicate)
    .sort(
      (left, right) =>
        right.providerObservedAt.localeCompare(left.providerObservedAt) ||
        right.ingestedAt.localeCompare(left.ingestedAt) ||
        right.id.localeCompare(left.id),
    )[0];
  return latest?.state === "success" ? latest : undefined;
};

interface PullRequestEvidenceEvaluation {
  readonly reasons: readonly CompletionCandidateReason[];
  readonly evidenceObservationIds: readonly string[];
}

const evaluatePullRequestEvidence = (
  pullRequest: PullRequestSnapshot,
  policy: CompletionPolicyRevision,
  evidence: readonly CurrentDeliveryEvidence[],
): PullRequestEvidenceEvaluation => {
  const reasons = new Set<CompletionCandidateReason>();
  const evidenceIds = new Set<string>();
  if (pullRequest.state !== "merged") reasons.add("pull_request_not_merged");
  if (pullRequest.acceptedHeadSha === null) reasons.add("missing_accepted_head");
  if (pullRequest.mergeCommitSha === null) reasons.add("missing_merge_commit");
  if (
    pullRequest.state !== "merged" ||
    pullRequest.acceptedHeadSha === null ||
    pullRequest.mergeCommitSha === null
  ) {
    return { reasons: [...reasons], evidenceObservationIds: [] };
  }

  const repository = pullRequest.repository.toLowerCase();
  const pullRequestEvidence = matchingSuccess(
    evidence,
    (item) =>
      item.kind === "pull_request" &&
      item.repository === repository &&
      item.commitSha === pullRequest.mergeCommitSha &&
      item.correlationKind === "pull_request_merge" &&
      item.pullRequestRepository === repository &&
      item.pullRequestNumber === pullRequest.number,
  );
  if (pullRequestEvidence) evidenceIds.add(pullRequestEvidence.id);
  else reasons.add("missing_pull_request_evidence");

  for (const requiredCiName of policy.requiredCiNames) {
    const ciEvidence = matchingSuccess(
      evidence,
      (item) =>
        item.kind === "ci" &&
        item.repository === repository &&
        item.commitSha === pullRequest.acceptedHeadSha &&
        item.name === requiredCiName &&
        item.correlationKind === "pull_request_head" &&
        item.pullRequestRepository === repository &&
        item.pullRequestNumber === pullRequest.number,
    );
    if (ciEvidence) evidenceIds.add(ciEvidence.id);
    else reasons.add("missing_required_ci");
  }

  const deploymentEvidence = matchingSuccess(
    evidence,
    (item) =>
      item.kind === "deployment" &&
      item.repository === repository &&
      item.commitSha === pullRequest.mergeCommitSha &&
      item.environment !== null &&
      policy.productionEnvironments.includes(item.environment) &&
      item.correlationKind === "pull_request_merge" &&
      item.pullRequestRepository === repository &&
      item.pullRequestNumber === pullRequest.number,
  );
  if (deploymentEvidence) evidenceIds.add(deploymentEvidence.id);
  else reasons.add("missing_production_deployment");
  return {
    reasons: [...reasons],
    evidenceObservationIds: [...evidenceIds],
  };
};

export const evaluateCompletionCandidate = (
  input: CompletionCandidateInput,
): CompletionCandidateEvaluation => {
  const policy = normalizeCompletionPolicyRevision(input.policy);
  const reasons = new Set<CompletionCandidateReason>();
  const evidenceIds = new Set<string>();
  if (input.implementationPullRequests.length === 0) {
    reasons.add("missing_implementation_pull_request");
  }

  for (const pullRequest of input.implementationPullRequests) {
    const pullRequestEvaluation = evaluatePullRequestEvidence(
      pullRequest,
      policy,
      input.evidence,
    );
    for (const reason of pullRequestEvaluation.reasons) reasons.add(reason);
    for (const id of pullRequestEvaluation.evidenceObservationIds) {
      evidenceIds.add(id);
    }
  }

  if (input.hasUnfinishedChildren) reasons.add("unfinished_children");
  if (input.hasUnresolvedBlockingAttention) {
    reasons.add("unresolved_blocking_attention");
  }
  const evaluatedAt = normalizeTimestamp(input.evaluatedAt, "evaluatedAt");
  return {
    workItemId: normalizeText(input.workItemId, "workItemId"),
    policyId: policy.policyId,
    policyRevision: policy.revision,
    candidate: reasons.size === 0,
    reasons: [...reasons],
    evidenceObservationIds: [...evidenceIds].sort((left, right) =>
      left.localeCompare(right),
    ),
    evaluatedAt,
  };
};
