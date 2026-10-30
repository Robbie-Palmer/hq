import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  loadPartitionManifest,
} from "../../src/url-import-corpus/corpus.js";
import {
  replayCorpus,
} from "../../src/url-import-corpus/replay.js";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const CORPUS_ROOT = path.join(PROJECT_ROOT, "data/url-import-corpus/v1");

describe("URL-import corpus replay", () => {
  it("replays train and development snapshots without live HTTP", async () => {
    const first = await replayCorpus(CORPUS_ROOT);
    const second = await replayCorpus(CORPUS_ROOT);

    expect(second).toEqual(first);
    expect(first.partitions).toEqual(["train", "development"]);
    expect(first.records.map(({ fixtureId }) => fixtureId)).toEqual([
      "direct-jsonld",
      "graph-sections",
      "incomplete-defaults",
      "conflicting-recipes",
      "malformed-jsonld",
    ]);
    expect(first.summary).toEqual({ fixtures: 5, passed: 5, failed: 0 });
    expect(
      first.records.every(({ sourceUrl }) =>
        new URL(sourceUrl).hostname.endsWith(".fixtures.invalid"),
      ),
    ).toBe(true);
  });

  it("parses fixtures concurrently while preserving manifest order", async () => {
    const releases: Array<() => void> = [];
    const parser = vi.fn(
      () =>
        new Promise<null>((resolve) => {
          releases.push(() => resolve(null));
        }),
    );
    const replay = replayCorpus(
      CORPUS_ROOT,
      { partitions: ["train"] },
      parser,
    );

    await vi.waitFor(() => expect(parser).toHaveBeenCalledTimes(2));
    releases[1]?.();
    releases[0]?.();

    const report = await replay;
    expect(report.records.map(({ fixtureId }) => fixtureId)).toEqual([
      "direct-jsonld",
      "graph-sections",
    ]);
  });

  it("ignores undefined optional parser fields when comparing ground truth", async () => {
    const development = loadPartitionManifest(CORPUS_ROOT, "development");
    const fixture = development.fixtures.find(
      ({ id }) => id === "incomplete-defaults",
    );
    if (fixture?.expected.status !== "success") {
      throw new Error("incomplete fixture missing");
    }
    const parser = vi.fn().mockResolvedValue({
      ...fixture.expected.recipe,
      prepTime: undefined,
      cookTime: undefined,
    });

    const report = await replayCorpus(
      CORPUS_ROOT,
      { partitions: ["development"] },
      parser,
    );

    expect(report.records[0]).toMatchObject({
      fixtureId: "incomplete-defaults",
      passed: true,
    });
  });
});
