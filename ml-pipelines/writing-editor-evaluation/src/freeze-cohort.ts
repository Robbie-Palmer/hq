import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { canonicalJson } from "writing-editor-domain/canonical-json";
import { sha256 } from "writing-editor-domain/suggestions";
import { z } from "zod";

import { readJson, resetDirectory, writeJson } from "./files";
import {
  type ArtifactType,
  DatasetManifestSchema,
  FrozenCohortSchema,
  type FrozenEntry,
  PipelineParamsSchema,
  ReadinessSchema,
  type Readiness,
  type Split,
} from "./schemas";

const SPLITS: Split[] = ["train", "validation", "holdout"];
const ARTIFACT_TYPES: ArtifactType[] = ["adr", "project-page"];

const FreezeCliOptionsSchema = z.object({
  dataset: z.string().trim().min(1),
  params: z.string().trim().min(1),
  output: z.string().trim().min(1),
}).strict();

export interface FreezeCohortOptions {
  datasetFile: string;
  paramsFile: string;
  output: string;
  outputRoot: string;
}

function compareAscending(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function allocation(
  size: number,
  ratios: Record<Split, number>,
): Record<Split, number> {
  const exact = SPLITS.map((split) => ({ split, count: size * ratios[split] }));
  const counts = Object.fromEntries(
    exact.map(({ split, count }) => [split, Math.floor(count)]),
  ) as Record<Split, number>;
  let remaining = size - Object.values(counts).reduce((sum, count) => sum + count, 0);
  const remainderOrder = [...exact].sort((left, right) =>
    right.count - Math.floor(right.count) - (left.count - Math.floor(left.count)) ||
    SPLITS.indexOf(left.split) - SPLITS.indexOf(right.split)
  );
  for (const { split } of remainderOrder) {
    if (remaining === 0) break;
    counts[split] += 1;
    remaining -= 1;
  }
  return counts;
}

function freezeEntries(
  entries: z.infer<typeof DatasetManifestSchema>["entries"],
  seed: string,
  ratios: Record<Split, number>,
): FrozenEntry[] {
  const frozen: FrozenEntry[] = [];
  for (const artifactType of ARTIFACT_TYPES) {
    const ranked = entries
      .filter((entry) => entry.artifactType === artifactType)
      .map((entry) => ({
        entry,
        rank: sha256(`${seed}\0${artifactType}\0${entry.artifactId}`),
      }))
      .sort((left, right) => compareAscending(left.rank, right.rank));
    const counts = allocation(ranked.length, ratios);
    let offset = 0;
    for (const split of SPLITS) {
      for (const item of ranked.slice(offset, offset + counts[split])) {
        frozen.push({ ...item.entry, split });
      }
      offset += counts[split];
    }
  }
  return frozen.sort((left, right) =>
    SPLITS.indexOf(left.split) - SPLITS.indexOf(right.split) ||
    compareAscending(left.artifactId, right.artifactId)
  );
}

function emptyCounts(): Record<ArtifactType, number> {
  return { adr: 0, "project-page": 0 };
}

export function cohortReadiness(
  cohortId: string,
  entries: FrozenEntry[],
  requiredArtifactTypes: ArtifactType[],
  recordedOutcomeArtifactIds: ReadonlySet<string> = new Set(),
): Readiness {
  const byArtifactType = emptyCounts();
  const bySplit: Record<Split, Record<ArtifactType, number>> = {
    train: emptyCounts(),
    validation: emptyCounts(),
    holdout: emptyCounts(),
  };
  for (const entry of entries) {
    byArtifactType[entry.artifactType] += 1;
    bySplit[entry.split][entry.artifactType] += 1;
  }
  const missingOutcomes = entries
    .filter(({ artifactId }) => !recordedOutcomeArtifactIds.has(artifactId))
    .map(({ artifactId }) => artifactId)
    .sort(compareAscending);
  const requiredArtifactTypesPresent = requiredArtifactTypes.every(
    (artifactType) => byArtifactType[artifactType] > 0,
  );
  const missingRevisions = entries
    .filter(({ source, published }) => source.contentHash === published.contentHash)
    .map(({ artifactId }) => artifactId)
    .sort(compareAscending);
  const revisionsComplete = missingRevisions.length === 0;
  const outcomesComplete = missingOutcomes.length === 0;
  return ReadinessSchema.parse({
    schemaVersion: 1,
    recordType: "writing-editor-cohort-readiness",
    cohortId,
    ready: revisionsComplete && outcomesComplete && requiredArtifactTypesPresent,
    revisions: {
      complete: revisionsComplete,
      extractedPairs: entries.length,
      missingArtifactIds: missingRevisions,
    },
    outcomes: {
      complete: outcomesComplete,
      recorded: entries.length - missingOutcomes.length,
      missingArtifactIds: missingOutcomes,
    },
    coverage: {
      total: entries.length,
      requiredArtifactTypesPresent,
      byArtifactType,
      bySplit,
    },
  });
}

export function readinessMarkdown(report: Readiness): string {
  const lines = [
    "# Writing editor cohort readiness",
    "",
    `Status: ${report.ready ? "ready" : "not ready"}`,
    "",
    `Revision pairs: ${report.revisions.extractedPairs}`,
    `Recorded edit outcomes: ${report.outcomes.recorded}/${report.coverage.total}`,
    `ADRs: ${report.coverage.byArtifactType.adr}`,
    `Project pages: ${report.coverage.byArtifactType["project-page"]}`,
    "",
    "## Split coverage",
    "",
    "| Split | ADRs | Project pages | Total |",
    "| --- | ---: | ---: | ---: |",
  ];
  for (const split of SPLITS) {
    const counts = report.coverage.bySplit[split];
    lines.push(
      `| ${split} | ${counts.adr} | ${counts["project-page"]} | ${counts.adr + counts["project-page"]} |`,
    );
  }
  if (report.revisions.missingArtifactIds.length > 0) {
    lines.push(
      "",
      "## Missing revision pairs",
      "",
      ...report.revisions.missingArtifactIds.map((artifactId) => `- ${artifactId}`),
    );
  }
  if (report.outcomes.missingArtifactIds.length > 0) {
    lines.push(
      "",
      "## Missing edit outcomes",
      "",
      ...report.outcomes.missingArtifactIds.map((artifactId) => `- ${artifactId}`),
    );
  }
  return `${lines.join("\n")}\n`;
}

export function freezeCohort(options: FreezeCohortOptions): {
  cohort: z.infer<typeof FrozenCohortSchema>;
  readiness: Readiness;
} {
  const dataset = DatasetManifestSchema.parse(readJson(options.datasetFile));
  const params = PipelineParamsSchema.parse(readJson(options.paramsFile));
  const entries = freezeEntries(dataset.entries, params.cohort.seed, params.cohort.split);
  const cohortDigest = sha256(canonicalJson({
    datasetId: dataset.datasetId,
    frozenAt: params.cohort.frozenAt,
    seed: params.cohort.seed,
    splitRatios: params.cohort.split,
    entries: entries.map(({ artifactId, split }) => ({ artifactId, split })),
  })).slice("sha256:".length);
  const cohort = FrozenCohortSchema.parse({
    schemaVersion: 1,
    recordType: "writing-editor-frozen-cohort",
    cohortId: `cohort:v1:${cohortDigest}`,
    datasetId: dataset.datasetId,
    frozenAt: params.cohort.frozenAt,
    seed: params.cohort.seed,
    splitRatios: params.cohort.split,
    entries,
  });
  const report = cohortReadiness(
    cohort.cohortId,
    cohort.entries,
    params.cohort.requiredArtifactTypes,
  );

  resetDirectory(options.output, options.outputRoot);
  writeJson(path.join(options.output, "cohort.json"), cohort);
  writeJson(path.join(options.output, "readiness.json"), report);
  fs.writeFileSync(path.join(options.output, "readiness.md"), readinessMarkdown(report));
  return { cohort, readiness: report };
}

function main(): void {
  const { values } = parseArgs({
    options: {
      dataset: { type: "string" },
      params: { type: "string" },
      output: { type: "string" },
    },
  });
  const args = FreezeCliOptionsSchema.parse(values);
  const result = freezeCohort({
    datasetFile: args.dataset,
    paramsFile: args.params,
    output: args.output,
    outputRoot: path.resolve("."),
  });
  console.log(
    `Froze ${result.cohort.entries.length} artifacts as ${result.cohort.cohortId}; readiness: ${result.readiness.ready ? "ready" : "not ready"}`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
