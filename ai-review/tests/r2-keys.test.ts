import { describe, expect, it } from "vitest";
import {
  findingEvidenceKey,
  findingOutcomeKey,
  findingRecordsPrefix,
  reviewRunTerminalKey,
} from "../src/r2-keys";

describe("AI review R2 keys", () => {
  const pullRequest = {
    repository: "acme/widgets",
    pullRequestNumber: 7,
  };

  it("keeps finding outcomes on the scorecard fixture path", () => {
    expect(findingRecordsPrefix(pullRequest)).toBe(
      "v2/acme/widgets/pr-7/findings",
    );
    expect(
      findingOutcomeKey({
        ...pullRequest,
        findingId: "f_fixed",
        outcomeVersion: 2,
      }),
    ).toBe("v2/acme/widgets/pr-7/findings/f_fixed/outcomes/v2.json");
  });

  it("keeps interaction evidence beside its finding", () => {
    expect(
      findingEvidenceKey({
        ...pullRequest,
        findingId: "f_fixed",
        deliveryId: "delivery-1",
      }),
    ).toBe("v2/acme/widgets/pr-7/findings/f_fixed/evidence/delivery-1.json");
  });

  it.each(["", ".", "..", " delivery", "delivery ", "delivery/1"])(
    "rejects an unsafe delivery ID segment: %s",
    (deliveryId) => {
      expect(() =>
        findingEvidenceKey({
          ...pullRequest,
          findingId: "f_fixed",
          deliveryId,
        }),
      ).toThrow("deliveryId must be a single R2 key segment");
    },
  );

  it.each(["", ".", "..", " finding", "finding ", "finding/1"])(
    "rejects an unsafe finding ID segment: %s",
    (findingId) => {
      expect(() =>
        findingOutcomeKey({
          ...pullRequest,
          findingId,
          outcomeVersion: 1,
        }),
      ).toThrow("findingId must be a single R2 key segment");
      expect(() =>
        findingEvidenceKey({
          ...pullRequest,
          findingId,
          deliveryId: "delivery-1",
        }),
      ).toThrow("findingId must be a single R2 key segment");
    },
  );

  it("keeps terminal records on the scorecard fixture path", () => {
    expect(
      reviewRunTerminalKey({
        ...pullRequest,
        headSha: "head-1",
        instanceId: "run-1",
        status: "published",
      }),
    ).toBe("v2/acme/widgets/pr-7/head-1/run-1/published.json");
  });

  it.each([
    ["headSha", ""],
    ["headSha", "../head"],
    ["instanceId", "."],
    ["instanceId", "run/1"],
  ] as const)("rejects an unsafe %s segment", (name, value) => {
    expect(() =>
      reviewRunTerminalKey({
        ...pullRequest,
        headSha: name === "headSha" ? value : "head-1",
        instanceId: name === "instanceId" ? value : "run-1",
        status: "published",
      }),
    ).toThrow(`${name} must be a single R2 key segment`);
  });

  it.each([
    "acme",
    "acme/widgets/extra",
    "/widgets",
    "acme/",
    "acme/../widgets",
    " acme/widgets",
  ])("rejects a non-canonical repository path: %s", (repository) => {
    expect(() =>
      findingRecordsPrefix({ ...pullRequest, repository }),
    ).toThrow("repository must use the canonical owner/name form");
  });
});
