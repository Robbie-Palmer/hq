import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { canonicalJson } from "writing-editor-domain/canonical-json";
import { sha256 } from "writing-editor-domain/suggestions";
import { z } from "zod";

import { resetDirectory, writeJson } from "./files";
import {
  assertRevisionPair,
  fileAtRevision,
  repositoryRoot,
  revisionTimestamp,
} from "./git-revisions";
import {
  CorpusSourceManifestSchema,
  DatasetManifestSchema,
  type DatasetEntry,
  type DatasetManifest,
} from "./schemas";

const ExtractCliOptionsSchema = z.object({
  manifest: z.string().trim().min(1),
  repository: z.string().trim().min(1),
  output: z.string().trim().min(1),
}).strict();

export interface ExtractDatasetOptions {
  manifestFile: string;
  repository: string;
  output: string;
  outputRoot: string;
}

interface PreparedArtifact {
  entry: DatasetEntry;
  sourceContent: Buffer;
  publishedContent: Buffer;
}

function prepareArtifacts(options: ExtractDatasetOptions): {
  artifacts: PreparedArtifact[];
  sourceManifestHash: string;
} {
  const manifestBytes = fs.readFileSync(options.manifestFile);
  const sourceManifest = CorpusSourceManifestSchema.parse(
    JSON.parse(manifestBytes.toString("utf8")),
  );
  const repository = repositoryRoot(options.repository);
  const artifacts = sourceManifest.entries.map((entry): PreparedArtifact => {
    assertRevisionPair(repository, entry.sourceRevision, entry.publishedRevision);
    const sourceContent = fileAtRevision(
      repository,
      entry.sourceRevision,
      entry.sourcePath ?? entry.path,
    );
    const publishedContent = fileAtRevision(
      repository,
      entry.publishedRevision,
      entry.publishedPath ?? entry.path,
    );
    if (sourceContent.equals(publishedContent)) {
      throw new Error(`${entry.artifactId} has no change between its pinned revisions`);
    }

    const extension = path.posix.extname(entry.path) || ".md";
    const directory = `artifacts/${entry.artifactId}`;
    return {
      sourceContent,
      publishedContent,
      entry: {
        artifactId: entry.artifactId,
        artifactType: entry.artifactType,
        path: entry.path,
        outcomeStatus: entry.outcomeStatus,
        source: {
          revision: entry.sourceRevision,
          committedAt: revisionTimestamp(repository, entry.sourceRevision),
          contentHash: sha256(sourceContent),
          bytes: sourceContent.byteLength,
          file: `${directory}/source${extension}`,
        },
        published: {
          revision: entry.publishedRevision,
          committedAt: revisionTimestamp(repository, entry.publishedRevision),
          contentHash: sha256(publishedContent),
          bytes: publishedContent.byteLength,
          file: `${directory}/published${extension}`,
        },
      },
    };
  }).sort((left, right) => compareAscending(left.entry.artifactId, right.entry.artifactId));

  return { artifacts, sourceManifestHash: sha256(manifestBytes) };
}

export function extractDataset(options: ExtractDatasetOptions): DatasetManifest {
  const { artifacts, sourceManifestHash } = prepareArtifacts(options);
  const entries = artifacts.map(({ entry }) => entry);
  const digest = sha256(canonicalJson({ schemaVersion: 1, sourceManifestHash, entries }))
    .slice("sha256:".length);
  const dataset = DatasetManifestSchema.parse({
    schemaVersion: 1,
    recordType: "writing-editor-dataset",
    datasetId: `dataset:v1:${digest}`,
    sourceManifestHash,
    entries,
  });

  resetDirectory(options.output, options.outputRoot);
  for (const artifact of artifacts) {
    const sourceFile = path.join(options.output, artifact.entry.source.file);
    const publishedFile = path.join(options.output, artifact.entry.published.file);
    fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
    fs.writeFileSync(sourceFile, artifact.sourceContent);
    fs.writeFileSync(publishedFile, artifact.publishedContent);
  }
  writeJson(path.join(options.output, "manifest.json"), dataset);
  return dataset;
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

function main(): void {
  const { values } = parseArgs({
    options: {
      manifest: { type: "string" },
      repository: { type: "string" },
      output: { type: "string" },
    },
  });
  const args = ExtractCliOptionsSchema.parse(values);
  const dataset = extractDataset({
    manifestFile: args.manifest,
    repository: args.repository,
    output: args.output,
    outputRoot: path.resolve("."),
  });
  console.log(`Extracted ${dataset.entries.length} writing pairs as ${dataset.datasetId}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
