import {
  ARCHITECTURE_DECISION_ROLES,
  KNOWLEDGE_SCOPE_KINDS,
  LEASE_OUTCOMES,
  PULL_REQUEST_ROLES,
  TERMINAL_WORK_ITEM_STATES,
  WORK_ITEM_LIFECYCLES,
  WORK_STAGES,
  WORK_ITEM_CONTEXT_KINDS,
} from "../src/index";

describe("work graph vocabulary", () => {
  it("limits knowledge mirrors to scheduling scope kinds", () => {
    expect(KNOWLEDGE_SCOPE_KINDS).toEqual(["initiative", "project"]);
  });

  it("shares canonical terminal values across lifecycle and board stage", () => {
    expect(TERMINAL_WORK_ITEM_STATES).toEqual(["released", "cancelled"]);
    expect(WORK_ITEM_LIFECYCLES).toEqual(["open", "released", "cancelled"]);
    expect(WORK_STAGES).toEqual([
      "blocked",
      "ready",
      "in_progress",
      "stale",
      "needs_attention",
      "released",
      "cancelled",
    ]);
  });

  it("keeps lease outcomes as separate historical vocabulary", () => {
    expect(LEASE_OUTCOMES).toEqual([
      "released",
      "cancelled",
      "decomposed",
      "attention_requested",
      "expired",
    ]);
  });

  it("keeps pull request links semantically typed", () => {
    expect(PULL_REQUEST_ROLES).toEqual([
      "implementation",
      "evidence",
      "related",
    ]);
  });

  it("uses explicit work-item context vocabularies", () => {
    expect(WORK_ITEM_CONTEXT_KINDS).toEqual(["brief", "acceptance_criteria"]);
    expect(ARCHITECTURE_DECISION_ROLES).toEqual([
      "governing",
      "background",
    ]);
  });
});
