import { describe, expect, it } from "vitest";
import { goalDateChange } from "@/components/assettracker/decision-scenario-summary";

describe("goalDateChange", () => {
  it.each([
    [null, null, "does not reach the FI target within the comparison horizon."],
    [
      null,
      "2032-09-01",
      "reaches the FI target around Sep 2032, while the committed-only path does not reach it within the comparison horizon.",
    ],
    [
      "2032-09-01",
      null,
      "moves the FI target beyond the comparison horizon, from Sep 2032 on the committed-only path.",
    ],
    ["2032-09-01", "2032-09-30", "leaves the plan-aware FI date at Sep 2032."],
    [
      "2032-09-01",
      "2032-11-01",
      "moves the plan-aware FI date from Sep 2032 to Nov 2032, a 2-month delay.",
    ],
    [
      "2032-09-01",
      "2032-06-01",
      "moves the plan-aware FI date from Sep 2032 to Jun 2032, a 3-month advance.",
    ],
  ])("describes the change from %s to %s", (baseline, expected, message) => {
    expect(goalDateChange(baseline, expected)).toBe(message);
  });
});
