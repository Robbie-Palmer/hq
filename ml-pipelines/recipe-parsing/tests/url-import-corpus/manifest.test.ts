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
const CORPUS_ROOT = path.join(
  PROJECT_ROOT,
  "data/url-import-corpus/synthetic/v1",
);
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
      corpusKind: "project-authored-synthetic",
      fixtureCount: 7,
      partitions: { train: 2, development: 3, regression: 2 },
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
      evaluationScope: {
        intendedUse: "deterministic-regression",
        realWorldHoldout: false,
        supportsRealWorldGeneralizationClaims: false,
        knownFailurePartition: "regression",
        knownFailuresGateRoutineReplay: false,
      },
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

  it("binds each catalog checksum to the manifest that validation loads", () => {
    const corpus = copiedCorpus();
    const catalogFile = path.join(corpus, "catalog.json");
    const catalog = JSON.parse(fs.readFileSync(catalogFile, "utf8")) as {
      partitions: Array<{ manifest: string; name: string }>;
    };
    const train = catalog.partitions.find(({ name }) => name === "train");
    if (!train) throw new Error("train catalog entry missing");
    train.manifest = "manifests/train-copy.json";
    fs.copyFileSync(
      path.join(corpus, "manifests/train.json"),
      path.join(corpus, train.manifest),
    );
    fs.writeFileSync(catalogFile, `${JSON.stringify(catalog, null, 2)}\n`);

    expect(() => validateCorpus(corpus)).toThrow(
      "train catalog manifest path is unexpected",
    );
  });

  it("rejects unreviewed rights", () => {
    const regression = loadPartitionManifest(CORPUS_ROOT, "regression");
    expect(() =>
      PartitionManifestSchema.parse({
        ...regression,
        fixtures: regression.fixtures.map((fixture, index) =>
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
