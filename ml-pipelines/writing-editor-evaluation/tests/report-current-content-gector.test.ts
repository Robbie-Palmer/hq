import { describe, expect, it } from "vitest";
import type { GectorProducerRun } from "../src/schemas";

import { CurrentContentManifestSchema } from "../src/build-current-content-corpus";
import { createReport } from "../src/report-current-content-gector";

const parameters = {
  batchSize: 8,
  iterations: 5,
  maxTokens: 50,
  minTokens: 3,
  minErrorProbability: 0.9,
  minTokenProbability: 0,
  additionalConfidence: 0.5,
};

function run(
  artifacts: Array<{ path: string; suggestions: number; proposals: number }>,
): GectorProducerRun {
  const suggestion = {} as GectorProducerRun["artifacts"][number]["suggestions"][number];
  const proposal = {} as GectorProducerRun["artifacts"][number]["proposals"][number];
  const results = artifacts.map((artifact, index) => ({
    artifactId: `artifact-${index}`,
    source: { documentId: artifact.path },
    suggestions: Array.from({ length: artifact.suggestions }, () => suggestion),
    proposals: Array.from({ length: artifact.proposals }, () => proposal),
  })) as GectorProducerRun["artifacts"];
  return {
    parameters,
    artifacts: results,
    summary: {
      artifacts: results.length,
      artifactsWithSuggestions: results.filter(({ suggestions }) => suggestions.length > 0).length,
      suggestions: results.reduce((total, artifact) => total + artifact.suggestions.length, 0),
      proposals: results.reduce((total, artifact) => total + artifact.proposals.length, 0),
    },
  } as GectorProducerRun;
}

describe("current-content GECToR reporting", () => {
  it("summarizes profiles, content kinds, and highest-volume artifacts", () => {
    const manifest = CurrentContentManifestSchema.parse({
      schemaVersion: 1,
      recordType: "writing-editor-current-content-corpus",
      audience: "customer",
      datasetId: `dataset:v1:${"a".repeat(64)}`,
      revision: "b".repeat(40),
      entries: [
        {
          artifactId: "blog-example",
          kind: "blog",
          path: "ui/content/blog/example.mdx",
          file: "artifacts/blog-example/source.mdx",
          contentHash: `sha256:${"c".repeat(64)}`,
          bytes: 10,
        },
        {
          artifactId: "idea-example",
          kind: "idea",
          path: "ui/content/ideas/example.mdx",
          file: "artifacts/idea-example/source.mdx",
          contentHash: `sha256:${"d".repeat(64)}`,
          bytes: 12,
        },
      ],
      calibrationArtifactIds: ["blog-example"],
    });
    const calibrationRun = run([
      { path: "ui/content/blog/example.mdx", suggestions: 1, proposals: 1 },
    ]);
    const full = run([
      { path: "ui/content/blog/example.mdx", suggestions: 3, proposals: 2 },
      { path: "ui/content/ideas/example.mdx", suggestions: 1, proposals: 1 },
    ]);

    const report = createReport(manifest, {
      baseline: calibrationRun,
      balanced: calibrationRun,
      strict: calibrationRun,
    }, full);

    expect(report.corpus).toMatchObject({ audience: "customer", pages: 2, calibrationPages: 1 });
    expect(report.calibration.strict).toMatchObject({ proposals: 1, proposalsPerArtifact: 1 });
    expect(report.full.byKind).toEqual({
      blog: { artifacts: 1, artifactsWithSuggestions: 1, suggestions: 3, proposals: 2 },
      idea: { artifacts: 1, artifactsWithSuggestions: 1, suggestions: 1, proposals: 1 },
    });
    expect(report.full.topArtifacts.map(({ path }) => path)).toEqual([
      "ui/content/blog/example.mdx",
      "ui/content/ideas/example.mdx",
    ]);
  });
});
