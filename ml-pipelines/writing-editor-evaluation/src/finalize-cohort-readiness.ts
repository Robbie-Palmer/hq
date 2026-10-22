import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { canonicalJson } from "writing-editor-domain/canonical-json";
import { sha256 } from "writing-editor-domain/suggestions";
import { z } from "zod";

import { evaluateReviews, ReviewEvidenceManifestSchema } from "./evaluate-reviews";
import { readJson, writeJson } from "./files";
import { cohortReadiness, readinessMarkdown } from "./freeze-cohort";
import { FrozenCohortSchema, PipelineParamsSchema } from "./schemas";

const SeedOutcomesSchema = z.object({
  schemaVersion: z.literal(1),
  recordType: z.literal("writing-editor-seed-outcomes"),
  cohortId: z.string().regex(/^cohort:v1:[a-f0-9]{64}$/),
  artifactIds: z.array(z.string().regex(/^seed-[a-z0-9]+(?:-[a-z0-9]+)*$/)),
  evidenceManifestHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
}).strict();

export function finalizeCohortReadiness(options: {
  cohortFile: string;
  paramsFile: string;
  evidenceManifestFile: string;
  evidenceRoot: string;
  seedOutcomesFile: string;
  evaluationParamsFile: string;
  outputJson: string;
  outputMarkdown: string;
}): void {
  const cohort = FrozenCohortSchema.parse(readJson(options.cohortFile));
  const params = PipelineParamsSchema.parse(readJson(options.paramsFile));
  const manifest = ReviewEvidenceManifestSchema.parse(readJson(options.evidenceManifestFile));
  const seedOutcomes = SeedOutcomesSchema.parse(readJson(options.seedOutcomesFile));
  const scorecard = evaluateReviews({
    manifestFile: options.evidenceManifestFile,
    evidenceRoot: options.evidenceRoot,
    paramsFile: options.evaluationParamsFile,
  });
  if (seedOutcomes.cohortId !== cohort.cohortId) {
    throw new Error("seed outcomes do not match the frozen cohort");
  }
  if (seedOutcomes.evidenceManifestHash !== sha256(canonicalJson(manifest))) {
    throw new Error("seed outcomes do not match the evidence manifest");
  }
  const manifestEntries = new Map(manifest.entries.map((entry) => [entry.artifactId, entry]));
  const frozenEntries = new Map(cohort.entries.map((entry) => [entry.artifactId, entry]));
  for (const evidenceId of seedOutcomes.artifactIds) {
    const provenance = manifestEntries.get(evidenceId)?.provenance;
    if (provenance?.scope !== "seed") {
      throw new Error("seed outcomes refer to missing or non-seed evidence entries");
    }
    const cohortEntry = frozenEntries.get(evidenceId.slice("seed-".length));
    if (
      !cohortEntry ||
      provenance.sourceDatasetId !== cohort.datasetId ||
      provenance.sourceRevision !== cohortEntry.source.revision
    ) {
      throw new Error("seed outcomes do not match the frozen cohort source");
    }
  }
  const recorded = scorecard.gates.deletionClear
    ? new Set(seedOutcomes.artifactIds.map((artifactId) => artifactId.slice(5)))
    : new Set<string>();
  const report = cohortReadiness(
    cohort.cohortId,
    cohort.entries,
    params.cohort.requiredArtifactTypes,
    recorded,
  );
  writeJson(options.outputJson, report);
  fs.mkdirSync(path.dirname(options.outputMarkdown), { recursive: true });
  fs.writeFileSync(options.outputMarkdown, readinessMarkdown(report));
}

/* v8 ignore start -- exercised by the mise and DVC command wrappers */
function main(): void {
  const { values } = parseArgs({ options: {
    cohort: { type: "string" },
    params: { type: "string" },
    manifest: { type: "string" },
    evidence: { type: "string" },
    outcomes: { type: "string" },
    "evaluation-params": { type: "string" },
    "output-json": { type: "string" },
    "output-markdown": { type: "string" },
  } });
  const args = z.object({
    cohort: z.string().min(1), params: z.string().min(1), manifest: z.string().min(1),
    evidence: z.string().min(1), outcomes: z.string().min(1),
    "evaluation-params": z.string().min(1), "output-json": z.string().min(1),
    "output-markdown": z.string().min(1),
  }).strict().parse(values);
  finalizeCohortReadiness({
    cohortFile: args.cohort,
    paramsFile: args.params,
    evidenceManifestFile: args.manifest,
    evidenceRoot: args.evidence,
    seedOutcomesFile: args.outcomes,
    evaluationParamsFile: args["evaluation-params"],
    outputJson: args["output-json"],
    outputMarkdown: args["output-markdown"],
  });
  console.log(`Finalized cohort readiness in ${args["output-json"]}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
/* v8 ignore stop */
