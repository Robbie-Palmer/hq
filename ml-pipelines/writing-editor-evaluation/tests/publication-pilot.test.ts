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
  const published = "Use this published draft.";
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
  return { root, preregistrationFile, evidenceFile };
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
    const report = evaluatePublicationPilot({
      preregistrationFile: fixture.preregistrationFile,
      evidenceFile: fixture.evidenceFile,
      evidenceRoot: fixture.root,
    });

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
    const report = evaluatePublicationPilot({
      preregistrationFile: fixture.preregistrationFile,
      evidenceFile: fixture.evidenceFile,
      evidenceRoot: fixture.root,
    });

    expect(report.recommendation).toBe("gather-more-evidence");
    expect(report.gates.cohortSize).toBe(false);
    expect(report.gates.artifactMix).toBe(false);
  });

  it("does not justify release when a complete cohort has a factual regression", () => {
    const fixture = writeFixture({ qualityFailure: true });
    const report = evaluatePublicationPilot({
      preregistrationFile: fixture.preregistrationFile,
      evidenceFile: fixture.evidenceFile,
      evidenceRoot: fixture.root,
    });

    expect(report.recommendation).toBe("do-not-justify");
    expect(report.gates.factualPreservation).toBe(false);
    expect(report.artifacts[1]?.failures).toContain("factual-regression");
  });

  it("rejects publication evidence that does not match the final bytes", () => {
    const fixture = writeFixture();
    const evidence = JSON.parse(fs.readFileSync(fixture.evidenceFile, "utf8"));
    evidence.artifacts[0].publication.contentHash = `sha256:${"0".repeat(64)}`;
    writeJson(fixture.evidenceFile, evidence);

    expect(() => evaluatePublicationPilot({
      preregistrationFile: fixture.preregistrationFile,
      evidenceFile: fixture.evidenceFile,
      evidenceRoot: fixture.root,
    })).toThrow("published content hash does not match its evidence");
  });
});
