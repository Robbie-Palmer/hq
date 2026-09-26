import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { extractDataset } from "../src/extract-dataset";
import { freezeCohort } from "../src/freeze-cohort";
import { readJson, resetDirectory, resolveContainedFile } from "../src/files";
import { fileAtRevision } from "../src/git-revisions";
import {
  CorpusSourceManifestSchema,
  FrozenCohortSchema,
  ReadinessSchema,
} from "../src/schemas";

const ARTIFACTS = [
  ["adr-alpha", "adr", "docs/adrs/alpha.md"],
  ["adr-beta", "adr", "docs/adrs/beta.md"],
  ["adr-gamma", "adr", "docs/adrs/gamma.md"],
  ["project-alpha", "project-page", "docs/projects/alpha.md"],
  ["project-beta", "project-page", "docs/projects/beta.md"],
  ["project-gamma", "project-page", "docs/projects/gamma.md"],
] as const;

const temporaryDirectories = new Set<string>();

afterEach(() => {
  for (const directory of temporaryDirectories) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  temporaryDirectories.clear();
});

function temporaryDirectory(prefix: string): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryDirectories.add(directory);
  return directory;
}

function git(repository: string, ...args: string[]): string {
  return execFileSync("git", ["-C", repository, ...args], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  }).trim();
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function createRepository(root: string): {
  sourceRevision: string;
  publishedRevision: string;
} {
  fs.mkdirSync(root, { recursive: true });
  git(root, "init", "--quiet");
  git(root, "config", "user.name", "Writing Fixture");
  git(root, "config", "user.email", "writing@example.test");
  for (const [artifactId, , file] of ARTIFACTS) {
    const absolute = path.join(root, file);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, `# ${artifactId}\n\nThis is not just useful, but important.\n`);
  }
  git(root, "add", ".");
  git(root, "commit", "--quiet", "-m", "Add drafts");
  const sourceRevision = git(root, "rev-parse", "HEAD");

  for (const [artifactId, , file] of ARTIFACTS) {
    fs.writeFileSync(
      path.join(root, file),
      `# ${artifactId}\n\nThis matters because readers can act on it.\n`,
    );
  }
  git(root, "add", ".");
  git(root, "commit", "--quiet", "-m", "Publish edits");
  return { sourceRevision, publishedRevision: git(root, "rev-parse", "HEAD") };
}

function writeManifest(
  file: string,
  revisions: { sourceRevision: string; publishedRevision: string },
): void {
  writeJson(file, {
    schemaVersion: 1,
    recordType: "writing-editor-corpus-source-manifest",
    entries: ARTIFACTS.map(([artifactId, artifactType, artifactPath]) => ({
      artifactId,
      artifactType,
      path: artifactPath,
      ...revisions,
      outcomeStatus: "unrecorded",
    })),
  });
}

function writeParams(file: string, seed = "fixture-seed"): void {
  writeJson(file, {
    cohort: {
      frozenAt: "2026-09-09T00:00:00Z",
      seed,
      split: { train: 0.34, validation: 0.33, holdout: 0.33 },
      requiredArtifactTypes: ["adr", "project-page"],
    },
    producers: {
      gector: {
        batchSize: 8,
        iterations: 5,
        maxTokens: 50,
        minTokens: 3,
        minErrorProbability: 0.65,
        minTokenProbability: 0,
        additionalConfidence: 0.1,
      },
      vale: { binaryVersion: "3.20.0", timeoutMs: 1_000 },
    },
    matching: { characterDiff: { maxEditLength: 1_000 } },
  });
}

describe("writing editor evaluation pipeline", () => {
  it("rejects corpus paths that escape lexically or through a symlink", () => {
    const temporary = temporaryDirectory("writing-paths-");
    const corpus = path.join(temporary, "corpus");
    const outside = path.join(temporary, "outside.md");
    fs.mkdirSync(corpus);
    fs.writeFileSync(outside, "outside\n");

    expect(() => resolveContainedFile(corpus, "../outside.md", "fixture source"))
      .toThrow("fixture source must resolve to a file within");

    const link = path.join(corpus, "linked.md");
    fs.symlinkSync(outside, link);
    expect(() => resolveContainedFile(corpus, "linked.md", "fixture source"))
      .toThrow("fixture source must resolve to a file within");
  });

  it("extracts exact content from immutable Git revisions", () => {
    const temporary = temporaryDirectory("writing-extract-");
    const repository = path.join(temporary, "repository");
    const revisions = createRepository(repository);
    const manifestFile = path.join(temporary, "corpus-manifest.json");
    const output = path.join(temporary, "corpus");
    writeManifest(manifestFile, revisions);

    const dataset = extractDataset({ manifestFile, repository, output, outputRoot: temporary });

    expect(dataset.entries).toHaveLength(6);
    expect(dataset.entries.map(({ artifactId }) => artifactId)).toEqual(
      [...dataset.entries.map(({ artifactId }) => artifactId)].sort(),
    );
    expect(dataset.datasetId).toMatch(/^dataset:v1:[a-f0-9]{64}$/);
    expect(dataset.entries[0]?.source.contentHash).not.toBe(
      dataset.entries[0]?.published.contentHash,
    );
    expect(fs.readFileSync(path.join(output, "artifacts/adr-alpha/source.md"), "utf8"))
      .toContain("not just useful");
    expect(fs.readFileSync(path.join(output, "artifacts/adr-alpha/published.md"), "utf8"))
      .toContain("readers can act");
    expect(readJson(path.join(output, "manifest.json"))).toEqual(dataset);

    const second = extractDataset({
      manifestFile,
      repository,
      output: path.join(temporary, "second-corpus"),
      outputRoot: temporary,
    });
    expect(second).toEqual(dataset);
  });

  it("keeps the canonical path when pinned revisions use historical paths", () => {
    const temporary = temporaryDirectory("writing-renamed-path-");
    const repository = path.join(temporary, "repository");
    const historicalPath = "docs/old-name.md";
    const canonicalPath = "docs/new-name.md";
    fs.mkdirSync(path.join(repository, "docs"), { recursive: true });
    git(repository, "init", "--quiet");
    git(repository, "config", "user.name", "Writing Fixture");
    git(repository, "config", "user.email", "writing@example.test");
    fs.writeFileSync(path.join(repository, historicalPath), "Draft text.\n");
    git(repository, "add", ".");
    git(repository, "commit", "--quiet", "-m", "Add draft at old path");
    const sourceRevision = git(repository, "rev-parse", "HEAD");
    fs.writeFileSync(path.join(repository, historicalPath), "Published text.\n");
    git(repository, "add", ".");
    git(repository, "commit", "--quiet", "-m", "Publish at old path");
    const publishedRevision = git(repository, "rev-parse", "HEAD");
    const manifestFile = path.join(temporary, "corpus-manifest.json");
    writeJson(manifestFile, {
      schemaVersion: 1,
      recordType: "writing-editor-corpus-source-manifest",
      entries: [{
        artifactId: "renamed-document",
        artifactType: "adr",
        path: canonicalPath,
        sourcePath: historicalPath,
        publishedPath: historicalPath,
        sourceRevision,
        publishedRevision,
        outcomeStatus: "unrecorded",
      }],
    });

    const dataset = extractDataset({
      manifestFile,
      repository,
      output: path.join(temporary, "corpus"),
      outputRoot: temporary,
    });

    expect(dataset.entries[0]?.path).toBe(canonicalPath);
    expect(dataset.entries[0]?.source.contentHash).not.toBe(
      dataset.entries[0]?.published.contentHash,
    );
  });

  it("validates every revision before replacing an existing output", () => {
    const temporary = temporaryDirectory("writing-invalid-");
    const repository = path.join(temporary, "repository");
    const revisions = createRepository(repository);
    const manifestFile = path.join(temporary, "corpus-manifest.json");
    const output = path.join(temporary, "corpus");
    writeManifest(manifestFile, revisions);
    const manifest = CorpusSourceManifestSchema.parse(readJson(manifestFile));
    writeJson(manifestFile, {
      ...manifest,
      entries: manifest.entries.map((entry, index) => index === 5
        ? { ...entry, publishedRevision: "f".repeat(40) }
        : entry),
    });
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, "sentinel"), "keep");

    expect(() => extractDataset({ manifestFile, repository, output, outputRoot: temporary }))
      .toThrow(/cat-file/);
    expect(fs.readFileSync(path.join(output, "sentinel"), "utf8")).toBe("keep");
  });

  it("rejects unsafe paths, duplicate IDs, and unchanged revision pairs", () => {
    const commit = "a".repeat(40);
    const base = {
      artifactId: "safe-id",
      artifactType: "adr",
      path: "docs/adr.md",
      sourceRevision: commit,
      publishedRevision: "b".repeat(40),
      outcomeStatus: "unrecorded",
    };
    const record = (entries: unknown[]) => ({
      schemaVersion: 1,
      recordType: "writing-editor-corpus-source-manifest",
      entries,
    });

    expect(CorpusSourceManifestSchema.safeParse(record([{ ...base, path: "../secret" }])).success)
      .toBe(false);
    expect(
      CorpusSourceManifestSchema.safeParse(record([{ ...base, sourcePath: "../secret" }])).success,
    ).toBe(false);
    expect(
      CorpusSourceManifestSchema.safeParse(record([{ ...base, publishedPath: "../secret" }])).success,
    ).toBe(false);
    expect(CorpusSourceManifestSchema.safeParse(record([base, base])).success).toBe(false);
    expect(
      CorpusSourceManifestSchema.safeParse(record([{
        ...base,
        publishedRevision: commit,
      }])).success,
    ).toBe(false);
  });

  it("reports the revision and path for invalid UTF-8 blobs", () => {
    const temporary = temporaryDirectory("writing-utf8-");
    const repository = path.join(temporary, "repository");
    fs.mkdirSync(path.join(repository, "docs"), { recursive: true });
    git(repository, "init", "--quiet");
    git(repository, "config", "user.name", "Writing Fixture");
    git(repository, "config", "user.email", "writing@example.test");
    fs.writeFileSync(path.join(repository, "docs/invalid.md"), Buffer.from([0xc3, 0x28]));
    git(repository, "add", ".");
    git(repository, "commit", "--quiet", "-m", "Add invalid UTF-8 fixture");
    const revision = git(repository, "rev-parse", "HEAD");

    expect(() => fileAtRevision(repository, revision, "docs/invalid.md"))
      .toThrow(`${revision}:docs/invalid.md is not valid UTF-8`);
  });

  it("refuses to reset the allowed output root or a directory outside it", () => {
    const allowed = temporaryDirectory("writing-allowed-output-");
    const outside = temporaryDirectory("writing-outside-output-");
    const sentinel = path.join(outside, "sentinel");
    fs.writeFileSync(sentinel, "keep");

    expect(() => resetDirectory(allowed, allowed)).toThrow(/unsafe output directory/);
    expect(() => resetDirectory(outside, allowed)).toThrow(/unsafe output directory/);
    expect(fs.readFileSync(sentinel, "utf8")).toBe("keep");
  });

  it("refuses to reset an output directory through a symbolic link", () => {
    const allowed = temporaryDirectory("writing-allowed-output-");
    const outside = temporaryDirectory("writing-outside-output-");
    const externalOutput = path.join(outside, "output");
    const sentinel = path.join(externalOutput, "sentinel");
    fs.mkdirSync(externalOutput);
    fs.writeFileSync(sentinel, "keep");

    const linked = path.join(allowed, "linked");
    fs.symlinkSync(outside, linked, process.platform === "win32" ? "junction" : "dir");

    expect(() => resetDirectory(path.join(linked, "output"), allowed))
      .toThrow(/symbolic link/);
    expect(fs.readFileSync(sentinel, "utf8")).toBe("keep");
  });

  it("freezes stratified splits and reports missing decision evidence", () => {
    const temporary = temporaryDirectory("writing-freeze-");
    const repository = path.join(temporary, "repository");
    const revisions = createRepository(repository);
    const manifestFile = path.join(temporary, "corpus-manifest.json");
    const corpus = path.join(temporary, "corpus");
    const paramsFile = path.join(temporary, "params.yaml");
    const output = path.join(temporary, "frozen");
    writeManifest(manifestFile, revisions);
    writeParams(paramsFile);
    const dataset = extractDataset({
      manifestFile,
      repository,
      output: corpus,
      outputRoot: temporary,
    });

    const result = freezeCohort({
      datasetFile: path.join(corpus, "manifest.json"),
      paramsFile,
      output,
      outputRoot: temporary,
    });

    expect(FrozenCohortSchema.parse(readJson(path.join(output, "cohort.json"))))
      .toEqual(result.cohort);
    expect(ReadinessSchema.parse(readJson(path.join(output, "readiness.json"))))
      .toEqual(result.readiness);
    expect(result.cohort.datasetId).toBe(dataset.datasetId);
    expect(result.cohort.entries).toHaveLength(6);
    for (const split of ["train", "validation", "holdout"] as const) {
      const entries = result.cohort.entries.filter((entry) => entry.split === split);
      expect(entries).toHaveLength(2);
      expect(new Set(entries.map(({ artifactType }) => artifactType))).toEqual(
        new Set(["adr", "project-page"]),
      );
    }
    expect(result.readiness).toMatchObject({
      ready: false,
      revisions: { complete: true, extractedPairs: 6, missingArtifactIds: [] },
      outcomes: { complete: false, recorded: 0 },
      coverage: {
        total: 6,
        requiredArtifactTypesPresent: true,
        byArtifactType: { adr: 3, "project-page": 3 },
      },
    });
    expect(result.readiness.outcomes.missingArtifactIds).toHaveLength(6);
    expect(fs.readFileSync(path.join(output, "readiness.md"), "utf8"))
      .toContain("Status: not ready");

    const repeated = freezeCohort({
      datasetFile: path.join(corpus, "manifest.json"),
      paramsFile,
      output: path.join(temporary, "repeated-frozen"),
      outputRoot: temporary,
    });
    expect(repeated).toEqual(result);

    writeParams(paramsFile, "another-seed");
    const changed = freezeCohort({
      datasetFile: path.join(corpus, "manifest.json"),
      paramsFile,
      output: path.join(temporary, "changed-frozen"),
      outputRoot: temporary,
    });
    expect(changed.cohort.cohortId).not.toBe(result.cohort.cohortId);
  });

  it("identifies artifacts without a usable revision pair", () => {
    const temporary = temporaryDirectory("writing-missing-revision-");
    const repository = path.join(temporary, "repository");
    const revisions = createRepository(repository);
    const manifestFile = path.join(temporary, "corpus-manifest.json");
    const corpus = path.join(temporary, "corpus");
    const datasetFile = path.join(temporary, "dataset.json");
    const paramsFile = path.join(temporary, "params.yaml");
    const output = path.join(temporary, "frozen");
    writeManifest(manifestFile, revisions);
    writeParams(paramsFile);
    const dataset = extractDataset({
      manifestFile,
      repository,
      output: corpus,
      outputRoot: temporary,
    });
    const [first, ...rest] = dataset.entries;
    if (!first) throw new Error("expected a fixture entry");
    writeJson(datasetFile, {
      ...dataset,
      entries: [
        { ...first, published: { ...first.published, contentHash: first.source.contentHash } },
        ...rest,
      ],
    });

    const result = freezeCohort({ datasetFile, paramsFile, output, outputRoot: temporary });

    expect(result.readiness.revisions).toEqual({
      complete: false,
      extractedPairs: 6,
      missingArtifactIds: [first.artifactId],
    });
    expect(result.readiness.ready).toBe(false);
    expect(fs.readFileSync(path.join(output, "readiness.md"), "utf8"))
      .toContain(`## Missing revision pairs\n\n- ${first.artifactId}`);
  });

  it("rejects split ratios that do not sum to one", () => {
    const temporary = temporaryDirectory("writing-ratios-");
    const paramsFile = path.join(temporary, "params.yaml");
    writeParams(paramsFile);
    const params = JSON.parse(fs.readFileSync(paramsFile, "utf8"));
    params.cohort.split.holdout = 0.4;
    writeJson(paramsFile, params);

    const repository = path.join(temporary, "repository");
    const revisions = createRepository(repository);
    const manifestFile = path.join(temporary, "manifest.json");
    const corpus = path.join(temporary, "corpus");
    writeManifest(manifestFile, revisions);
    extractDataset({ manifestFile, repository, output: corpus, outputRoot: temporary });

    expect(() => freezeCohort({
      datasetFile: path.join(corpus, "manifest.json"),
      paramsFile,
      output: path.join(temporary, "frozen"),
      outputRoot: temporary,
    })).toThrow(/sum to 1/);
  });
});
