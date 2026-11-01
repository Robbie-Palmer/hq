import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { createDecision } from "writing-editor-domain/decisions";
import { createFinding } from "writing-editor-domain/findings";
import { createProposal } from "writing-editor-domain/proposals";
import { createReviewReceipt } from "writing-editor-domain/review-receipt";
import { createSuggestion, sha256, sourceReference } from "writing-editor-domain/suggestions";

import {
  evaluatePublicationPilot,
  PublicationPilotPreregistrationSchema,
  renderPublicationPilotReport,
  runPublicationPilotCli,
} from "../src/evaluate-publication-pilot";

const projectRoot = path.resolve(import.meta.dirname, "..");

const temporaryDirectories = new Set<string>();

afterEach(() => {
  for (const directory of temporaryDirectories) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  temporaryDirectories.clear();
});

function temporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "publication-pilot-"));
  temporaryDirectories.add(directory);
  return directory;
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value)}\n`);
}

function git(repository: string, args: string[]): string {
  return execFileSync("/usr/bin/git", args, {
    cwd: repository,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function preregistration() {
  return {
    schemaVersion: 1,
    recordType: "writing-publication-pilot-preregistration",
    pilotId: "repository-publication-pilot-v1",
    preregisteredAt: "2026-10-25T22:04:29.000Z",
    sourceRevision: "a".repeat(40),
    cohort: {
      minimumArtifacts: 2,
      requiredMix: [
        { artifactType: "adr", minimum: 1 },
        { artifactType: "project-page", minimum: 1 },
      ],
      minimumNewArtifacts: 1,
      minimumMaterialRevisions: 1,
    },
    comparison: {
      design: "blinded-within-artifact",
      minimumReadersPerArtifact: 1,
      cognitiveLoadScale: { minimum: 1, maximum: 7, lowerIsBetter: true },
    },
    thresholds: {
      minimumUsefulEditYield: 0.6,
      minimumMedianTimeSavedFraction: 0.25,
      minimumReviewedPreferenceRate: 0.6,
      maximumMeanCognitiveLoadDelta: -0.5,
      maximumRegressionRate: 0,
      maximumUnwantedVoiceChangeRate: 0,
      requireZeroFactualRegressions: true,
      requireZeroTerminologyRegressions: true,
    },
  } as const;
}

function writeArtifact(
  root: string,
  artifactId: string,
  artifactType: "adr" | "project-page",
  changeKind: "new" | "material-revision",
  revisionCharacter: string,
) {
  const directory = path.join(root, artifactId);
  fs.mkdirSync(directory, { recursive: true });
  const raw = "Utilize this draft.";
  const reviewed = "Use this draft.";
  const published = `Use this ${artifactId} published draft.`;
  const revision = `${revisionCharacter}`.repeat(40);
  const source = sourceReference(`${artifactId}.mdx`, revision, raw);
  const producer = {
    id: "vale-deterministic",
    version: "vale@test",
    provenance: { kind: "rule" as const, ruleId: "Unslop.PlainWordsSafe" },
  };
  const suggestion = createSuggestion({
    producer,
    source,
    span: { startByte: 0, endByte: 7, sourceText: "Utilize" },
    replacement: "Use",
    category: "style/unslop/plain-words-safe",
    reason: "Use the plain replacement",
    confidence: 1,
  });
  const proposal = createProposal([suggestion]);
  const finding = createFinding({
    producer,
    source,
    span: { startByte: 13, endByte: 18, sourceText: "draft" },
    category: "style/unslop/plain-words",
    reason: "Confirm this word",
  });
  const records = {
    documentId: source.documentId,
    revision,
    findings: [finding],
    proposals: [proposal],
  };
  const decision = createDecision(proposal, "accepted", {
    reviewStartedAt: "2026-10-26T10:00:00.000Z",
    decidedAt: "2026-10-26T10:00:01.000Z",
  });
  const receipt = createReviewReceipt(records, [decision], raw, reviewed);
  fs.writeFileSync(path.join(directory, "raw.mdx"), raw);
  fs.writeFileSync(path.join(directory, "reviewed.mdx"), reviewed);
  fs.writeFileSync(path.join(directory, "published.mdx"), published);
  writeJson(path.join(directory, "records.json"), records);
  fs.writeFileSync(path.join(directory, "decisions.jsonl"), `${JSON.stringify(decision)}\n`);
  writeJson(path.join(directory, "receipt.json"), receipt);

  return {
    artifactId,
    artifactType,
    changeKind,
    sessionStartedAt: "2026-10-26T09:59:00.000Z",
    rawAgentDraftFile: `${artifactId}/raw.mdx`,
    editorReviewedFile: `${artifactId}/reviewed.mdx`,
    finalPublishedFile: `${artifactId}/published.mdx`,
    recordsFile: `${artifactId}/records.json`,
    decisionsFile: `${artifactId}/decisions.jsonl`,
    receiptFile: `${artifactId}/receipt.json`,
    finalManualReview: {
      startedAt: "2026-10-26T10:01:00.000Z",
      finishedAt: "2026-10-26T10:01:01.000Z",
      notes: ["Added the publication qualifier."],
    },
    priorManualWorkflow: {
      comparisonArtifactId: `historical-${artifactId}`,
      reviewMilliseconds: 10_000,
      method: "Matched historical artifact of the same type and length band.",
    },
    deterministicCatchFindingIds: [finding.findingId],
    quality: {
      factualPreservation: "pass",
      terminologyPreservation: "pass",
      unwantedVoiceChange: false,
      regression: "none",
      notes: [] as string[],
    },
    publication: {
      repositoryPath: `ui/content/${artifactId}.mdx`,
      revision,
      contentHash: sha256(published),
      publishedAt: "2026-10-26T11:00:00.000Z",
      finalReview: {
        reviewerId: "repository-owner",
        reviewedAt: "2026-10-26T10:30:00.000Z",
        approved: true,
      },
    },
  };
}

function writePublishedRepository(
  root: string,
  artifacts: ReturnType<typeof writeArtifact>[],
): string {
  const repositoryRoot = path.join(root, "repository");
  fs.mkdirSync(repositoryRoot, { recursive: true });
  git(repositoryRoot, ["init"]);
  git(repositoryRoot, ["config", "user.name", "Publication Pilot Test"]);
  git(repositoryRoot, ["config", "user.email", "publication-pilot@example.test"]);
  for (const artifact of artifacts) {
    const target = path.join(repositoryRoot, artifact.publication.repositoryPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, artifact.finalPublishedFile), target);
  }
  git(repositoryRoot, ["add", "."]);
  git(repositoryRoot, ["commit", "-m", "Add published pilot fixtures"]);
  const revision = git(repositoryRoot, ["rev-parse", "HEAD"]);
  for (const artifact of artifacts) artifact.publication.revision = revision;
  return repositoryRoot;
}

function writeFixture(options: { incomplete?: boolean; qualityFailure?: boolean } = {}) {
  const root = temporaryDirectory();
  const preregistrationFile = path.join(root, "preregistration.json");
  const evidenceFile = path.join(root, "evidence.json");
  const first = writeArtifact(root, "pilot-adr", "adr", "new", "b");
  const second = writeArtifact(
    root,
    "pilot-project-page",
    "project-page",
    "material-revision",
    "c",
  );
  if (options.qualityFailure) {
    second.quality.factualPreservation = "fail";
    second.quality.regression = "present";
    second.quality.notes = ["The reviewed result changed a date."];
  }
  const repositoryRoot = writePublishedRepository(root, [first, second]);
  const artifacts = options.incomplete ? [first] : [first, second];
  const readerComparisons = artifacts.map((artifact, index) => ({
    comparisonId: `comparison-${artifact.artifactId}`,
    artifactId: artifact.artifactId,
    readerId: `reader-${index}`,
    completedAt: "2026-10-26T12:00:00.000Z",
    blindingAttested: true,
    presentedFirst: index % 2 === 0 ? "a" : "b",
    variantA: index % 2 === 0 ? "raw" : "reviewed",
    variantB: index % 2 === 0 ? "reviewed" : "raw",
    variantAContentHash: sha256(index % 2 === 0
      ? "Utilize this draft."
      : "Use this draft."),
    variantBContentHash: sha256(index % 2 === 0
      ? "Use this draft."
      : "Utilize this draft."),
    preference: index % 2 === 0 ? "b" : "a",
    cognitiveLoad: index % 2 === 0 ? { a: 5, b: 2 } : { a: 2, b: 5 },
  }));
  writeJson(preregistrationFile, preregistration());
  writeJson(evidenceFile, {
    schemaVersion: 1,
    recordType: "writing-publication-pilot-evidence",
    pilotId: "repository-publication-pilot-v1",
    governance: {
      dataClassification: "private",
      consentBasis: "Fixture readers consented to evaluation use.",
      retentionPolicy: "Delete with the test fixture.",
      deletionStatus: "active",
    },
    artifacts,
    readerComparisons,
  });
  return { root, preregistrationFile, evidenceFile, repositoryRoot };
}

function evaluateFixture(fixture: ReturnType<typeof writeFixture>) {
  return evaluatePublicationPilot({
    preregistrationFile: fixture.preregistrationFile,
    evidenceFile: fixture.evidenceFile,
    evidenceRoot: fixture.root,
    repositoryRoot: fixture.repositoryRoot,
  });
}

function publicationPilotArgs(fixture: ReturnType<typeof writeFixture>): string[] {
  return [
    "--preregistration",
    fixture.preregistrationFile,
    "--evidence",
    fixture.evidenceFile,
    "--evidence-root",
    fixture.root,
    "--repository",
    fixture.repositoryRoot,
    "--output",
    "outputs/publication-pilot/report.json",
    "--report",
    "outputs/publication-pilot/report.md",
  ];
}

describe("publication pilot evaluation", () => {
  it("keeps the checked-in preregistration valid", () => {
    const value = JSON.parse(fs.readFileSync(
      path.join(projectRoot, "publication-pilot.json"),
      "utf8",
    ));
    expect(PublicationPilotPreregistrationSchema.parse(value).cohort).toMatchObject({
      minimumArtifacts: 6,
      minimumNewArtifacts: 2,
      minimumMaterialRevisions: 4,
    });
  });

  it("justifies a general editor only after every preregistered gate passes", () => {
    const fixture = writeFixture();
    const report = evaluateFixture(fixture);

    expect(report.recommendation).toBe("justify-general-editor");
    expect(report.proposalOutcomes).toMatchObject({
      proposals: 2,
      accepted: 2,
      usefulEditYield: 1,
    });
    expect(report.review.medianTimeSavedFraction).toBe(0.8);
    expect(report.readers).toMatchObject({
      reviewedPreferred: 2,
      rawPreferred: 0,
      meanCognitiveLoadDelta: -3,
    });
    expect(report.deterministicCatches).toBe(2);
    expect(report.artifacts[0]?.finalManualEdits.addedCharacters).toBeGreaterThan(0);
    expect(renderPublicationPilotReport(report)).toContain(
      "Recommendation: **justify-general-editor**.",
    );
  });

  it("gathers more evidence when the preregistered cohort is incomplete", () => {
    const fixture = writeFixture({ incomplete: true });
    const report = evaluateFixture(fixture);

    expect(report.recommendation).toBe("gather-more-evidence");
    expect(report.gates.cohortSize).toBe(false);
    expect(report.gates.artifactMix).toBe(false);
  });

  it("does not justify release when a complete cohort has a factual regression", () => {
    const fixture = writeFixture({ qualityFailure: true });
    const report = evaluateFixture(fixture);

    expect(report.recommendation).toBe("do-not-justify");
    expect(report.gates.factualPreservation).toBe(false);
    expect(report.artifacts[1]?.failures).toContain("factual-regression");
  });

  it("rejects publication evidence that does not match the final bytes", () => {
    const fixture = writeFixture();
    const evidence = JSON.parse(fs.readFileSync(fixture.evidenceFile, "utf8"));
    evidence.artifacts[0].publication.contentHash = `sha256:${"0".repeat(64)}`;
    writeJson(fixture.evidenceFile, evidence);

    expect(() => evaluateFixture(fixture)).toThrow(
      "published content hash does not match its evidence",
    );
  });

  it("rejects a review receipt whose hashes do not match the session", () => {
    const fixture = writeFixture();
    const receiptFile = path.join(fixture.root, "pilot-adr/receipt.json");
    const receipt = JSON.parse(fs.readFileSync(receiptFile, "utf8"));
    receipt.recordsHash = `sha256:${"0".repeat(64)}`;
    writeJson(receiptFile, receipt);

    expect(() => evaluateFixture(fixture)).toThrow(
      "review receipt does not match its session evidence",
    );
  });

  it("rejects a session with an unadjudicated proposal", () => {
    const fixture = writeFixture();
    fs.writeFileSync(path.join(fixture.root, "pilot-adr/decisions.jsonl"), "");

    expect(() => evaluateFixture(fixture)).toThrow("has unadjudicated proposals");
  });

  it("rejects a reader comparison whose variant hash is not from the session", () => {
    const fixture = writeFixture();
    const evidence = JSON.parse(fs.readFileSync(fixture.evidenceFile, "utf8"));
    evidence.readerComparisons[0].variantAContentHash = `sha256:${"0".repeat(64)}`;
    writeJson(fixture.evidenceFile, evidence);

    expect(() => evaluateFixture(fixture)).toThrow(
      "variants do not match the reviewed session",
    );
  });

  it("rejects proposal review that began before the declared session", () => {
    const fixture = writeFixture();
    const evidence = JSON.parse(fs.readFileSync(fixture.evidenceFile, "utf8"));
    evidence.artifacts[0].sessionStartedAt = "2026-10-26T10:00:00.500Z";
    writeJson(fixture.evidenceFile, evidence);

    expect(() => evaluateFixture(fixture)).toThrow(
      "proposal review began before the session start",
    );
  });

  it("rejects published bytes that do not match the recorded Git revision", () => {
    const fixture = writeFixture();
    const evidence = JSON.parse(fs.readFileSync(fixture.evidenceFile, "utf8"));
    evidence.artifacts[0].publication.repositoryPath =
      evidence.artifacts[1].publication.repositoryPath;
    writeJson(fixture.evidenceFile, evidence);

    expect(() => evaluateFixture(fixture)).toThrow(
      "published bytes do not match its Git revision",
    );
  });

  it("writes CLI reports only below the working directory output root", () => {
    const fixture = writeFixture();
    const args = publicationPilotArgs(fixture);
    runPublicationPilotCli(args, fixture.root);
    expect(fs.existsSync(path.join(
      fixture.root,
      "outputs/publication-pilot/report.json",
    ))).toBe(true);
    expect(fs.readFileSync(path.join(
      fixture.root,
      "outputs/publication-pilot/report.md",
    ), "utf8")).toContain("# Repository publication pilot");

    const unsafeArgs = [...args];
    unsafeArgs[unsafeArgs.indexOf("--output") + 1] = "../outside.json";
    expect(() => runPublicationPilotCli(unsafeArgs, fixture.root)).toThrow(
      "JSON report must be a file below",
    );
  });

  it("rejects CLI input paths that escape the working directory", () => {
    const fixture = writeFixture();
    const args = publicationPilotArgs(fixture);
    const preregistrationIndex = args.indexOf("--preregistration") + 1;

    const traversalArgs = [...args];
    traversalArgs[preregistrationIndex] = "../outside.json";
    expect(() => runPublicationPilotCli(traversalArgs, fixture.root)).toThrow(
      "publication pilot preregistration must resolve to a file within",
    );

    const absoluteArgs = [...args];
    absoluteArgs[preregistrationIndex] = path.resolve(fixture.root, "../outside.json");
    expect(() => runPublicationPilotCli(absoluteArgs, fixture.root)).toThrow(
      "publication pilot preregistration must resolve to a file within",
    );

    const outside = temporaryDirectory();
    const outsideFile = path.join(outside, "preregistration.json");
    writeJson(outsideFile, preregistration());
    const linkedFile = path.join(fixture.root, "linked-preregistration.json");
    fs.symlinkSync(outsideFile, linkedFile);
    const symlinkArgs = [...args];
    symlinkArgs[preregistrationIndex] = linkedFile;
    expect(() => runPublicationPilotCli(symlinkArgs, fixture.root)).toThrow(
      "publication pilot preregistration must resolve to a file within",
    );

    const evidenceArgs = [...args];
    evidenceArgs[evidenceArgs.indexOf("--evidence") + 1] = "../outside.json";
    expect(() => runPublicationPilotCli(evidenceArgs, fixture.root)).toThrow(
      "publication pilot evidence must resolve to a file within",
    );

    const evidenceRootArgs = [...args];
    evidenceRootArgs[evidenceRootArgs.indexOf("--evidence-root") + 1] = "../outside";
    expect(() => runPublicationPilotCli(evidenceRootArgs, fixture.root)).toThrow(
      "publication pilot evidence root must resolve to a directory within",
    );

    const nonDirectoryRootArgs = [...args];
    nonDirectoryRootArgs[nonDirectoryRootArgs.indexOf("--evidence-root") + 1] =
      fixture.evidenceFile;
    expect(() => runPublicationPilotCli(nonDirectoryRootArgs, fixture.root)).toThrow(
      "publication pilot evidence root must resolve to a directory",
    );
  });
});
