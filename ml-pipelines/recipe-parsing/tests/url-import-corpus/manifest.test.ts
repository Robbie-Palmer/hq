import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadPartitionManifest,
  validateCorpus,
} from "../../src/url-import-corpus/corpus.js";
import { PartitionManifestSchema } from "../../src/url-import-corpus/schema.js";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const CORPUS_ROOT = path.join(PROJECT_ROOT, "data/url-import-corpus/v1");
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

function copiedCorpus(): string {
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "recipe-url-corpus-"),
  );
  temporaryDirectories.push(temporaryRoot);
  const corpus = path.join(temporaryRoot, "v1");
  fs.cpSync(CORPUS_ROOT, corpus, { recursive: true });
  return corpus;
}

describe("URL-import corpus manifest", () => {
  it("validates every fixture, partition manifest, and immutable checksum", () => {
    expect(validateCorpus(CORPUS_ROOT)).toEqual({
      schemaVersion: 1,
      corpusVersion: "1.0.0",
      fixtureCount: 7,
      partitions: { train: 2, development: 3, holdout: 2 },
      coverage: [
        "conflicting-markup",
        "focaccia-known-failure",
        "incomplete-markup",
        "json-ld",
        "json-ld-graph",
        "known-failure",
        "malformed-json-ld",
        "unusual-ingredient-layout",
        "unusual-step-layout",
      ],
      holdout: { sealed: true, routineReplayAllowed: false },
    });
  });

  it("rejects an artifact changed after review", () => {
    const corpus = copiedCorpus();
    fs.appendFileSync(
      path.join(corpus, "snapshots/train/direct-jsonld.html"),
      "\n",
    );
    expect(() => validateCorpus(corpus)).toThrow("byte count does not match");
  });

  it("rejects unreviewed rights or an unsealed holdout", () => {
    const holdout = loadPartitionManifest(CORPUS_ROOT, "holdout");
    expect(() =>
      PartitionManifestSchema.parse({ ...holdout, sealed: false }),
    ).toThrow("only the holdout partition may be sealed");
    expect(() =>
      PartitionManifestSchema.parse({
        ...holdout,
        fixtures: holdout.fixtures.map((fixture, index) =>
          index === 0
            ? {
                ...fixture,
                rights: { ...fixture.rights, storageAllowed: false },
              }
            : fixture,
        ),
      }),
    ).toThrow();
  });
});
