import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { main as replay } from "../../src/stages/replay-url-import-corpus.js";
import { main as validate } from "../../src/stages/validate-url-import-corpus.js";

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

function outputFile(name: string): string {
  return path.join(temporaryDirectory(), name);
}

function temporaryDirectory(): string {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "recipe-url-corpus-stage-"),
  );
  temporaryDirectories.push(directory);
  return directory;
}

function copiedCorpus(): string {
  const corpus = path.join(temporaryDirectory(), "v1");
  fs.cpSync(CORPUS_ROOT, corpus, { recursive: true });
  return corpus;
}

describe("URL-import corpus stages", () => {
  it("writes the validation report for an explicit corpus", () => {
    const output = outputFile("validation.json");

    validate([
      "node",
      "validate-url-import-corpus.ts",
      "--corpus",
      CORPUS_ROOT,
      "--output",
      output,
    ]);

    expect(JSON.parse(fs.readFileSync(output, "utf8"))).toMatchObject({
      corpusVersion: "1.0.0",
      fixtureCount: 7,
      holdout: { routineReplayAllowed: false, sealed: true },
    });
  });

  it("writes a selected replay and validates enum arguments", async () => {
    const output = outputFile("replay.json");

    await replay([
      "node",
      "replay-url-import-corpus.ts",
      "--corpus",
      CORPUS_ROOT,
      "--output",
      output,
      "--partition",
      "development",
      "--purpose",
      "development",
    ]);

    expect(JSON.parse(fs.readFileSync(output, "utf8"))).toMatchObject({
      partitions: ["development"],
      purpose: "development",
      summary: { failed: 0, fixtures: 3, passed: 3 },
    });
    await expect(
      replay(["node", "replay-url-import-corpus.ts", "--partition", "invalid"]),
    ).rejects.toThrow();
  });

  it("rejects missing CLI argument values", async () => {
    expect(() =>
      validate(["node", "validate-url-import-corpus.ts", "--corpus"]),
    ).toThrow("Missing value for --corpus");
    expect(() =>
      validate([
        "node",
        "validate-url-import-corpus.ts",
        "--output",
        "--corpus",
        CORPUS_ROOT,
      ]),
    ).toThrow("Missing value for --output");
    await expect(
      replay(["node", "replay-url-import-corpus.ts", "--partition"]),
    ).rejects.toThrow("Missing value for --partition");
  });

  it("writes a failed replay report before rejecting the command", async () => {
    const corpus = copiedCorpus();
    const manifestFile = path.join(corpus, "manifests/train.json");
    const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8")) as {
      fixtures: Array<{
        expected: { recipe?: { title: string }; status: string };
      }>;
    };
    const successfulFixture = manifest.fixtures.find(
      ({ expected }) => expected.status === "success",
    );
    if (!successfulFixture?.expected.recipe) {
      throw new Error("successful train fixture missing");
    }
    successfulFixture.expected.recipe.title = "Intentional mismatch";
    fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
    const output = outputFile("failed-replay.json");

    await expect(
      replay([
        "node",
        "replay-url-import-corpus.ts",
        "--corpus",
        corpus,
        "--output",
        output,
        "--partition",
        "train",
      ]),
    ).rejects.toThrow("URL-import replay failed: 1 fixture(s)");
    expect(JSON.parse(fs.readFileSync(output, "utf8"))).toMatchObject({
      summary: { failed: 1, fixtures: 2, passed: 1 },
    });
  });
});
