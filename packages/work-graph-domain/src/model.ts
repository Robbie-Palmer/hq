import type {
  ArchitectureDecisionRole,
  CompletionCandidateReason,
  DeliveryActionKind,
  DeliveryActionResultState,
  DeliveryEvidenceKind,
  DeliveryEvidenceState,
  DeliveryRecoveryDeliveryKind,
  DeliveryRecoveryFallback,
  EvidenceCorrelationKind,
  KnowledgeScopeKind,
  KnowledgeScopeLifecycle,
  PullRequestCheckSummary,
  PullRequestMergeability,
  PullRequestReviewDecision,
  PullRequestRole,
  PullRequestState,
  WorkItemContextKind,
  WorkItemLifecycle,
} from "./vocabulary";

export interface KnowledgeScope {
  readonly id: string;
  readonly kind: KnowledgeScopeKind;
  readonly title: string;
  readonly canonicalUrl: string;
  readonly markdownUrl: string;
  readonly sourceRevision: string | null;
  readonly lifecycle: KnowledgeScopeLifecycle;
  readonly archiveReason: string | null;
  readonly rank: number | null;
}

export interface KnowledgeScopeInput {
  readonly id: string;
  readonly kind: KnowledgeScopeKind;
  readonly title: string;
  readonly canonicalUrl: string;
  readonly markdownUrl: string;
  readonly sourceRevision?: string | null;
  readonly rank?: number | null;
}

export interface KnowledgeScopeRelationship {
  readonly parentKnowledgeScopeId: string;
  readonly childKnowledgeScopeId: string;
}

export interface WorkItem {
  readonly id: string;
  readonly title: string;
  readonly lifecycle: WorkItemLifecycle;
  readonly parentId: string | null;
  readonly rank: number | null;
  readonly priorityRank: number | null;
  readonly schedulingInitiativeId: string | null;
  readonly schedulingProjectId: string | null;
  readonly expedited: boolean;
  readonly expediteReason: string | null;
}

export interface WorkItemInput {
  readonly id: string;
  readonly title: string;
  readonly lifecycle?: WorkItemLifecycle;
  readonly parentId?: string | null;
  readonly rank?: number | null;
  readonly priorityRank?: number | null;
  readonly schedulingInitiativeId?: string | null;
  readonly schedulingProjectId?: string | null;
  readonly expedited?: boolean;
  readonly expediteReason?: string | null;
}

export type NewWorkItemInput = Omit<WorkItemInput, "lifecycle" | "rank">;

export interface WorkItemDependency {
  readonly dependentWorkItemId: string;
  readonly blockerWorkItemId: string;
}

export interface WorkItemContext {
  readonly workItemId: string;
  readonly kind: WorkItemContextKind;
  readonly content: string;
}

export interface WorkItemArchitectureDecision {
  readonly workItemId: string;
  readonly title: string;
  readonly url: string;
  readonly role: ArchitectureDecisionRole;
}

export interface WorkItemReference {
  readonly workItemId: string;
  readonly title: string;
  readonly url: string;
}

export interface PullRequestSnapshot {
  readonly repository: string;
  readonly number: number;
  readonly url: string;
  readonly headSha: string;
  readonly acceptedHeadSha: string | null;
  readonly mergeCommitSha: string | null;
  readonly state: PullRequestState;
  readonly draft: boolean;
  readonly mergeability: PullRequestMergeability;
  readonly reviewDecision: PullRequestReviewDecision | null;
  readonly checkSummary: PullRequestCheckSummary;
  readonly observedAt: string;
  readonly changedPaths?: string[];
  readonly deliveryMetadataSourceRevision?: string;
}

export interface ExternalDelivery {
  readonly provider: string;
  readonly externalId: string;
  readonly payloadDigest: string;
  readonly receivedAt: string;
  readonly ingestedAt: string;
}

export interface DeliveryEvidenceObservation {
  readonly id: string;
  readonly deliveryProvider: string;
  readonly deliveryExternalId: string;
  readonly provider: string;
  readonly externalId: string;
  readonly repository: string;
  readonly commitSha: string;
  readonly kind: DeliveryEvidenceKind;
  readonly state: DeliveryEvidenceState;
  readonly name: string | null;
  readonly environment: string | null;
  readonly sourceUrl: string;
  readonly providerObservedAt: string;
  readonly ingestedAt: string;
  readonly correlationKind: EvidenceCorrelationKind;
  readonly pullRequestRepository: string | null;
  readonly pullRequestNumber: number | null;
}

export interface CurrentDeliveryEvidence
  extends DeliveryEvidenceObservation {
  readonly projectedAt: string;
}

export interface CompletionPolicyRevision {
  readonly policyId: string;
  readonly revision: number;
  readonly requiredCiNames: readonly string[];
  readonly productionEnvironments: readonly string[];
  readonly automaticRelease: boolean;
  readonly createdAt: string;
}

export interface RepositoryCompletionPolicyDefaultRevision {
  readonly repository: string;
  readonly revision: number;
  readonly policyId: string;
  readonly policyRevision: number;
  readonly enabled: boolean;
  readonly createdAt: string;
}

export interface CompletionCandidateEvaluation {
  readonly workItemId: string;
  readonly policyId: string;
  readonly policyRevision: number;
  readonly candidate: boolean;
  readonly reasons: readonly CompletionCandidateReason[];
  readonly evidenceObservationIds: readonly string[];
  readonly evaluatedAt: string;
}

export interface DeliveryActionRequest {
  readonly id: string;
  readonly workItemId: string;
  readonly kind: DeliveryActionKind;
  readonly provider: "github";
  readonly evidenceKind: "pull_request" | "deployment";
  readonly evidenceExternalId: string;
  readonly repository: string;
  readonly commitSha: string;
  readonly policyId: string;
  readonly policyRevision: number;
  readonly initiatingSessionId: string | null;
  readonly unavailableSessionFallback: DeliveryRecoveryFallback;
  readonly requestedAt: string;
}

export interface DeliveryActionResult {
  readonly id: string;
  readonly requestId: string;
  readonly evidenceObservationId: string;
  readonly state: DeliveryActionResultState;
  readonly recordedAt: string;
}

export interface DeliveryRecoveryRecord {
  readonly id: string;
  readonly workItemId: string;
  readonly actionRequestId: string;
  readonly actionResultId: string;
  readonly initiatingSessionId: string | null;
  readonly unavailableSessionFallback: DeliveryRecoveryFallback;
  readonly attentionRequestId: string;
  readonly createdAt: string;
  readonly resolvedAt: string | null;
  readonly evidence: {
    readonly provider: string;
    readonly externalId: string;
    readonly repository: string;
    readonly commitSha: string;
    readonly kind: "pull_request" | "deployment";
    readonly state: "failure" | "cancelled";
    readonly sourceUrl: string;
    readonly observedAt: string;
  };
}

export interface DeliveryRecoveryDelivery {
  readonly id: string;
  readonly recoveryId: string;
  readonly kind: DeliveryRecoveryDeliveryKind;
  readonly targetSessionId: string | null;
  readonly reservedAt: string;
}

export interface WorkItemPullRequest {
  readonly workItemId: string;
  readonly repository: string;
  readonly number: number;
  readonly role: PullRequestRole;
}

export interface WorkGraph {
  readonly workItems: readonly WorkItem[];
  readonly dependencies: readonly WorkItemDependency[];
  readonly contexts: readonly WorkItemContext[];
  readonly architectureDecisions: readonly WorkItemArchitectureDecision[];
  readonly references: readonly WorkItemReference[];
  readonly pullRequests: readonly PullRequestSnapshot[];
  readonly workItemPullRequests: readonly WorkItemPullRequest[];
}

export interface WorkGraphInput {
  readonly workItems?: readonly WorkItemInput[];
  readonly dependencies?: readonly WorkItemDependency[];
  readonly contexts?: readonly WorkItemContext[];
  readonly architectureDecisions?: readonly WorkItemArchitectureDecision[];
  readonly references?: readonly WorkItemReference[];
  readonly pullRequests?: readonly PullRequestSnapshot[];
  readonly workItemPullRequests?: readonly WorkItemPullRequest[];
}

export interface WorkItemLeaseProjection {
  readonly expiresAt: number;
}

export interface WorkItemOperationalState {
  readonly currentLease?: WorkItemLeaseProjection | null;
  readonly hasUnresolvedBlockingAttention?: boolean;
  readonly now?: number;
}
