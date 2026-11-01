import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import {
  assertNoPartitionLeakage,
  loadPartitionManifest,
} from "../../src/url-import-corpus/corpus.js";
import {
  replayCorpus,
  replayPartitions,
} from "../../src/url-import-corpus/replay.js";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const CORPUS_ROOT = path.join(
  PROJECT_ROOT,
  "data/url-import-corpus/synthetic/v1",
);

describe("URL-import corpus partition isolation", () => {
  it("keeps source groups and pattern families in one partition", () => {
    const train = loadPartitionManifest(CORPUS_ROOT, "train");
    const currentDevelopment = loadPartitionManifest(
      CORPUS_ROOT,
      "development",
    );
    const regression = loadPartitionManifest(CORPUS_ROOT, "regression");
    const manifests = [train, currentDevelopment, regression];
    expect(() => assertNoPartitionLeakage(manifests)).not.toThrow();

    const development = structuredClone(currentDevelopment);
    const developmentFixture = development.fixtures[0];
    const trainFixture = train.fixtures[0];
    if (!developmentFixture || !trainFixture) throw new Error("fixtures missing");
    developmentFixture.sourceGroup = trainFixture.sourceGroup;
    expect(() =>
      assertNoPartitionLeakage([train, development, regression]),
    ).toThrow("sourceGroup crosses partitions");

    developmentFixture.artifact.path = developmentFixture.artifact.path.replace(
      "snapshots/development/",
      "snapshots/train/",
    );
    expect(() =>
      assertNoPartitionLeakage([train, development, regression]),
    ).toThrow("sourceGroup crosses partitions");
  });

  it("selects synthetic regression fixtures explicitly", () => {
    expect(replayPartitions({})).toEqual(["train", "development"]);
    expect(replayPartitions({ partitions: ["regression"] })).toEqual([
      "regression",
    ]);
  });

  it("keeps unresolved synthetic regressions outside gating replay", async () => {
    const parser = vi.fn().mockResolvedValue(null);
    const report = await replayCorpus(CORPUS_ROOT, {}, parser);

    expect(report.partitions).toEqual(["train", "development"]);
    expect(report.records).toHaveLength(5);
    expect(report.records.every(({ partition }) => partition !== "regression")).toBe(
      true,
    );
    expect(parser).toHaveBeenCalledTimes(5);
  });

  it("keeps unresolved synthetic regressions outside gating DVC replay", () => {
    const dvc = parse(
      fs.readFileSync(path.join(PROJECT_ROOT, "dvc.yaml"), "utf8"),
    ) as {
      stages: {
        evaluate_url_import_baseline: { cmd: string; deps: string[] };
        replay_url_import_corpus: { cmd: string; deps: string[] };
      };
    };
    const replayStage = dvc.stages.replay_url_import_corpus;
    const baselineStage = dvc.stages.evaluate_url_import_baseline;

    expect(replayStage.cmd).not.toContain("final-evaluation");
    expect(replayStage.deps.some((dependency) => dependency.includes("regression"))).toBe(
      false,
    );
    expect(
      baselineStage.deps.some(
        (dependency) =>
          dependency.includes("manifests/regression.json") ||
          dependency.includes("snapshots/regression"),
      ),
    ).toBe(false);
    expect(baselineStage.deps).toContain("../../packages/ts-base/src");
  });
});
