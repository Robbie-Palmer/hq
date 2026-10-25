import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { DecisionSchema } from "writing-editor-domain/decisions";
import { canonicalJson } from "writing-editor-domain/canonical-json";
import { sha256 } from "writing-editor-domain/suggestions";
import { z } from "zod";

import { ReviewEvidenceManifestSchema } from "./evaluate-reviews";
import { readJson, resolveContainedFile, writeJson } from "./files";
import {
  PunctuationCandidateRunSchema,
  PunctuationExperimentSchema,
} from "./run-punctuation-candidate";

const EvaluationSchema = z.object({
  schemaVersion: z.literal(1),
  recordType: z.literal("punctuation-candidate-evaluation"),
  evaluationId: z.string().regex(/^evaluation:v1:[a-f0-9]{64}$/),
  decision: z.enum(["adopt", "reject", "gather-more-evidence"]),
  inputs: z.object({
    cohortId: z.string(),
    candidateRunId: z.string(),
    experimentContentHash: z.string(),
    evidenceManifestHash: z.string(),
  }).strict(),
  sample: z.object({
    eligibleDecisions: z.number().int().positive(),
    accepted: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
    changed: z.number().int().nonnegative(),
    minimumMet: z.boolean(),
  }).strict(),
  candidate: z.object({
    proposals: z.number().int().nonnegative(),
    matchedAccepted: z.number().int().nonnegative(),
    matchedRejected: z.number().int().nonnegative(),
    missedAccepted: z.number().int().nonnegative(),
    unassessedProposals: z.number().int().nonnegative(),
    unassessedProposalsPerArtifact: z.number().nonnegative(),
    usefulYieldOnEligibleDecisions: z.number().min(0).max(1),
    acceptedSiteRecall: z.number().min(0).max(1),
    medianInferenceMillisecondsPerArtifact: z.number().nonnegative(),
    peakCudaAllocatedBytes: z.number().int().positive(),
    targetHardware: z.boolean(),
    withinDeclaredMemoryLimit: z.boolean(),
    withinDeclaredLatencyLimit: z.boolean(),
    qualityPreservationAssessed: z.boolean(),
  }).strict(),
  comparisons: z.object({
    vale: z.object({
      role: z.literal("detection-only"),
      missingCommaRewriteProposals: z.literal(0),
    }).strict(),
    deterministicSuggestions: z.object({
      governedDocuments: z.number().int().nonnegative(),
      rewriteProposalsAfterHardening: z.number().int().nonnegative(),
      missingCommaRewriteProposals: z.literal(0),
    }).strict(),
    gector: z.object({
      eligibleProposals: z.number().int().positive(),
      accepted: z.number().int().nonnegative(),
      rejected: z.number().int().nonnegative(),
      usefulYield: z.number().min(0).max(1),
    }).strict(),
  }).strict(),
  gates: z.object({
    adoption: z.record(z.string(), z.boolean()),
    rejection: z.record(z.string(), z.boolean()),
  }).strict(),
}).strict();

function readJsonLines(file: string): unknown[] {
  const text = fs.readFileSync(file, "utf8").trim();
  return text === "" ? [] : text.split("\n").map((line) => JSON.parse(line));
}

function siteKey(documentId: string, revision: string, byteOffset: number): string {
  return `${documentId}\0${revision}\0${byteOffset}`;
}

type EligibleOutcome = "accepted" | "rejected" | "changed";

function loadEligibleDecisions(
  evidenceRoot: string,
  manifest: z.infer<typeof ReviewEvidenceManifestSchema>,
): Map<string, EligibleOutcome> {
  const eligible = new Map<string, EligibleOutcome>();
  for (const entry of manifest.entries) {
    const decisions = readJsonLines(resolveContainedFile(
      evidenceRoot,
      entry.decisionsFile,
      `${entry.artifactId} decisions`,
    )).map((value) => DecisionSchema.parse(value));
    for (const decision of decisions) {
      const [suggestion] = decision.proposal.suggestions;
      if (
        decision.proposal.suggestions.length === 1 &&
        suggestion?.span.sourceText === "" && suggestion.replacement === ","
      ) {
        eligible.set(
          siteKey(
            suggestion.source.documentId,
            suggestion.source.revision,
            suggestion.span.startByte,
          ),
          decision.outcome,
        );
      }
    }
  }
  return eligible;
}

function tallyEligibleDecisions(
  eligible: Map<string, EligibleOutcome>,
  candidateSites: Set<string>,
): {
  accepted: number;
  rejected: number;
  changed: number;
  matchedAccepted: number;
  matchedRejected: number;
} {
  const result = {
    accepted: 0,
    rejected: 0,
    changed: 0,
    matchedAccepted: 0,
    matchedRejected: 0,
  };
  for (const [key, outcome] of eligible) {
    if (outcome === "accepted") {
      result.accepted += 1;
      if (candidateSites.has(key)) result.matchedAccepted += 1;
    } else if (outcome === "rejected") {
      result.rejected += 1;
      if (candidateSites.has(key)) result.matchedRejected += 1;
    } else {
      result.changed += 1;
    }
  }
  return result;
}

function deterministicCounts(root: string): { documents: number; proposals: number } {
  if (!fs.existsSync(root)) return { documents: 0, proposals: 0 };
  const recordFiles = fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(root, entry.name, "records.json");
    return entry.isDirectory() && fs.existsSync(file) ? [file] : [];
  });
  return {
    documents: recordFiles.length,
    proposals: recordFiles.reduce((sum, file) => {
      const records = z.object({ proposals: z.array(z.unknown()) }).parse(readJson(file));
      return sum + records.proposals.length;
    }, 0),
  };
}

function candidateDecision(
  adoptionGates: Record<string, boolean>,
  rejectionGates: Record<string, boolean>,
): "adopt" | "reject" | "gather-more-evidence" {
  if (Object.values(adoptionGates).every(Boolean)) return "adopt";
  if (Object.values(rejectionGates).some(Boolean)) return "reject";
  return "gather-more-evidence";
}

function nextEvidence(decision: "adopt" | "reject" | "gather-more-evidence", unassessed: number) {
  if (decision === "gather-more-evidence") {
    return `Review the ${unassessed} unmatched proposals before reconsidering adoption. Keep the model out of the default editor.`;
  }
  if (decision === "reject") {
    return "Keep the model out of the default editor. A new candidate needs a separate pre-registration.";
  }
  return "The candidate may enter the review-only editor path. It must not apply edits without a recorded decision.";
}

export function evaluatePunctuationCandidate(options: {
  evidenceRoot: string;
  deterministicEvidenceRoot: string;
  experimentFile: string;
  candidateFile: string;
  outputFile: string;
  reportFile: string;
}) {
  const manifestFile = path.join(options.evidenceRoot, "manifest.json");
  const manifest = ReviewEvidenceManifestSchema.parse(readJson(manifestFile));
  const experiment = PunctuationExperimentSchema.parse(readJson(options.experimentFile));
  const candidate = PunctuationCandidateRunSchema.parse(readJson(options.candidateFile));
  if (candidate.cohortId !== manifest.cohortId) {
    throw new Error("candidate run does not belong to the governed decision cohort");
  }

  const eligible = loadEligibleDecisions(options.evidenceRoot, manifest);
  if (eligible.size !== experiment.sampleSize.eligibleDecisions) {
    throw new Error(
      `pre-registered ${experiment.sampleSize.eligibleDecisions} eligible decisions, found ${eligible.size}`,
    );
  }

  const candidateSites = new Set(candidate.artifacts.flatMap((artifact) =>
    artifact.suggestions.map((suggestion) => siteKey(
      suggestion.source.documentId,
      suggestion.source.revision,
      suggestion.span.startByte,
    ))
  ));
  const { accepted, rejected, changed, matchedAccepted, matchedRejected } =
    tallyEligibleDecisions(eligible, candidateSites);
  const matchedEligible = matchedAccepted + matchedRejected;
  const usefulYield = matchedEligible === 0 ? 0 : matchedAccepted / matchedEligible;
  const acceptedSiteRecall = accepted === 0 ? 0 : matchedAccepted / accepted;
  const unassessed = [...candidateSites].filter((key) => !eligible.has(key)).length;
  const unassessedPerArtifact = unassessed / candidate.summary.artifacts;
  const deterministic = deterministicCounts(options.deterministicEvidenceRoot);
  const targetHardware = candidate.runtime.gpuName === experiment.hardware.accelerator;
  const withinDeclaredMemoryLimit = candidate.runtime.peakCudaAllocatedBytes <=
    experiment.hardware.maximumPeakCudaAllocatedBytes;
  const withinDeclaredLatencyLimit =
    candidate.summary.medianInferenceMillisecondsPerArtifact <=
      experiment.hardware.maximumMedianInferenceMillisecondsPerArtifact;

  const adoptionGates = {
    sampleSize: eligible.size >= experiment.sampleSize.minimumEligibleDecisions,
    usefulYield: usefulYield >= experiment.decisionThresholds.adopt.minimumUsefulYield,
    acceptedSiteRecall:
      acceptedSiteRecall >= experiment.decisionThresholds.adopt.minimumAcceptedSiteRecall,
    proposalVolume:
      unassessedPerArtifact <=
        experiment.decisionThresholds.adopt.maximumUnassessedProposalsPerArtifact,
    qualityPreservation: !experiment.decisionThresholds.adopt.requireQualityPreservation,
    targetHardware,
    hardwareLimits: withinDeclaredMemoryLimit && withinDeclaredLatencyLimit,
  };
  const rejectionGates = {
    usefulYield: usefulYield <= experiment.decisionThresholds.reject.maximumUsefulYield,
    acceptedSiteRecall:
      acceptedSiteRecall <= experiment.decisionThresholds.reject.maximumAcceptedSiteRecall,
  };
  const decision = candidateDecision(adoptionGates, rejectionGates);

  const body = {
    schemaVersion: 1,
    recordType: "punctuation-candidate-evaluation",
    decision,
    inputs: {
      cohortId: manifest.cohortId,
      candidateRunId: candidate.runId,
      experimentContentHash: candidate.experimentContentHash,
      evidenceManifestHash: sha256(fs.readFileSync(manifestFile)),
    },
    sample: {
      eligibleDecisions: eligible.size,
      accepted,
      rejected,
      changed,
      minimumMet: adoptionGates.sampleSize,
    },
    candidate: {
      proposals: candidate.summary.proposals,
      matchedAccepted,
      matchedRejected,
      missedAccepted: accepted - matchedAccepted,
      unassessedProposals: unassessed,
      unassessedProposalsPerArtifact: unassessedPerArtifact,
      usefulYieldOnEligibleDecisions: usefulYield,
      acceptedSiteRecall,
      medianInferenceMillisecondsPerArtifact:
        candidate.summary.medianInferenceMillisecondsPerArtifact,
      peakCudaAllocatedBytes: candidate.runtime.peakCudaAllocatedBytes,
      targetHardware,
      withinDeclaredMemoryLimit,
      withinDeclaredLatencyLimit,
      qualityPreservationAssessed: false,
    },
    comparisons: {
      vale: { role: "detection-only", missingCommaRewriteProposals: 0 },
      deterministicSuggestions: {
        governedDocuments: deterministic.documents,
        rewriteProposalsAfterHardening: deterministic.proposals,
        missingCommaRewriteProposals: 0,
      },
      gector: {
        eligibleProposals: eligible.size,
        accepted,
        rejected,
        usefulYield: accepted / (accepted + rejected),
      },
    },
    gates: { adoption: adoptionGates, rejection: rejectionGates },
  };
  const evaluationId = `evaluation:v1:${sha256(canonicalJson(body)).slice("sha256:".length)}`;
  const result = EvaluationSchema.parse({ ...body, evaluationId });
  writeJson(options.outputFile, result);

  const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
  const mebibytes = candidate.runtime.peakCudaAllocatedBytes / 1024 / 1024;
  const report = [
    "# Missing-comma candidate report",
    "",
    `Decision: **${decision}**.`,
    "",
    "## Pre-registered sample",
    "",
    `The fixed sample contains ${eligible.size} governed GECToR comma-insertion decisions: ${accepted} accepted and ${rejected} rejected. The candidate threshold was pinned before inference.`,
    "",
    "## Result",
    "",
    `The candidate emitted ${candidate.summary.proposals} comma proposals across ${candidate.summary.artifacts} artifacts. It recovered ${matchedAccepted} of ${accepted} accepted sites and also proposed ${matchedRejected} of ${rejected} rejected sites. Useful yield on the labelled sites was ${percent(usefulYield)}. Accepted-site recall was ${percent(acceptedSiteRecall)}.`,
    "",
    `${unassessed} candidate proposals do not overlap the fixed decisions. Their factual, terminology, intent, and voice effects have not been reviewed, so the adoption quality gate remains closed.`,
    "",
    "## Runtime",
    "",
    `The run used ${candidate.runtime.gpuName}. The declared target is ${experiment.hardware.accelerator} on ${experiment.hardware.targetHost}. Median inference time was ${candidate.summary.medianInferenceMillisecondsPerArtifact.toFixed(1)} ms per artifact. Peak allocated CUDA memory was ${mebibytes.toFixed(1)} MiB.`,
    "",
    "## Baselines",
    "",
    `GECToR produced all ${eligible.size} labelled sites with ${percent(accepted / (accepted + rejected))} useful yield. Vale remains detection-only for this gap. The hardened deterministic pilot produced ${deterministic.proposals} rewrite proposals across ${deterministic.documents} governed documents and no missing-comma rewrites.`,
    "",
    "## Next evidence",
    "",
    nextEvidence(decision, unassessed),
    "",
  ].join("\n");
  fs.mkdirSync(path.dirname(options.reportFile), { recursive: true });
  fs.writeFileSync(options.reportFile, report);
  return result;
}

function main(): void {
  const { values } = parseArgs({ options: {
    evidence: { type: "string" },
    deterministic: { type: "string" },
    experiment: { type: "string" },
    candidate: { type: "string" },
    output: { type: "string" },
    report: { type: "string" },
  } });
  const args = z.object({
    evidence: z.string(), deterministic: z.string(), experiment: z.string(),
    candidate: z.string(), output: z.string(), report: z.string(),
  }).parse(values);
  const result = evaluatePunctuationCandidate({
    evidenceRoot: args.evidence,
    deterministicEvidenceRoot: args.deterministic,
    experimentFile: args.experiment,
    candidateFile: args.candidate,
    outputFile: args.output,
    reportFile: args.report,
  });
  process.stdout.write(`Punctuation candidate decision: ${result.decision}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
