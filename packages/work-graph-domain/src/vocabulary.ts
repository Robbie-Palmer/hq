export const TERMINAL_WORK_ITEM_STATES = ["released", "cancelled"] as const;

export type TerminalWorkItemState =
  (typeof TERMINAL_WORK_ITEM_STATES)[number];

export const WORK_ITEM_LIFECYCLES = [
  "open",
  ...TERMINAL_WORK_ITEM_STATES,
] as const;

export type WorkItemLifecycle = (typeof WORK_ITEM_LIFECYCLES)[number];

export const WORK_STAGES = [
  "blocked",
  "ready",
  "in_progress",
  "stale",
  "needs_attention",
  ...TERMINAL_WORK_ITEM_STATES,
] as const;

export type WorkStage = (typeof WORK_STAGES)[number];

export const LEASE_OUTCOMES = [
  ...TERMINAL_WORK_ITEM_STATES,
  "decomposed",
  "attention_requested",
  "expired",
] as const;

export type LeaseOutcome = (typeof LEASE_OUTCOMES)[number];

export const PULL_REQUEST_ROLES = [
  "implementation",
  "evidence",
  "related",
] as const;

export type PullRequestRole = (typeof PULL_REQUEST_ROLES)[number];

export const PULL_REQUEST_STATES = ["open", "closed", "merged"] as const;

export type PullRequestState = (typeof PULL_REQUEST_STATES)[number];

export const PULL_REQUEST_MERGEABILITIES = [
  "mergeable",
  "conflicting",
  "unknown",
] as const;

export type PullRequestMergeability =
  (typeof PULL_REQUEST_MERGEABILITIES)[number];

export const PULL_REQUEST_REVIEW_DECISIONS = [
  "approved",
  "changes_requested",
  "review_required",
] as const;

export type PullRequestReviewDecision =
  (typeof PULL_REQUEST_REVIEW_DECISIONS)[number];

export const PULL_REQUEST_CHECK_SUMMARIES = [
  "success",
  "failure",
  "pending",
  "neutral",
  "unknown",
] as const;

export type PullRequestCheckSummary =
  (typeof PULL_REQUEST_CHECK_SUMMARIES)[number];

export const DELIVERY_EVIDENCE_KINDS = [
  "pull_request",
  "ci",
  "deployment",
] as const;

export type DeliveryEvidenceKind = (typeof DELIVERY_EVIDENCE_KINDS)[number];

export const DELIVERY_EVIDENCE_STATES = [
  "pending",
  "success",
  "failure",
  "cancelled",
] as const;

export type DeliveryEvidenceState =
  (typeof DELIVERY_EVIDENCE_STATES)[number];

export const EVIDENCE_CORRELATION_KINDS = [
  "unmatched",
  "pull_request_head",
  "pull_request_merge",
] as const;

export type EvidenceCorrelationKind =
  (typeof EVIDENCE_CORRELATION_KINDS)[number];

export const COMPLETION_CANDIDATE_REASONS = [
  "missing_implementation_pull_request",
  "pull_request_not_merged",
  "missing_accepted_head",
  "missing_merge_commit",
  "missing_pull_request_evidence",
  "missing_required_ci",
  "missing_production_deployment",
  "unfinished_children",
  "unresolved_blocking_attention",
] as const;

export type CompletionCandidateReason =
  (typeof COMPLETION_CANDIDATE_REASONS)[number];

export const WORK_ITEM_CONTEXT_KINDS = [
  "brief",
  "acceptance_criteria",
] as const;

export type WorkItemContextKind = (typeof WORK_ITEM_CONTEXT_KINDS)[number];

export const ARCHITECTURE_DECISION_ROLES = [
  "governing",
  "background",
] as const;

export type ArchitectureDecisionRole =
  (typeof ARCHITECTURE_DECISION_ROLES)[number];

export const KNOWLEDGE_SCOPE_KINDS = ["initiative", "project"] as const;

export type KnowledgeScopeKind = (typeof KNOWLEDGE_SCOPE_KINDS)[number];

export const KNOWLEDGE_SCOPE_LIFECYCLES = ["active", "archived"] as const;

export type KnowledgeScopeLifecycle =
  (typeof KNOWLEDGE_SCOPE_LIFECYCLES)[number];
