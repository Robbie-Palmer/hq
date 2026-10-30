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
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "recipe-url-corpus-stage-"),
  );
  temporaryDirectories.push(directory);
  return path.join(directory, name);
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
});
