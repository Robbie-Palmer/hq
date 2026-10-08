import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDecision } from "writing-editor-domain/decisions";
import { createFinding } from "writing-editor-domain/findings";
import { createProposal } from "writing-editor-domain/proposals";
import {
  createReviewReceipt,
  type ReviewReceipt,
  ReviewReceiptSchema,
} from "writing-editor-domain/review-receipt";
import { createSuggestion, sourceReference } from "writing-editor-domain/suggestions";

import { evaluateReviews, ReviewScorecardSchema } from "../src/evaluate-reviews";

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

  it.each([
    ["source identity", (receipt: ReviewReceipt) => {
      receipt.documentId = "other.md";
    }, /receipt does not match its source/],
    ["source hash", (receipt: ReviewReceipt) => {
      receipt.sourceBeforeHash = `sha256:${"0".repeat(64)}`;
    }, /receipt does not match its source/],
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
