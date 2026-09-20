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
