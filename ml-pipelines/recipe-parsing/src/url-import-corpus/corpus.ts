import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  CorpusCatalogSchema,
  type CorpusFixture,
  type CorpusPartition,
  type CoverageTag,
  PartitionManifestSchema,
  type PartitionManifest,
} from "./schema.js";

export const PARTITION_MANIFESTS: Record<CorpusPartition, string> = {
  train: "manifests/train.json",
  development: "manifests/development.json",
  holdout: "manifests/holdout.json",
};

export function sha256(value: string | NodeJS.ArrayBufferView): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot read JSON ${file}: ${message}`);
  }
}

function withinRoot(root: string, relativePath: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relativePath);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Path leaves corpus root: ${relativePath}`);
  }
  return resolved;
}

export function loadPartitionManifest(
  corpusRoot: string,
  partition: CorpusPartition,
): PartitionManifest {
  const file = withinRoot(corpusRoot, PARTITION_MANIFESTS[partition]);
  const manifest = PartitionManifestSchema.parse(readJson(file));
  if (manifest.partition !== partition) {
    throw new Error(
      `${PARTITION_MANIFESTS[partition]} declares ${manifest.partition}`,
    );
  }
  return manifest;
}

function listSnapshotPaths(root: string): string[] {
  const snapshotsRoot = path.join(root, "snapshots");
  const paths: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) {
        paths.push(path.relative(root, file).split(path.sep).join("/"));
      }
    }
  };
  visit(snapshotsRoot);
  return paths.sort((left, right) => left.localeCompare(right));
}

function duplicateValues(
  fixtures: CorpusFixture[],
  field: "sourceGroup" | "patternFamily",
): string[] {
  const partitionsByValue = new Map<string, Set<CorpusPartition>>();
  for (const fixture of fixtures) {
    const partition = fixture.artifact.path.split("/")[1] as CorpusPartition;
    const partitions = partitionsByValue.get(fixture[field]) ?? new Set();
    partitions.add(partition);
    partitionsByValue.set(fixture[field], partitions);
  }
  return [...partitionsByValue]
    .filter(([, partitions]) => partitions.size > 1)
    .map(([value]) => value)
    .sort((left, right) => left.localeCompare(right));
}

function requireUnique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} values must be unique`);
  }
}

export function assertNoPartitionLeakage(
  manifests: PartitionManifest[],
): void {
  const fixtures = manifests.flatMap(({ fixtures }) => fixtures);
  requireUnique(fixtures.map(({ id }) => id), "Fixture ID");
  requireUnique(fixtures.map(({ artifact }) => artifact.path), "Artifact path");
  requireUnique(fixtures.map(({ artifact }) => artifact.sha256), "Artifact hash");
  requireUnique(fixtures.map(({ retrieval }) => retrieval.sourceUrl), "Source URL");

  for (const field of ["sourceGroup", "patternFamily"] as const) {
    const duplicates = duplicateValues(fixtures, field);
    if (duplicates.length > 0) {
      throw new Error(
        `${field} crosses partitions: ${duplicates.join(", ")}`,
      );
    }
  }
}

export type CorpusValidationSummary = {
  schemaVersion: 1;
  corpusVersion: string;
  fixtureCount: number;
  partitions: Record<CorpusPartition, number>;
  coverage: string[];
  holdout: { sealed: true; routineReplayAllowed: false };
};

function validateCatalogManifest(
  corpusRoot: string,
  catalog: ReturnType<typeof CorpusCatalogSchema.parse>,
  manifest: PartitionManifest,
): void {
  if (manifest.corpusVersion !== catalog.corpusVersion) {
    throw new Error(`${manifest.partition} corpus version does not match catalog`);
  }
  const catalogEntry = catalog.partitions.find(
    ({ name }) => name === manifest.partition,
  );
  if (!catalogEntry) throw new Error(`Catalog omits ${manifest.partition}`);
  const manifestFile = withinRoot(corpusRoot, catalogEntry.manifest);
  const manifestBytes = fs.readFileSync(manifestFile);
  if (sha256(manifestBytes) !== catalogEntry.sha256) {
    throw new Error(`${catalogEntry.manifest} checksum does not match catalog`);
  }
  if (catalogEntry.fixtureCount !== manifest.fixtures.length) {
    throw new Error(`${manifest.partition} fixture count does not match catalog`);
  }
  if (catalogEntry.sealed !== manifest.sealed) {
    throw new Error(`${manifest.partition} seal does not match catalog`);
  }
}

function validateFixtureArtifact(
  corpusRoot: string,
  partition: CorpusPartition,
  fixture: CorpusFixture,
): void {
  const expectedPrefix = `snapshots/${partition}/`;
  if (!fixture.artifact.path.startsWith(expectedPrefix)) {
    throw new Error(`${fixture.id} is outside its partition directory`);
  }
  const file = withinRoot(corpusRoot, fixture.artifact.path);
  const content = fs.readFileSync(file);
  if (content.byteLength !== fixture.artifact.bytes) {
    throw new Error(`${fixture.id} byte count does not match`);
  }
  if (sha256(content) !== fixture.artifact.sha256) {
    throw new Error(`${fixture.id} checksum does not match`);
  }
}

function validateSnapshotInventory(
  corpusRoot: string,
  fixtures: CorpusFixture[],
): void {
  const declaredPaths = fixtures
    .map(({ artifact }) => artifact.path)
    .sort((left, right) => left.localeCompare(right));
  const snapshotPaths = listSnapshotPaths(corpusRoot);
  if (JSON.stringify(declaredPaths) !== JSON.stringify(snapshotPaths)) {
    throw new Error("Snapshot directory and manifests contain different files");
  }
}

function validateCoverage(
  fixtures: CorpusFixture[],
  requiredCoverage: CoverageTag[],
): CoverageTag[] {
  const coverage = [
    ...new Set(fixtures.flatMap((fixture) => fixture.coverage)),
  ].sort((left, right) => left.localeCompare(right));
  for (const required of requiredCoverage) {
    if (!coverage.includes(required)) {
      throw new Error(`Corpus does not cover ${required}`);
    }
  }
  return coverage;
}

function validateFocacciaHoldout(fixtures: CorpusFixture[]): void {
  const focaccia = fixtures.filter((fixture) =>
    fixture.coverage.includes("focaccia-known-failure"),
  );
  if (
    focaccia.length !== 1 ||
    !focaccia[0]?.artifact.path.startsWith("snapshots/holdout/")
  ) {
    throw new Error("The focaccia regression must appear once in holdout");
  }
}

export function validateCorpus(corpusRoot: string): CorpusValidationSummary {
  const catalogFile = path.join(corpusRoot, "catalog.json");
  const catalog = CorpusCatalogSchema.parse(readJson(catalogFile));
  const manifests = CorpusPartitionSchemaOptions.map((partition) =>
    loadPartitionManifest(corpusRoot, partition),
  );

  for (const manifest of manifests) {
    validateCatalogManifest(corpusRoot, catalog, manifest);
  }

  assertNoPartitionLeakage(manifests);
  const fixtures = manifests.flatMap(({ fixtures }) => fixtures);
  for (const manifest of manifests) {
    for (const fixture of manifest.fixtures) {
      validateFixtureArtifact(corpusRoot, manifest.partition, fixture);
    }
  }

  validateSnapshotInventory(corpusRoot, fixtures);
  const coverage = validateCoverage(fixtures, catalog.requiredCoverage);
  validateFocacciaHoldout(fixtures);
  const partitionCounts: Record<CorpusPartition, number> = {
    train: 0,
    development: 0,
    holdout: 0,
  };
  for (const manifest of manifests) {
    partitionCounts[manifest.partition] = manifest.fixtures.length;
  }

  return {
    schemaVersion: 1,
    corpusVersion: catalog.corpusVersion,
    fixtureCount: fixtures.length,
    partitions: partitionCounts,
    coverage,
    holdout: { sealed: true, routineReplayAllowed: false },
  };
}

const CorpusPartitionSchemaOptions: CorpusPartition[] = [
  "train",
  "development",
  "holdout",
];

export function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}
