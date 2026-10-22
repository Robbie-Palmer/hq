import { describe, expect, it } from "vitest";
import {
  diffProjectReconciliation,
} from "../src/reconciliation.js";
import type {
  ResolvedProfilePolicy,
  ResolvedSelection,
} from "../src/profile.js";

function policy(
  id: string,
  slot: string,
  layer = "base",
): ResolvedProfilePolicy {
  return {
    id,
    layer,
    slot,
    mode: "required",
    decision: `platform:${id}`,
  };
}

function selection(
  id: string,
  slot: string,
  value: string,
  source: "default" | "override" = "default",
): ResolvedSelection {
  return {
    id,
    layer: "base",
    slot,
    kind: "technology",
    value,
    source,
    decision: source === "override" ? `project:${id}` : `platform:${id}`,
  };
}

describe("project reconciliation semantic diff", () => {
  it("classifies added, removed, and replaced policies and defaults", () => {
    const result = diffProjectReconciliation({
      previousPolicies: [
        policy("policy-old", "runtime"),
        policy("policy-removed", "removed"),
      ],
      currentPolicies: [
        policy("policy-new", "runtime"),
        policy("policy-added", "added"),
      ],
      previousDefaults: [
        selection("runtime-old", "runtime", "node-22"),
        selection("removed-old", "removed", "legacy"),
      ],
      currentDefaults: [
        selection("runtime-new", "runtime", "node-24"),
        selection("added-new", "added", "current"),
      ],
      previousSelections: [],
      currentSelections: [],
    });

    expect(result.policyChanges.map(({ kind, slot, disposition }) => ({
      kind,
      slot,
      disposition,
    }))).toEqual([
      { kind: "added", slot: "added", disposition: "automatic" },
      { kind: "removed", slot: "removed", disposition: "migration" },
      { kind: "replaced", slot: "runtime", disposition: "migration" },
    ]);
    expect(result.defaultChanges.map(({ kind, slot, disposition }) => ({
      kind,
      slot,
      disposition,
    }))).toEqual([
      { kind: "added", slot: "added", disposition: "automatic" },
      { kind: "removed", slot: "removed", disposition: "migration" },
      { kind: "replaced", slot: "runtime", disposition: "migration" },
    ]);
  });

  it("keeps active local overrides visible as manual decisions", () => {
    const active = selection(
      "override-runtime",
      "runtime",
      "bun",
      "override",
    );
    const result = diffProjectReconciliation({
      previousPolicies: [],
      currentPolicies: [],
      previousDefaults: [],
      currentDefaults: [],
      previousSelections: [active],
      currentSelections: [active],
    });

    expect(result.localOverrides).toEqual([
      {
        disposition: "manual_decision",
        slot: "runtime",
        previous: active,
        current: active,
        status: "preserved",
      },
    ]);
  });

  it("classifies added, removed, and changed local overrides", () => {
    const removed = selection("removed-old", "removed", "old", "override");
    const changedOld = selection("changed-old", "changed", "old", "override");
    const changedNew = selection("changed-new", "changed", "new", "override");
    const added = selection("added-new", "added", "new", "override");

    const result = diffProjectReconciliation({
      previousPolicies: [],
      currentPolicies: [],
      previousDefaults: [],
      currentDefaults: [],
      previousSelections: [removed, changedOld],
      currentSelections: [added, changedNew],
    });

    expect(result.localOverrides.map(({ slot, status }) => ({ slot, status })))
      .toEqual([
        { slot: "added", status: "added" },
        { slot: "changed", status: "changed" },
        { slot: "removed", status: "removed" },
      ]);
  });

  it("treats changed values under a reused id as replacements", () => {
    const oldPolicy = policy("runtime-policy", "runtime");
    const newPolicy = {
      ...oldPolicy,
      decision: "platform:updated-runtime-policy",
    };
    const oldSelection = selection("runtime", "runtime", "node-22");
    const newSelection = { ...oldSelection, value: "node-24" };

    const result = diffProjectReconciliation({
      previousPolicies: [oldPolicy],
      currentPolicies: [newPolicy],
      previousDefaults: [oldSelection],
      currentDefaults: [newSelection],
      previousSelections: [],
      currentSelections: [],
    });

    expect(result.policyChanges).toContainEqual(
      expect.objectContaining({ kind: "replaced", slot: "runtime" }),
    );
    expect(result.defaultChanges).toContainEqual(
      expect.objectContaining({ kind: "replaced", slot: "runtime" }),
    );
  });
});
