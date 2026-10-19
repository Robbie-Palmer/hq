import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { z } from "zod";

import { CurrentContentManifestSchema } from "./build-current-content-corpus";
import { readJson, resetDirectory, writeJson } from "./files";
import { GectorProducerRunSchema, type GectorProducerRun } from "./schemas";

const ProfileSchema = z.enum(["baseline", "balanced", "strict"]);

const CliOptionsSchema = z.object({
  manifest: z.string().trim().min(1),
  baseline: z.string().trim().min(1),
  balanced: z.string().trim().min(1),
  strict: z.string().trim().min(1),
  full: z.string().trim().min(1),
  output: z.string().trim().min(1),
}).strict();

type Manifest = z.infer<typeof CurrentContentManifestSchema>;

function profileSummary(run: GectorProducerRun) {
  return {
    minErrorProbability: run.parameters.minErrorProbability,
    additionalConfidence: run.parameters.additionalConfidence,
    ...run.summary,
    proposalsPerArtifact: run.summary.proposals / run.summary.artifacts,
  };
}

function markdown(report: ReturnType<typeof createReport>): string {
  const lines = [
    `# Current ${report.corpus.audience}-content GECToR report`,
    "",
    `Corpus: ${report.corpus.pages} pages at \`${report.corpus.revision}\``,
    "",
    "## Calibration",
    "",
    "| Profile | Error threshold | Confidence penalty | Suggestions | Proposals | Pages with proposals |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...ProfileSchema.options.map((profile) => {
      const result = report.calibration[profile];
      return `| ${profile} | ${result.minErrorProbability} | ${result.additionalConfidence} | ${result.suggestions} | ${result.proposals} | ${result.artifactsWithSuggestions}/${result.artifacts} |`;
    }),
    "",
    "The strict profile is the full-corpus profile. Suggestions remain review-only; this report does not treat model output as accepted prose.",
    "",
    "## Strict full-corpus run",
    "",
    `The GPU run produced ${report.full.suggestions} suggestions in ${report.full.proposals} proposals across ${report.full.artifactsWithSuggestions} of ${report.full.artifacts} pages.`,
    "",
    "| Content kind | Pages | Pages with proposals | Suggestions | Proposals |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...Object.entries(report.full.byKind).map(([kind, result]) =>
      `| ${kind} | ${result.artifacts} | ${result.artifactsWithSuggestions} | ${result.suggestions} | ${result.proposals} |`
    ),
    "",
    "## Highest-volume review targets",
    "",
    ...report.full.topArtifacts.map((artifact) =>
      `- \`${artifact.path}\`: ${artifact.proposals} proposals (${artifact.suggestions} suggestions)`
    ),
    "",
  ];
  return `${lines.join("\n")}\n`;
}

export function createReport(
  manifest: Manifest,
  calibration: Record<z.infer<typeof ProfileSchema>, GectorProducerRun>,
  full: GectorProducerRun,
) {
  const entryByPath = new Map(manifest.entries.map((entry) => [entry.path, entry]));
  const kinds = [...new Set(manifest.entries.map(({ kind }) => kind))]
    .sort((left, right) => left.localeCompare(right));
  const byKind = Object.fromEntries(kinds.map((kind) => {
    const entries = manifest.entries.filter((entry) => entry.kind === kind);
    const artifacts = full.artifacts.filter((artifact) => entryByPath.get(artifact.source.documentId)?.kind === kind);
    return [kind, {
      artifacts: entries.length,
      artifactsWithSuggestions: artifacts.filter(({ suggestions }) => suggestions.length > 0).length,
      suggestions: artifacts.reduce((total, artifact) => total + artifact.suggestions.length, 0),
      proposals: artifacts.reduce((total, artifact) => total + artifact.proposals.length, 0),
    }];
  }));
  const topArtifacts = full.artifacts
    .filter(({ proposals }) => proposals.length > 0)
    .map((artifact) => ({
      path: artifact.source.documentId,
      suggestions: artifact.suggestions.length,
      proposals: artifact.proposals.length,
    }))
    .sort((left, right) =>
      right.proposals - left.proposals || left.path.localeCompare(right.path)
    )
    .slice(0, 10);
  return {
    schemaVersion: 1,
    recordType: "writing-editor-current-content-gector-report",
    corpus: {
      audience: manifest.audience,
      datasetId: manifest.datasetId,
      revision: manifest.revision,
      pages: manifest.entries.length,
      calibrationPages: manifest.calibrationArtifactIds.length,
    },
    calibration: Object.fromEntries(ProfileSchema.options.map((profile) => [
      profile,
      profileSummary(calibration[profile]),
    ])) as Record<z.infer<typeof ProfileSchema>, ReturnType<typeof profileSummary>>,
    full: {
      ...full.summary,
      byKind,
      topArtifacts,
    },
  };
}

function main(): void {
  const { values } = parseArgs({
    options: {
      manifest: { type: "string" },
      baseline: { type: "string" },
      balanced: { type: "string" },
      strict: { type: "string" },
      full: { type: "string" },
      output: { type: "string" },
    },
  });
  const args = CliOptionsSchema.parse(values);
  const manifest = CurrentContentManifestSchema.parse(readJson(args.manifest));
  const calibration = Object.fromEntries(ProfileSchema.options.map((profile) => [
    profile,
    GectorProducerRunSchema.parse(readJson(args[profile])),
  ])) as Record<z.infer<typeof ProfileSchema>, GectorProducerRun>;
  const full = GectorProducerRunSchema.parse(readJson(args.full));
  const report = createReport(manifest, calibration, full);
  resetDirectory(args.output, path.resolve("."));
  writeJson(path.join(args.output, "report.json"), report);
  fs.writeFileSync(path.join(args.output, "report.md"), markdown(report));
  console.log(`Reported ${report.full.proposals} strict proposals across ${report.corpus.pages} pages`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
