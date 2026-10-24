import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { canonicalJson } from "writing-editor-domain/canonical-json";
import { createDecision } from "writing-editor-domain/decisions";
import { createFinding } from "writing-editor-domain/findings";
import { createProposal } from "writing-editor-domain/proposals";
import {
  createReviewReceipt,
  type ReviewReceipt,
  ReviewReceiptSchema,
} from "writing-editor-domain/review-receipt";
import { createSuggestion, sha256, sourceReference } from "writing-editor-domain/suggestions";

import {
  evaluateReviews,
  ReviewEvidenceManifestSchema,
  ReviewScorecardSchema,
} from "../src/evaluate-reviews";
import { finalizeCohortReadiness } from "../src/finalize-cohort-readiness";

const projectRoot = path.resolve(import.meta.dirname, "..");
const temporaryDirectories = new Set<string>();
let evidenceRoot: string;

beforeEach(() => {
  evidenceRoot = writeReviewEvidenceFixture();
});

afterEach(() => {
  for (const directory of temporaryDirectories) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  temporaryDirectories.clear();
});

function temporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "writing-review-evaluation-"));
  temporaryDirectories.add(directory);
  return directory;
}

function writeReviewEvidenceFixture(): string {
  const directory = temporaryDirectory();
  const documentId = "fixture.md";
  const revision = "1".repeat(40);
  const datasetId = `dataset:v1:${"2".repeat(64)}`;
  const producerRunId = `producer-run:v1:${"3".repeat(64)}`;
  const sourceBefore = "Utilize this. Optimize that.";
  const sourceAfter = "Use this. Optimize that.";
  const source = sourceReference(documentId, revision, sourceBefore);
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
    producer: {
      ...producer,
      provenance: { kind: "rule", ruleId: "Unslop.PlainWords" },
    },
    source,
    span: { startByte: 14, endByte: 22, sourceText: "Optimize" },
    category: "style/unslop/plain-words",
    reason: "Choose a context-sensitive alternative",
  });
  const records = { documentId, revision, findings: [finding], proposals: [proposal] };
  const decision = createDecision(proposal, "accepted", {
    reviewStartedAt: "2026-01-01T00:00:00.000Z",
    decidedAt: "2026-01-01T00:00:00.002Z",
  });
  const receipt = createReviewReceipt(records, [decision], sourceBefore, sourceAfter);
  const manifest = {
    schemaVersion: 1,
    recordType: "writing-review-evidence-manifest",
    cohortId: "fixture:review-evidence",
    governance: {
      dataClassification: "public",
      consentBasis: "Synthetic test fixture",
      consentRecordedAt: "2026-01-01T00:00:00.000Z",
      retentionPolicy: "Retain with the test suite",
      deletionStatus: "active",
    },
    entries: [{
      artifactId: "seed-fixture-adr",
      artifactType: "adr",
      split: "validation",
      recordsFile: "records.json",
      decisionsFile: "decisions.jsonl",
      receiptFile: "receipt.json",
      sourceBeforeFile: "source-before.md",
      sourceAfterFile: "source-after.md",
      provenance: {
        scope: "seed",
        sourceDatasetId: datasetId,
        sourceRevision: revision,
        producerRunId,
        reviewMethod: "fixture review",
        reviewTiming: "measured",
      },
      governance: {
        dataClassification: "public",
        consentBasis: "Synthetic test fixture",
        consentRecordedAt: "2026-01-01T00:00:00.000Z",
        retentionPolicy: "Retain with the test suite",
        deletionStatus: "active",
      },
      quality: {
        factualPreservation: "pass",
        terminologyPreservation: "pass",
        voicePreservation: "pass",
        regression: "none",
      },
    }],
  };

  fs.writeFileSync(path.join(directory, "manifest.json"), JSON.stringify(manifest));
  fs.writeFileSync(path.join(directory, "records.json"), JSON.stringify(records));
  fs.writeFileSync(path.join(directory, "decisions.jsonl"), `${JSON.stringify(decision)}\n`);
  fs.writeFileSync(path.join(directory, "receipt.json"), JSON.stringify(receipt));
  fs.writeFileSync(path.join(directory, "source-before.md"), sourceBefore);
  fs.writeFileSync(path.join(directory, "source-after.md"), sourceAfter);
  return directory;
}

function writePipelineEvidenceFixture(directory: string) {
  const records = JSON.parse(fs.readFileSync(path.join(directory, "records.json"), "utf8"));
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, "manifest.json"), "utf8"));
  const sourceBefore = fs.readFileSync(path.join(directory, "source-before.md"), "utf8");
  const sourceAfter = fs.readFileSync(path.join(directory, "source-after.md"), "utf8");
  const entry = manifest.entries[0];
  const proposal = records.proposals[0];
  const finding = records.findings[0];
  const cohortId = `cohort:v1:${"4".repeat(64)}`;
  const publishedRevision = "5".repeat(40);
  const cohortFile = path.join(directory, "cohort.json");
  fs.writeFileSync(cohortFile, JSON.stringify({
    schemaVersion: 1,
    recordType: "writing-editor-frozen-cohort",
    cohortId,
    datasetId: entry.provenance.sourceDatasetId,
    frozenAt: "2026-01-01T00:00:00.000Z",
    seed: "fixture",
    splitRatios: { train: 0.6, validation: 0.2, holdout: 0.2 },
    entries: [{
      artifactId: "fixture-adr",
      artifactType: "adr",
      path: records.documentId,
      outcomeStatus: "unrecorded",
      split: "validation",
      source: {
        revision: records.revision,
        committedAt: "2026-01-01T00:00:00.000Z",
        contentHash: sha256(sourceBefore),
        bytes: Buffer.byteLength(sourceBefore),
        file: "fixture-adr/source.md",
      },
      published: {
        revision: publishedRevision,
        committedAt: "2026-01-02T00:00:00.000Z",
        contentHash: sha256(sourceAfter),
        bytes: Buffer.byteLength(sourceAfter),
        file: "fixture-adr/published.md",
      },
    }],
  }));

  const producerRunFile = path.join(directory, "gector-run.json");
  fs.writeFileSync(producerRunFile, JSON.stringify({
    schemaVersion: 1,
    recordType: "writing-editor-gector-producer-run",
    runId: entry.provenance.producerRunId,
    cohortId,
    producer: proposal.suggestions[0].producer,
    model: {
      checkpointContentHash: `sha256:${"6".repeat(64)}`,
      manifestContentHash: `sha256:${"7".repeat(64)}`,
    },
    runtime: {
      pythonVersion: "3.14.7",
      torchVersion: "2.13.0+cu126",
      transformersVersion: "5.17.0",
      cudaVersion: "12.6",
      device: "cuda",
      computeCapability: "8.9",
      lockContentHash: `sha256:${"8".repeat(64)}`,
      adapterRevision: 1,
    },
    parameters: {
      batchSize: 1,
      iterations: 1,
      maxTokens: 50,
      minTokens: 1,
      minErrorProbability: 0.9,
      minTokenProbability: 0,
      additionalConfidence: 0.1,
    },
    artifacts: [{
      artifactId: "fixture-adr",
      artifactType: "adr",
      split: "validation",
      source: proposal.suggestions[0].source,
      generated: {
        file: "fixture-adr/generated.md",
        contentHash: sha256(sourceAfter),
        correctedLines: [1],
        iterationUpdates: 1,
      },
      suggestionIds: proposal.suggestionIds,
      suggestions: proposal.suggestions,
      proposalIds: [proposal.proposalId],
      proposals: [proposal],
    }],
    summary: { artifacts: 1, artifactsWithSuggestions: 1, suggestions: 1, proposals: 1 },
  }));

  const valeRunId = `producer-run:v1:${"9".repeat(64)}`;
  const valeRunFile = path.join(directory, "vale-run.json");
  fs.writeFileSync(valeRunFile, JSON.stringify({
    schemaVersion: 1,
    recordType: "writing-editor-vale-producer-run",
    runId: valeRunId,
    cohortId,
    producer: finding.producer,
    vale: { binaryVersion: "3.24.0", ruleSetHash: `sha256:${"a".repeat(64)}` },
    artifacts: [{
      artifactId: "fixture-adr",
      artifactType: "adr",
      split: "validation",
      source: finding.source,
      findingIds: [finding.findingId],
      findings: [{
        severity: "warning",
        valeMatch: finding.span.sourceText,
        location: { line: 1, startColumn: 15, endColumn: 22 },
        finding,
      }],
    }],
    summary: {
      artifacts: 1,
      artifactsWithFindings: 1,
      findings: 1,
      bySeverity: { error: 0, warning: 1, suggestion: 0 },
      byCheck: [{ check: finding.producer.provenance.ruleId, count: 1 }],
    },
  }));

  const editMatchRunFile = path.join(directory, "edit-matches.json");
  fs.writeFileSync(editMatchRunFile, JSON.stringify({
    schemaVersion: 1,
    recordType: "writing-editor-edit-match-run",
    runId: `edit-match-run:v1:${"b".repeat(64)}`,
    cohortId,
    producerRunId: valeRunId,
    algorithm: {
      id: "jsdiff-character-overlap",
      version: "jsdiff@9.0.0+matcher.1",
      maxEditLength: 1000,
    },
    artifacts: [{
      artifactId: "fixture-adr",
      artifactType: "adr",
      split: "validation",
      source: finding.source,
      published: {
        documentId: records.documentId,
        revision: publishedRevision,
        contentHash: sha256(sourceAfter),
      },
      hunkIds: [],
      hunks: [],
      findingIds: [finding.findingId],
      matches: [{
        findingId: finding.findingId,
        status: "unchanged",
        hunkIds: [],
        publishedSpan: {
          startByte: finding.span.startByte,
          endByte: finding.span.endByte,
          text: finding.span.sourceText,
        },
        reason: null,
      }],
    }],
    summary: {
      artifacts: 1,
      findings: 1,
      editHunks: 0,
      byStatus: { changed: 0, unchanged: 1, "manual-adjudication-required": 0 },
    },
  }));

  return { cohortFile, valeRunFile, editMatchRunFile, producerRunFile };
}

function tamperReceipt(
  temporary: string,
  mutate: (receipt: ReviewReceipt) => void,
): void {
  const receiptPath = path.join(temporary, "receipt.json");
  const receipt = ReviewReceiptSchema.parse(JSON.parse(fs.readFileSync(receiptPath, "utf8")));
  mutate(receipt);
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
}

describe("review evidence scorecard", () => {
  it("requires source snapshots for current evidence while accepting legacy entries", () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(evidenceRoot, "manifest.json"), "utf8"),
    );
    delete manifest.entries[0].sourceBeforeFile;
    delete manifest.entries[0].sourceAfterFile;

    const currentResult = ReviewEvidenceManifestSchema.safeParse(manifest);
    expect(currentResult.success).toBe(false);
    if (currentResult.success) throw new Error("expected current evidence without snapshots to fail");
    expect(currentResult.error.issues[0]?.message)
      .toBe("current evidence entries must include source snapshots");

    delete manifest.entries[0].provenance;
    expect(ReviewEvidenceManifestSchema.parse(manifest).entries).toHaveLength(1);
  });

  it("asks for more evidence until the sample-size gates are met", () => {
    const scorecard = evaluateReviews({
      manifestFile: path.join(evidenceRoot, "manifest.json"),
      evidenceRoot,
      paramsFile: path.join(projectRoot, "evaluation-params.json"),
    });

    expect(ReviewScorecardSchema.parse(scorecard)).toEqual(scorecard);
    expect(scorecard.detectionCoverage).toEqual({
      artifacts: 1,
      findings: 1,
      observedEdits: null,
    });
    expect(scorecard.proposalOutcomes).toEqual({
      proposals: 1,
      accepted: 1,
      changed: 0,
      rejected: 0,
      usefulYield: 1,
    });
    expect(scorecard.gates).toMatchObject({
      sampleSize: {
        artifacts: false,
        actionableVolume: false,
        artifactTypes: false,
      },
      adoption: {
        usefulYield: true,
        regressionRate: true,
        qualityAssessed: true,
      },
    });
    expect(scorecard.artifacts[0]).toMatchObject({
      usefulEditYield: 1,
      quality: {
        factualPreservation: "pass",
        terminologyPreservation: "pass",
        voicePreservation: "pass",
        regression: "none",
      },
      proposalEvidence: [{ outcome: "accepted" }],
    });
    expect(scorecard.recommendation).toBe("gather-more-evidence");
  });

  it("binds scorecard rows to cohort, producer, and observed-edit evidence", () => {
    const pipeline = writePipelineEvidenceFixture(evidenceRoot);
    const scorecard = evaluateReviews({
      manifestFile: path.join(evidenceRoot, "manifest.json"),
      evidenceRoot,
      paramsFile: path.join(projectRoot, "evaluation-params.json"),
      pipelineEvidence: {
        cohortFile: pipeline.cohortFile,
        valeRunFile: pipeline.valeRunFile,
        editMatchRunFile: pipeline.editMatchRunFile,
        rewriteProducerRunFiles: [pipeline.producerRunFile],
      },
    });

    expect(scorecard.pipelineInputs).toMatchObject({
      valeProducerRunId: `producer-run:v1:${"9".repeat(64)}`,
      editMatchRunId: `edit-match-run:v1:${"b".repeat(64)}`,
    });
    expect(scorecard.detectionCoverage).toEqual({
      artifacts: 1,
      findings: 1,
      observedEdits: { changed: 0, unchanged: 1, manualAdjudicationRequired: 0 },
    });
    expect(scorecard.artifacts[0]).toMatchObject({
      artifactId: "seed-fixture-adr",
      findings: 1,
      findingEvidence: expect.arrayContaining([expect.objectContaining({
        observedEdit: { status: "unchanged", hunkIds: [] },
      })]),
      proposalEvidence: [expect.objectContaining({ outcome: "accepted" })],
    });
  });

  it("can recommend adoption only when every configured gate passes", () => {
    const temporary = temporaryDirectory();
    const paramsFile = path.join(temporary, "params.json");
    fs.writeFileSync(paramsFile, JSON.stringify({
      sampleSize: {
        minimumArtifacts: 1,
        minimumActionableProposals: 1,
        requiredArtifactTypes: ["adr"],
      },
      thresholds: {
        adopt: {
          minimumUsefulYield: 1,
          maximumRegressionRate: 0,
          maximumMedianReviewSeconds: 120,
        },
        reject: {
          maximumUsefulYield: 0.5,
          minimumRegressionRate: 0.1,
          minimumMedianReviewSeconds: 300,
        },
      },
      requireAssessedQuality: true,
      decisionLogic: {
        adopt: "sample-size-met-and-all-adoption-gates-pass",
        reject: "sample-size-met-and-any-rejection-gate-fails",
        gatherMoreEvidence: "otherwise",
      },
    }));

    const scorecard = evaluateReviews({
      manifestFile: path.join(evidenceRoot, "manifest.json"),
      evidenceRoot,
      paramsFile,
    });

    expect(Object.values(scorecard.gates.sampleSize).every(Boolean)).toBe(true);
    expect(Object.values(scorecard.gates.adoption).every(Boolean)).toBe(true);
    expect(Object.values(scorecard.gates.rejection).every((value) => !value)).toBe(true);
    expect(scorecard.recommendation).toBe("adopt");
  });

  it("rejects a representative sample when a rejection threshold fails", () => {
    const temporary = temporaryDirectory();
    const paramsFile = path.join(temporary, "params.json");
    fs.writeFileSync(paramsFile, JSON.stringify({
      sampleSize: {
        minimumArtifacts: 1,
        minimumActionableProposals: 1,
        requiredArtifactTypes: ["adr"],
      },
      thresholds: {
        adopt: {
          minimumUsefulYield: 0.5,
          maximumRegressionRate: 0,
          maximumMedianReviewSeconds: 0.001,
        },
        reject: {
          maximumUsefulYield: 0.25,
          minimumRegressionRate: 0.1,
          minimumMedianReviewSeconds: 0.002,
        },
      },
      requireAssessedQuality: true,
      decisionLogic: {
        adopt: "sample-size-met-and-all-adoption-gates-pass",
        reject: "sample-size-met-and-any-rejection-gate-fails",
        gatherMoreEvidence: "otherwise",
      },
    }));

    const scorecard = evaluateReviews({
      manifestFile: path.join(evidenceRoot, "manifest.json"),
      evidenceRoot,
      paramsFile,
    });

    expect(scorecard.gates.rejection.reviewTime).toBe(true);
    expect(scorecard.recommendation).toBe("reject");
  });

  it("rejects evidence when the receipt no longer binds the decision log", () => {
    const temporary = temporaryDirectory();
    fs.cpSync(evidenceRoot, temporary, { recursive: true });
    fs.appendFileSync(path.join(temporary, "decisions.jsonl"), "\n");
    const decision = JSON.parse(
      fs.readFileSync(path.join(temporary, "decisions.jsonl"), "utf8").trim(),
    );
    decision.outcome = "rejected";
    fs.writeFileSync(path.join(temporary, "decisions.jsonl"), `${JSON.stringify(decision)}\n`);

    expect(() => evaluateReviews({
      manifestFile: path.join(temporary, "manifest.json"),
      evidenceRoot: temporary,
      paramsFile: path.join(projectRoot, "evaluation-params.json"),
    })).toThrow(/receipt does not match its decisions/);
  });

  it("rejects evidence when the recorded source bytes are changed", () => {
    fs.writeFileSync(path.join(evidenceRoot, "source-before.md"), "Tampered source");

    expect(() => evaluateReviews({
      manifestFile: path.join(evidenceRoot, "manifest.json"),
      evidenceRoot,
      paramsFile: path.join(projectRoot, "evaluation-params.json"),
    })).toThrow(/review records do not match the source/);
  });

  it("blocks adoption while any entry has a pending deletion request", () => {
    const manifestFile = path.join(evidenceRoot, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
    manifest.entries[0].governance.deletionStatus = "deletion-requested";
    manifest.entries[0].governance.deletionRequestedAt = "2026-01-02T00:00:00.000Z";
    fs.writeFileSync(manifestFile, JSON.stringify(manifest));

    const scorecard = evaluateReviews({
      manifestFile,
      evidenceRoot,
      paramsFile: path.join(projectRoot, "evaluation-params.json"),
    });

    expect(scorecard.gates.adoption.deletionClear).toBe(false);
    expect(scorecard.recommendation).toBe("gather-more-evidence");
  });

  it("finalizes frozen readiness only from validated seed evidence", () => {
    const datasetId = `dataset:v1:${"b".repeat(64)}`;
    const sourceRevision = "1".repeat(40);
    const manifestFile = path.join(evidenceRoot, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
    manifest.entries[0].artifactId = "seed-fixture-adr";
    manifest.entries[0].provenance.sourceDatasetId = datasetId;
    manifest.entries[0].provenance.sourceRevision = sourceRevision;
    fs.writeFileSync(manifestFile, JSON.stringify(manifest));
    const cohortId = `cohort:v1:${"a".repeat(64)}`;
    const cohortFile = path.join(evidenceRoot, "cohort.json");
    fs.writeFileSync(cohortFile, JSON.stringify({
      schemaVersion: 1,
      recordType: "writing-editor-frozen-cohort",
      cohortId,
      datasetId,
      frozenAt: "2026-01-01T00:00:00.000Z",
      seed: "fixture",
      splitRatios: { train: 0.6, validation: 0.2, holdout: 0.2 },
      entries: [{
        artifactId: "fixture-adr",
        artifactType: "adr",
        path: "fixture.md",
        outcomeStatus: "unrecorded",
        split: "validation",
        source: {
          revision: sourceRevision, committedAt: "2026-01-01T00:00:00.000Z",
          contentHash: `sha256:${"1".repeat(64)}`, bytes: 1, file: "source.md",
        },
        published: {
          revision: "2".repeat(40), committedAt: "2026-01-02T00:00:00.000Z",
          contentHash: `sha256:${"2".repeat(64)}`, bytes: 2, file: "published.md",
        },
      }],
    }));
    const paramsFile = path.join(evidenceRoot, "pipeline-params.json");
    fs.writeFileSync(paramsFile, JSON.stringify({
      cohort: {
        frozenAt: "2026-01-01T00:00:00.000Z", seed: "fixture",
        split: { train: 0.6, validation: 0.2, holdout: 0.2 },
        requiredArtifactTypes: ["adr"],
      },
      producers: {
        gector: {
          batchSize: 1, iterations: 1, maxTokens: 50, minTokens: 1,
          minErrorProbability: 0.9, minTokenProbability: 0, additionalConfidence: 0.3,
        },
        vale: { timeoutMs: 1_000 },
      },
      matching: { characterDiff: { maxEditLength: 1_000 } },
    }));
    const outcomesFile = path.join(evidenceRoot, "seed-outcomes.json");
    fs.writeFileSync(outcomesFile, JSON.stringify({
      schemaVersion: 1,
      recordType: "writing-editor-seed-outcomes",
      cohortId,
      artifactIds: ["seed-fixture-adr"],
      evidenceManifestHash: sha256(canonicalJson(manifest)),
    }));
    const outputJson = path.join(evidenceRoot, "readiness.json");
    const outputMarkdown = path.join(evidenceRoot, "readiness.md");

    finalizeCohortReadiness({
      cohortFile,
      paramsFile,
      evidenceManifestFile: manifestFile,
      evidenceRoot,
      seedOutcomesFile: outcomesFile,
      evaluationParamsFile: path.join(projectRoot, "evaluation-params.json"),
      outputJson,
      outputMarkdown,
    });

    expect(JSON.parse(fs.readFileSync(outputJson, "utf8"))).toMatchObject({
      ready: true,
      outcomes: { complete: true, recorded: 1 },
    });
    expect(fs.readFileSync(outputMarkdown, "utf8")).toContain("Status: ready");

    const nonSeedManifest = structuredClone(manifest);
    nonSeedManifest.entries[0].provenance.scope = "customer";
    fs.writeFileSync(manifestFile, JSON.stringify(nonSeedManifest));
    fs.writeFileSync(outcomesFile, JSON.stringify({
      schemaVersion: 1,
      recordType: "writing-editor-seed-outcomes",
      cohortId,
      artifactIds: ["seed-fixture-adr"],
      evidenceManifestHash: sha256(canonicalJson(nonSeedManifest)),
    }));
    expect(() => finalizeCohortReadiness({
      cohortFile,
      paramsFile,
      evidenceManifestFile: manifestFile,
      evidenceRoot,
      seedOutcomesFile: outcomesFile,
      evaluationParamsFile: path.join(projectRoot, "evaluation-params.json"),
      outputJson,
      outputMarkdown,
    })).toThrow("seed outcomes refer to missing or non-seed evidence entries");

    const wrongSourceManifest = structuredClone(manifest);
    wrongSourceManifest.entries[0].provenance.sourceRevision = "3".repeat(40);
    fs.writeFileSync(manifestFile, JSON.stringify(wrongSourceManifest));
    fs.writeFileSync(outcomesFile, JSON.stringify({
      schemaVersion: 1,
      recordType: "writing-editor-seed-outcomes",
      cohortId,
      artifactIds: ["seed-fixture-adr"],
      evidenceManifestHash: sha256(canonicalJson(wrongSourceManifest)),
    }));
    expect(() => finalizeCohortReadiness({
      cohortFile,
      paramsFile,
      evidenceManifestFile: manifestFile,
      evidenceRoot,
      seedOutcomesFile: outcomesFile,
      evaluationParamsFile: path.join(projectRoot, "evaluation-params.json"),
      outputJson,
      outputMarkdown,
    })).toThrow("seed outcomes do not match the frozen cohort source");

    const wrongDatasetManifest = structuredClone(manifest);
    wrongDatasetManifest.entries[0].provenance.sourceDatasetId = `dataset:v1:${"c".repeat(64)}`;
    fs.writeFileSync(manifestFile, JSON.stringify(wrongDatasetManifest));
    fs.writeFileSync(outcomesFile, JSON.stringify({
      schemaVersion: 1,
      recordType: "writing-editor-seed-outcomes",
      cohortId,
      artifactIds: ["seed-fixture-adr"],
      evidenceManifestHash: sha256(canonicalJson(wrongDatasetManifest)),
    }));
    expect(() => finalizeCohortReadiness({
      cohortFile,
      paramsFile,
      evidenceManifestFile: manifestFile,
      evidenceRoot,
      seedOutcomesFile: outcomesFile,
      evaluationParamsFile: path.join(projectRoot, "evaluation-params.json"),
      outputJson,
      outputMarkdown,
    })).toThrow("seed outcomes do not match the frozen cohort source");
  });

  it.each([
    ["source identity", (receipt: ReviewReceipt) => {
      receipt.documentId = "other.md";
    }, /receipt does not match its source/],
    ["source hash", (receipt: ReviewReceipt) => {
      receipt.sourceBeforeHash = `sha256:${"0".repeat(64)}`;
    }, /receipt does not match source-before bytes/],
    ["review time", (receipt: ReviewReceipt) => {
      receipt.summary.reviewMilliseconds += 1;
    }, /receipt review time does not match/],
    ["source-change flag", (receipt: ReviewReceipt) => {
      receipt.sourceChanged = false;
    }, /source-change flag does not match/],
  ] as const)("rejects a receipt with tampered %s", (_label, mutate, expected) => {
    const temporary = temporaryDirectory();
    fs.cpSync(evidenceRoot, temporary, { recursive: true });
    tamperReceipt(temporary, mutate);

    expect(() => evaluateReviews({
      manifestFile: path.join(temporary, "manifest.json"),
      evidenceRoot: temporary,
      paramsFile: path.join(projectRoot, "evaluation-params.json"),
    })).toThrow(expected);
  });
});
