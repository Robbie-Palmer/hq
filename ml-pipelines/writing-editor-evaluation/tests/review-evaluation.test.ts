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

import { evaluateReviews, ReviewScorecardSchema } from "../src/evaluate-reviews";
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
  const revision = "fixture:v1";
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
      artifactId: "fixture-adr",
      artifactType: "adr",
      split: "validation",
      recordsFile: "records.json",
      decisionsFile: "decisions.jsonl",
      receiptFile: "receipt.json",
      sourceBeforeFile: "source-before.md",
      sourceAfterFile: "source-after.md",
      provenance: {
        scope: "seed",
        sourceDatasetId: "fixture-dataset",
        sourceRevision: revision,
        producerRunId: "fixture-run",
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
  it("keeps a one-proposal cohort opt-in until the volume gate is met", () => {
    const scorecard = evaluateReviews({
      manifestFile: path.join(evidenceRoot, "manifest.json"),
      evidenceRoot,
      paramsFile: path.join(projectRoot, "evaluation-params.json"),
    });

    expect(ReviewScorecardSchema.parse(scorecard)).toEqual(scorecard);
    expect(scorecard.detectionCoverage).toEqual({ artifacts: 1, findings: 1 });
    expect(scorecard.proposalOutcomes).toEqual({
      proposals: 1,
      accepted: 1,
      changed: 0,
      rejected: 0,
      usefulYield: 1,
    });
    expect(scorecard.gates).toMatchObject({
      actionableVolume: false,
      usefulYield: true,
      regressionRate: true,
      qualityAssessed: true,
    });
    expect(scorecard.recommendation).toBe("keep-opt-in");
  });

  it("can recommend adoption only when every configured gate passes", () => {
    const temporary = temporaryDirectory();
    const paramsFile = path.join(temporary, "params.json");
    fs.writeFileSync(paramsFile, JSON.stringify({
      minimumActionableProposals: 1,
      minimumUsefulYield: 1,
      maximumRegressionRate: 0,
      maximumMedianReviewSeconds: 120,
      requireAssessedQuality: true,
    }));

    const scorecard = evaluateReviews({
      manifestFile: path.join(evidenceRoot, "manifest.json"),
      evidenceRoot,
      paramsFile,
    });

    expect(Object.values(scorecard.gates).every(Boolean)).toBe(true);
    expect(scorecard.recommendation).toBe("adopt-default");
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

    expect(scorecard.gates.deletionClear).toBe(false);
    expect(scorecard.recommendation).toBe("keep-opt-in");
  });

  it("finalizes frozen readiness only from validated seed evidence", () => {
    const manifestFile = path.join(evidenceRoot, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
    manifest.entries[0].artifactId = "seed-fixture-adr";
    fs.writeFileSync(manifestFile, JSON.stringify(manifest));
    const cohortId = `cohort:v1:${"a".repeat(64)}`;
    const cohortFile = path.join(evidenceRoot, "cohort.json");
    fs.writeFileSync(cohortFile, JSON.stringify({
      schemaVersion: 1,
      recordType: "writing-editor-frozen-cohort",
      cohortId,
      datasetId: `dataset:v1:${"b".repeat(64)}`,
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
          revision: "1".repeat(40), committedAt: "2026-01-01T00:00:00.000Z",
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
