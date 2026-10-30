import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { replayCorpus } from "../../src/url-import-corpus/replay.js";

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
});
