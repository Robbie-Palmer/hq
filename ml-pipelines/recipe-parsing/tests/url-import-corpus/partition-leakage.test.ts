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
const CORPUS_ROOT = path.join(PROJECT_ROOT, "data/url-import-corpus/v1");

describe("URL-import corpus partition isolation", () => {
  it("keeps source groups and pattern families in one partition", () => {
    const train = loadPartitionManifest(CORPUS_ROOT, "train");
    const currentDevelopment = loadPartitionManifest(
      CORPUS_ROOT,
      "development",
    );
    const holdout = loadPartitionManifest(CORPUS_ROOT, "holdout");
    const manifests = [train, currentDevelopment, holdout];
    expect(() => assertNoPartitionLeakage(manifests)).not.toThrow();

    const development = structuredClone(currentDevelopment);
    const developmentFixture = development.fixtures[0];
    const trainFixture = train.fixtures[0];
    if (!developmentFixture || !trainFixture) throw new Error("fixtures missing");
    developmentFixture.sourceGroup = trainFixture.sourceGroup;
    expect(() =>
      assertNoPartitionLeakage([train, development, holdout]),
    ).toThrow("sourceGroup crosses partitions");
  });

  it("requires an explicit final-evaluation purpose for holdout", () => {
    expect(replayPartitions({})).toEqual(["train", "development"]);
    expect(() => replayPartitions({ partitions: ["holdout"] })).toThrow(
      "routine replay leaves it untouched",
    );
    expect(
      replayPartitions({
        partitions: ["holdout"],
        purpose: "final-evaluation",
      }),
    ).toEqual(["holdout"]);
  });

  it("does not read or parse holdout during routine replay", async () => {
    const parser = vi.fn().mockResolvedValue(null);
    const report = await replayCorpus(CORPUS_ROOT, {}, parser);

    expect(report.partitions).toEqual(["train", "development"]);
    expect(report.records).toHaveLength(5);
    expect(report.records.every(({ partition }) => partition !== "holdout")).toBe(
      true,
    );
    expect(parser).toHaveBeenCalledTimes(5);
  });

  it("keeps holdout files out of the routine DVC replay stage", () => {
    const dvc = parse(
      fs.readFileSync(path.join(PROJECT_ROOT, "dvc.yaml"), "utf8"),
    ) as { stages: { replay_url_import_corpus: { cmd: string; deps: string[] } } };
    const replayStage = dvc.stages.replay_url_import_corpus;

    expect(replayStage.cmd).not.toContain("holdout");
    expect(replayStage.deps.some((dependency) => dependency.includes("holdout"))).toBe(
      false,
    );
  });
});
