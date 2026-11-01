import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assertReviewRulePreviewResolved,
  ReviewRuleConflictError,
  ReviewRulePreviewSchema,
  ReviewRuleSetSchema,
  previewReviewRules,
  resolveReviewRules,
  reviewLanguageForPath,
  type ReviewRuleSet,
} from "../src/rule-resolution";

interface CohortEntry {
  pullRequestNumber: number;
  headSha: string;
  changedPaths: string[];
}

function fixture<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"),
  ) as T;
}

const cohort = fixture<CohortEntry[]>("selection-cohort.json");
const ruleSet = ReviewRuleSetSchema.parse(
  fixture<unknown>("rule-set.json"),
);

describe("review rule resolution", () => {
  it("applies the versioned global-to-file precedence chain", () => {
    const preview = resolveReviewRules({
      repository: "Robbie-Palmer/hq",
      paths: [
        "ui/tests/components/recipes/shopping/shopping-list.test.tsx",
        "ui/components/recipes/shopping/shopping-list.tsx",
        "homelab/mise.toml",
      ],
      ruleSet,
    });

    expect(preview).toMatchObject({
      schemaVersion: 1,
      resolverVersion: "layered-review-rules-v1",
      ruleSetVersion: "frozen-cohort-rules-v1",
      conflicts: [],
    });
    expect(preview.paths).toEqual([
      {
        path: "homelab/mise.toml",
        language: "toml",
        effectiveRules: [
          {
            key: "focus",
            instruction: "Apply the repository review policy.",
            layer: "repository",
            ruleIds: ["repository-focus"],
            sources: [{
              kind: "configuration",
              reference: "fixture/repository",
              revision: "v1",
            }],
          },
        ],
      },
      {
        path: "ui/components/recipes/shopping/shopping-list.tsx",
        language: "typescript",
        effectiveRules: [
          expect.objectContaining({
            key: "focus",
            instruction: "Review shopping-list quantity and state transitions.",
            layer: "file",
            ruleIds: ["shopping-list-focus"],
          }),
        ],
      },
      {
        path: "ui/tests/components/recipes/shopping/shopping-list.test.tsx",
        language: "typescript",
        effectiveRules: [
          expect.objectContaining({
            key: "focus",
            instruction: "Review TypeScript runtime and type boundaries.",
            layer: "language",
            ruleIds: ["typescript-focus"],
          }),
          expect.objectContaining({
            key: "verification",
            layer: "directory",
            ruleIds: ["ui-test-verification"],
          }),
        ],
      },
    ]);
    expect(ReviewRulePreviewSchema.parse(preview)).toEqual(preview);
  });

  it("uses the deepest directory and retains agreeing sources", () => {
    const agreeingRuleSet: ReviewRuleSet = {
      schemaVersion: 1,
      ruleSetVersion: "agreement-v1",
      rules: [
        ...ruleSet.rules,
        {
          ruleId: "ui-test-verification-copy",
          key: "verification",
          instruction: "Check that assertions cover the changed behavior.",
          scope: { kind: "directory", directory: "ui/tests" },
          source: {
            kind: "configuration",
            reference: "fixture/copied-test-policy",
          },
        },
        {
          ruleId: "ui-outer-verification",
          key: "verification",
          instruction: "Check UI verification.",
          scope: { kind: "directory", directory: "ui" },
          source: { kind: "configuration", reference: "fixture/ui-policy" },
        },
      ],
    };

    const preview = resolveReviewRules({
      repository: "Robbie-Palmer/hq",
      paths: ["ui/tests/example.test.ts"],
      ruleSet: agreeingRuleSet,
    });
    expect(preview.paths[0]?.effectiveRules[1]).toMatchObject({
      key: "verification",
      ruleIds: ["ui-test-verification", "ui-test-verification-copy"],
      sources: [
        { kind: "configuration", reference: "fixture/copied-test-policy" },
        {
          kind: "repository",
          reference: "ui/tests/AGENTS.md",
          revision: "fixture-head",
        },
      ],
    });
  });

  it("reports deterministic same-rank conflicts and refuses resolution", () => {
    const conflictingRuleSet: ReviewRuleSet = {
      schemaVersion: 1,
      ruleSetVersion: "conflict-v1",
      rules: [
        {
          ruleId: "typescript-a",
          key: "focus",
          instruction: "Review runtime behavior.",
          scope: { kind: "language", language: "typescript" },
          source: { kind: "configuration", reference: "rules/a" },
        },
        {
          ruleId: "typescript-b",
          key: "focus",
          instruction: "Review public types.",
          scope: { kind: "language", language: "typescript" },
          source: { kind: "configuration", reference: "rules/b" },
        },
      ],
    };
    const options = {
      repository: "Robbie-Palmer/hq",
      paths: ["src/app.ts"],
      ruleSet: conflictingRuleSet,
    };

    expect(previewReviewRules(options).conflicts).toEqual([
      {
        path: "src/app.ts",
        key: "focus",
        layer: "language",
        candidates: [
          expect.objectContaining({
            instruction: "Review public types.",
            ruleIds: ["typescript-b"],
          }),
          expect.objectContaining({
            instruction: "Review runtime behavior.",
            ruleIds: ["typescript-a"],
          }),
        ],
      },
    ]);
    expect(() => resolveReviewRules(options)).toThrow(ReviewRuleConflictError);
    expect(() => resolveReviewRules(options)).toThrow("src/app.ts:focus");
  });

  it.each(cohort)(
    "previews frozen PR $pullRequestNumber without model or publication adapters",
    ({ changedPaths, headSha }) => {
      expect(headSha).toMatch(/^[a-f0-9]{40}$/);
      const first = resolveReviewRules({
        repository: "Robbie-Palmer/hq",
        paths: changedPaths,
        ruleSet,
      });
      const second = resolveReviewRules({
        repository: "Robbie-Palmer/hq",
        paths: [...changedPaths].reverse(),
        ruleSet,
      });

      expect(second).toEqual(first);
      expect(first.paths.map(({ path }) => path)).toEqual(
        [...changedPaths].sort((left, right) => left.localeCompare(right)),
      );
      expect(first.conflicts).toEqual([]);
    },
  );

  it("infers only stable, documented languages and rejects unsafe paths", () => {
    expect(reviewLanguageForPath("src/app.tsx")).toBe("typescript");
    expect(reviewLanguageForPath("Dockerfile")).toBe("dockerfile");
    expect(reviewLanguageForPath("mise.toml")).toBe("toml");
    expect(() => reviewLanguageForPath("../outside.ts")).toThrow(
      "normalized repository-relative path",
    );
  });

  it("rejects a preview that does not account for every selected path", () => {
    const preview = resolveReviewRules({
      repository: "Robbie-Palmer/hq",
      paths: ["src/app.ts"],
      ruleSet,
    });

    expect(() =>
      assertReviewRulePreviewResolved(preview, [
        "src/app.ts",
        "src/missing.ts",
      ]),
    ).toThrow("missing selected paths: src/missing.ts");
  });
});
