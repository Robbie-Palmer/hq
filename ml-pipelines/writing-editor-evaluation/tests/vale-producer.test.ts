import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { sha256 } from "writing-editor-domain/suggestions";

import { runValeProducer, valeAlertToFinding } from "../src/run-vale";
import { ValeProducerRunSchema } from "../src/schemas";

const temporaryDirectories = new Set<string>();
const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const projectRoot = path.resolve(import.meta.dirname, "..");
const valeBinaryVersion = JSON.parse(
  fs.readFileSync(path.join(projectRoot, "params.yaml"), "utf8"),
).producers.vale.binaryVersion as string;
const fixtureProducerVersion = `vale@${valeBinaryVersion}+rules.fixture`;

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

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function fakeVale(temporary: string, body: string): string {
  const binary = path.join(temporary, "vale-fixture");
  fs.writeFileSync(binary, `#!/usr/bin/env bash\n${body}\n`);
  fs.chmodSync(binary, 0o755);
  return binary;
}

function fixture(temporary: string): {
  cohortFile: string;
  corpusRoot: string;
  paramsFile: string;
  outputFile: string;
} {
  const corpusRoot = path.join(temporary, "corpus");
  const sourceFile = "artifacts/example/source.md";
  const source = "# Draft\n\nCafé is evidence, not merely polish.\n";
  fs.mkdirSync(path.join(corpusRoot, "artifacts/example"), { recursive: true });
  fs.writeFileSync(path.join(corpusRoot, sourceFile), source);
  const contentHash = sha256(source);

  const cohortFile = path.join(temporary, "cohort.json");
  const paramsFile = path.join(temporary, "params.json");
  const outputFile = path.join(temporary, "vale.json");
  writeJson(cohortFile, {
    schemaVersion: 1,
    recordType: "writing-editor-frozen-cohort",
    cohortId: `cohort:v1:${"a".repeat(64)}`,
    datasetId: `dataset:v1:${"b".repeat(64)}`,
    frozenAt: "2026-09-09T00:00:00Z",
    seed: "fixture",
    splitRatios: { train: 0.6, validation: 0.2, holdout: 0.2 },
    entries: [{
      artifactId: "example",
      artifactType: "adr",
      path: "docs/example.md",
      outcomeStatus: "unrecorded",
      split: "train",
      source: {
        revision: "a".repeat(40),
        committedAt: "2026-09-08T00:00:00Z",
        contentHash,
        bytes: Buffer.byteLength(source),
        file: sourceFile,
      },
      published: {
        revision: "b".repeat(40),
        committedAt: "2026-09-09T00:00:00Z",
        contentHash: `sha256:${"c".repeat(64)}`,
        bytes: 1,
        file: "artifacts/example/published.md",
      },
    }],
  });
  writeJson(paramsFile, {
    cohort: {
      frozenAt: "2026-09-09T00:00:00Z",
      seed: "fixture",
      split: { train: 0.6, validation: 0.2, holdout: 0.2 },
      requiredArtifactTypes: ["adr"],
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
      vale: { binaryVersion: valeBinaryVersion, timeoutMs: 1_000 },
    },
    matching: { characterDiff: { maxEditLength: 1_000 } },
  });
  return { cohortFile, corpusRoot, paramsFile, outputFile };
}

describe("Vale producer", () => {
  it("converts inclusive character columns to exact UTF-8 byte spans", () => {
    const source = "# Draft\n\nCafé is evidence, not merely polish.\n";
    const record = valeAlertToFinding(
      source,
      "docs/example.md",
      "a".repeat(40),
      fixtureProducerVersion,
      {
        Span: [6, 21],
        Check: "Unslop.ContrastFormula",
        Message: "State the point directly",
        Severity: "error",
        Match: "is evidence, not",
        Line: 3,
      },
    );

    expect(record.finding.span).toEqual({
      startByte: Buffer.byteLength("# Draft\n\nCafé "),
      endByte: Buffer.byteLength("# Draft\n\nCafé is evidence, not"),
      sourceText: "is evidence, not",
    });
    expect(record.finding.category).toBe("style/unslop/contrast-formula");
    expect(record.finding).not.toHaveProperty("replacement");
  });

  it("rejects a Vale span outside the reported source line", () => {
    expect(() => valeAlertToFinding(
      "Direct prose.\n",
      "docs/example.md",
      "a".repeat(40),
      fixtureProducerVersion,
      {
        Span: [1, 30],
        Check: "Unslop.Example",
        Message: "Example",
        Severity: "error",
        Match: "Wrong!",
        Line: 1,
      },
    )).toThrow(/outside the source line/);
  });

  it("keeps source markup when Vale reports a normalized match", () => {
    const source = "Cooklang is the **content format**, not the interface.\n";
    const record = valeAlertToFinding(
      source,
      "docs/example.md",
      "a".repeat(40),
      fixtureProducerVersion,
      {
        Span: [10, 39],
        Check: "Unslop.ContrastFormula",
        Message: "State the point directly",
        Severity: "error",
        Match: "is the content format, not",
        Line: 1,
      },
    );

    expect(record.valeMatch).toBe("is the content format, not");
    expect(record.finding.span.sourceText).toBe("is the **content format**, not");
  });

  it("normalizes initialisms and word boundaries in rule categories", () => {
    const record = valeAlertToFinding(
      "Direct text.\n",
      "docs/example.md",
      "a".repeat(40),
      fixtureProducerVersion,
      {
        Span: [1, 6],
        Check: "NASAReadability.URLRule2",
        Message: "Example",
        Severity: "warning",
        Match: "Direct",
        Line: 1,
      },
    );

    expect(record.finding.category).toBe("style/nasa-readability/url-rule2");
  });

  it("rejects reversed, multiline, and missing-line alerts", () => {
    const alert = {
      Span: [1, 6],
      Check: "Unslop.Example",
      Message: "Example",
      Severity: "error",
      Match: "Direct",
      Line: 1,
    };
    const convert = (overrides: Record<string, unknown>) => valeAlertToFinding(
      "Direct text.\n",
      "docs/example.md",
      "a".repeat(40),
      fixtureProducerVersion,
      { ...alert, ...overrides },
    );

    expect(() => convert({ Span: [6, 1] })).toThrow(
      "Vale span end must be greater than or equal to its start",
    );
    expect(() => convert({ Match: "Direct\ntext" })).toThrow(
      "multiline Vale matches are not supported",
    );
    expect(() => convert({ Line: 3 })).toThrow("Vale reported missing line 3");
  });

  it("runs the pinned Vale binary and writes validated producer output", () => {
    const temporary = temporaryDirectory("writing-vale-");
    const options = fixture(temporary);

    const result = runValeProducer({
      ...options,
      configFile: path.join(repositoryRoot, ".vale.ini"),
      stylesDirectory: path.join(repositoryRoot, ".vale/styles/Unslop"),
      valeBinary: "vale",
    });

    expect(result.summary).toMatchObject({
      artifacts: 1,
      artifactsWithFindings: 1,
      findings: 1,
      bySeverity: { error: 1, warning: 0, suggestion: 0 },
    });
    expect(result.artifacts[0]?.findings[0]?.finding.span.sourceText)
      .toBe("is evidence, not merely");
    expect(ValeProducerRunSchema.parse(
      JSON.parse(fs.readFileSync(options.outputFile, "utf8")),
    )).toEqual(result);
  });

  it("rejects producer summaries that disagree with their artifacts", () => {
    const temporary = temporaryDirectory("writing-vale-summary-");
    const options = fixture(temporary);
    const result = runValeProducer({
      ...options,
      configFile: path.join(repositoryRoot, ".vale.ini"),
      stylesDirectory: path.join(repositoryRoot, ".vale/styles/Unslop"),
      valeBinary: "vale",
    });
    const mutations = [
      (value: typeof result) => value.summary.artifacts += 1,
      (value: typeof result) => value.summary.artifactsWithFindings = 0,
      (value: typeof result) => value.summary.findings += 1,
      (value: typeof result) => value.summary.bySeverity.warning += 1,
      (value: typeof result) => value.summary.byCheck = [{ check: "Other.Rule", count: 1 }],
    ];

    for (const mutate of mutations) {
      const tampered = structuredClone(result);
      mutate(tampered);
      expect(() => ValeProducerRunSchema.parse(tampered)).toThrow();
    }
  });

  it("stops when the installed Vale version differs from the pinned version", () => {
    const temporary = temporaryDirectory("writing-vale-version-");
    const options = fixture(temporary);
    const params = JSON.parse(fs.readFileSync(options.paramsFile, "utf8"));
    params.producers.vale.binaryVersion = "9.9.9";
    writeJson(options.paramsFile, params);

    expect(() => runValeProducer({
      ...options,
      configFile: path.join(repositoryRoot, ".vale.ini"),
      stylesDirectory: path.join(repositoryRoot, ".vale/styles/Unslop"),
      valeBinary: "vale",
    })).toThrow(`Vale version mismatch: expected 9.9.9, got ${valeBinaryVersion}`);
    expect(fs.existsSync(options.outputFile)).toBe(false);
  });

  it("rejects malformed version output and unexpected Vale result paths", () => {
    const invalidVersion = temporaryDirectory("writing-vale-invalid-version-");
    const invalidOptions = fixture(invalidVersion);
    expect(() => runValeProducer({
      ...invalidOptions,
      configFile: path.join(repositoryRoot, ".vale.ini"),
      stylesDirectory: path.join(repositoryRoot, ".vale/styles/Unslop"),
      valeBinary: fakeVale(invalidVersion, "echo 'not a Vale version'"),
    })).toThrow("cannot parse Vale version");

    const unexpected = temporaryDirectory("writing-vale-unexpected-");
    const unexpectedOptions = fixture(unexpected);
    const unexpectedBinary = fakeVale(unexpected, [
      "if [[ \"$1\" == \"--version\" ]]; then",
      `  echo 'vale version ${valeBinaryVersion}'`,
      "else",
      "  echo '{\"unexpected.md\":[]}'",
      "fi",
    ].join("\n"));
    expect(() => runValeProducer({
      ...unexpectedOptions,
      configFile: path.join(repositoryRoot, ".vale.ini"),
      stylesDirectory: path.join(repositoryRoot, ".vale/styles/Unslop"),
      valeBinary: unexpectedBinary,
    })).toThrow("Vale reported an unexpected file: unexpected.md");
  });

  it("rejects a failed Vale process even when it emits JSON", () => {
    const temporary = temporaryDirectory("writing-vale-failure-");
    const options = fixture(temporary);
    const binary = fakeVale(temporary, [
      "if [[ \"$1\" == \"--version\" ]]; then",
      `  echo 'vale version ${valeBinaryVersion}'`,
      "else",
      "  echo '{}'",
      "  echo 'fixture failure' >&2",
      "  exit 2",
      "fi",
    ].join("\n"));

    expect(() => runValeProducer({
      ...options,
      configFile: path.join(repositoryRoot, ".vale.ini"),
      stylesDirectory: path.join(repositoryRoot, ".vale/styles/Unslop"),
      valeBinary: binary,
    })).toThrow("Vale failed with status 2: fixture failure");
  });

  it("terminates Vale when it exceeds the configured timeout", () => {
    const temporary = temporaryDirectory("writing-vale-timeout-");
    const options = fixture(temporary);
    const params = JSON.parse(fs.readFileSync(options.paramsFile, "utf8"));
    params.producers.vale.timeoutMs = 500;
    writeJson(options.paramsFile, params);
    const binary = fakeVale(temporary, [
      "if [[ \"$1\" == \"--version\" ]]; then",
      `  echo 'vale version ${valeBinaryVersion}'`,
      "else",
      "  sleep 2",
      "  echo '{}'",
      "fi",
    ].join("\n"));

    expect(() => runValeProducer({
      ...options,
      configFile: path.join(repositoryRoot, ".vale.ini"),
      stylesDirectory: path.join(repositoryRoot, ".vale/styles/Unslop"),
      valeBinary: binary,
    })).toThrow(/ETIMEDOUT|Vale failed with status unknown/);
  });
});
