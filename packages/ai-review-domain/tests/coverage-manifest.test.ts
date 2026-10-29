import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_REVIEW_SELECTOR_VERSION,
  ReviewCoverageManifestSchema,
  finalizeReviewCoverageManifest,
  reviseReviewPathDecisions,
  selectReviewPaths,
} from "../src/coverage-manifest";

interface CohortEntry {
  pullRequestNumber: number;
  headSha: string;
  changedPaths: string[];
}

const cohort = JSON.parse(
  readFileSync(
    new URL("./fixtures/selection-cohort.json", import.meta.url),
    "utf8",
  ),
) as CohortEntry[];

describe("review coverage manifest", () => {
  it("selects Markdown, MDX, and test files by default", () => {
    const result = selectReviewPaths([
      "README.md",
      "docs/decision.mdx",
      "src/parser.test.ts",
      "tests/parser.spec.py",
    ]);

    expect(result).toMatchObject({
      schemaVersion: 1,
      selectorVersion: DEFAULT_REVIEW_SELECTOR_VERSION,
      summary: { selected: 4, excluded: 0 },
    });
    expect(result.paths.every(({ decision }) => decision === "selected")).toBe(true);
  });

  it("assigns configured exclusion reasons and permits forced review", () => {
    const paths = [
      "pnpm-lock.yaml",
      "assets/diagram.png",
      "node_modules/package/index.ts",
      "src/client.generated.ts",
      "src/app.ts",
    ];
    const automatic = selectReviewPaths(paths);

    expect(automatic.paths).toEqual([
      { path: "assets/diagram.png", decision: "excluded", reasonCode: "configured-extension-exclusion" },
      { path: "node_modules/package/index.ts", decision: "excluded", reasonCode: "configured-directory-exclusion" },
      { path: "pnpm-lock.yaml", decision: "excluded", reasonCode: "configured-filename-exclusion" },
      { path: "src/app.ts", decision: "selected", reasonCode: "default-included" },
      { path: "src/client.generated.ts", decision: "excluded", reasonCode: "configured-generated-exclusion" },
    ]);
    expect(selectReviewPaths(paths, { force: true }).summary).toEqual({
      selected: 5,
      excluded: 0,
      completed: 0,
      failed: 0,
      waived: 0,
    });
  });

  it("records deterministic path transitions and terminal outcomes", () => {
    const selected = selectReviewPaths(["src/app.ts", "src/old.ts", "src/large.ts"]);
    const prepared = reviseReviewPathDecisions(selected, new Map([
      ["src/large.ts", { decision: "failed" as const, reasonCode: "review-failed-diff-unavailable" as const }],
      ["src/old.ts", { decision: "waived" as const, reasonCode: "review-waived-prior-coverage" as const }],
    ]));
    const completed = finalizeReviewCoverageManifest(prepared, "published");

    expect(completed.paths).toEqual([
      { path: "src/app.ts", decision: "completed", reasonCode: "review-completed" },
      { path: "src/large.ts", decision: "failed", reasonCode: "review-failed-diff-unavailable" },
      { path: "src/old.ts", decision: "waived", reasonCode: "review-waived-prior-coverage" },
    ]);
    expect(completed.summary).toEqual({
      selected: 0,
      excluded: 0,
      completed: 1,
      failed: 1,
      waived: 1,
    });
    expect(() => reviseReviewPathDecisions(selected, new Map([
      ["missing.ts", { decision: "failed", reasonCode: "review-run-failed" }],
    ]))).toThrow("Unknown review coverage path");
    expect(ReviewCoverageManifestSchema.parse(completed)).toEqual(completed);
    expect(() => ReviewCoverageManifestSchema.parse({
      ...completed,
      paths: [{ path: "src/app.ts", decision: "completed", reasonCode: "default-included" }],
      summary: { selected: 0, excluded: 0, completed: 1, failed: 0, waived: 0 },
    })).toThrow(/not valid for completed/);

    expect(finalizeReviewCoverageManifest(selected, "failed").paths[0]).toMatchObject({
      decision: "failed",
      reasonCode: "review-run-failed",
    });
    expect(finalizeReviewCoverageManifest(selected, "denied").paths[0]).toMatchObject({
      decision: "waived",
      reasonCode: "review-waived-policy-denied",
    });
    expect(finalizeReviewCoverageManifest(selected, "skipped").paths[0]).toMatchObject({
      decision: "waived",
      reasonCode: "review-waived-no-model-review",
    });
  });

  it.each(cohort)(
    "replays PR $pullRequestNumber without inference and accounts for every path",
    ({ changedPaths, headSha }) => {
      expect(headSha).toMatch(/^[a-f0-9]{40}$/);
      const first = selectReviewPaths(changedPaths);
      const second = selectReviewPaths([...changedPaths].reverse());

      expect(second).toEqual(first);
      expect(first.paths.map(({ path }) => path)).toEqual(
        [...changedPaths].sort((left, right) => left.localeCompare(right)),
      );
      expect(first.summary).toEqual({
        selected: changedPaths.length,
        excluded: 0,
        completed: 0,
        failed: 0,
        waived: 0,
      });
    },
  );
});
