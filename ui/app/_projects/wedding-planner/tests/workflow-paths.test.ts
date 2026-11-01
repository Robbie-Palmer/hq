import { describe, expect, it } from "vitest";
import { workflowHref } from "@/app/_projects/wedding-planner/routes/workflow-paths";

describe("wedding workflow URLs", () => {
  it("maps every retained workflow to a stable route", () => {
    expect(workflowHref("readiness")).toBe("/wedding-planner/readiness");
    expect(workflowHref("bed_groups")).toBe("/wedding-planner/accommodation");
    expect(workflowHref("sharing")).toBe(
      "/wedding-planner/accommodation/sharing",
    );
    expect(workflowHref("inventory")).toBe(
      "/wedding-planner/accommodation/inventory",
    );
    expect(workflowHref("plan")).toBe("/wedding-planner/accommodation/rooms");
    expect(workflowHref("result")).toBe(
      "/wedding-planner/accommodation/result",
    );
    expect(workflowHref("tables")).toBe("/wedding-planner/seating");
    expect(workflowHref("music")).toBe("/wedding-planner/music");
    expect(workflowHref("exports")).toBe("/wedding-planner/exports");
  });

  it("keeps a selected guest in a meaningful deep link", () => {
    expect(workflowHref("guests", "guest / one")).toBe(
      "/wedding-planner/guests?guest=guest%20%2F%20one",
    );
  });
});
