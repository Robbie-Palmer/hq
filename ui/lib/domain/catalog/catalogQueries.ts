import type { DomainRepository } from "@/lib/repository";
import type { ADRRef } from "../adr/adr";
import type { CatalogId, CatalogRecord } from "./catalog";
import {
  CatalogManifestSchema,
  CatalogRecordSchema,
  catalogIdToUri,
  findBrokenCatalogReferences,
} from "./catalog";

export interface CatalogViewRecord extends CatalogRecord {
  uri: string;
  source: "derived" | "declared";
}

export interface CatalogDocument {
  schemaVersion: 1;
  source: string;
  records: CatalogViewRecord[];
  platformManifest: NonNullable<DomainRepository["platform"]["manifest"]>;
}

function projectId(slug: string): CatalogId {
  return `project:${slug}` as CatalogId;
}

function derivedRecord(record: CatalogRecord): CatalogViewRecord {
  const parsed = CatalogRecordSchema.parse(record);
  return {
    ...parsed,
    uri: catalogIdToUri(parsed.id),
    source: "derived",
  };
}

function validateCatalogView(records: CatalogViewRecord[]): void {
  const manifest = CatalogManifestSchema.parse({ records });
  const brokenReferences = findBrokenCatalogReferences(manifest, new Set());
  if (brokenReferences.length > 0) {
    const broken = brokenReferences[0];
    throw new Error(
      `Derived catalog record '${broken?.recordId}' references missing ID '${broken?.target}'`,
    );
  }
}

function decisionRecord(
  repository: DomainRepository,
  adrRef: ADRRef,
): CatalogViewRecord | undefined {
  const adr = repository.adrs.get(adrRef);
  if (!adr) return undefined;
  const aliases = Array.from(repository.adrAliases)
    .filter(([, target]) => target === adrRef)
    .map(([alias]) => `decision:${alias}` as CatalogId);
  return derivedRecord({
    id: `decision:${adrRef}` as CatalogId,
    kind: "decision",
    name: adr.title,
    sourcePaths: [
      `ui/content/projects/${adr.projectSlug}/adrs/${adr.slug}.mdx`,
    ],
    relations: [],
    decisionRefs: [adrRef],
    aliases,
    externalIds: [],
  });
}

function evidenceRecord(
  repository: DomainRepository,
  adrRef: ADRRef,
): CatalogViewRecord | undefined {
  const adr = repository.adrs.get(adrRef);
  if (!adr) return undefined;
  const aliases = Array.from(repository.adrAliases)
    .filter(([, target]) => target === adrRef)
    .map(([alias]) => `evidence:${alias}` as CatalogId);
  return derivedRecord({
    id: `evidence:${adrRef}` as CatalogId,
    kind: "evidence",
    name: adr.title,
    sourcePaths: [
      `ui/content/projects/${adr.projectSlug}/adrs/${adr.slug}.mdx`,
    ],
    relations: [
      {
        type: "supported_by",
        target: `decision:${adrRef}` as CatalogId,
      },
    ],
    decisionRefs: [adrRef],
    aliases,
    externalIds: [],
  });
}

function platformRecords(repository: DomainRepository): CatalogViewRecord[] {
  const manifest = repository.platform.manifest;
  if (!manifest) return [];
  const records: CatalogViewRecord[] = [];

  for (const slot of manifest.slots) {
    const capabilityId = `capability:${slot.slug}` as CatalogId;
    const acceptedSelections = manifest.selections.filter(
      (selection) =>
        selection.slot === slot.slug && selection.status === "Accepted",
    );
    records.push(
      derivedRecord({
        id: capabilityId,
        kind: "capability",
        name: slot.title,
        sourcePaths: [
          "ui/content/projects/personal-engineering-platform/platform.yaml",
        ],
        relations: acceptedSelections.flatMap((selection) =>
          selection.kind === "technology"
            ? [
                {
                  type: "selects" as const,
                  target: `technology:${selection.technology}` as CatalogId,
                },
              ]
            : [],
        ),
        decisionRefs: Array.from(
          new Set(acceptedSelections.map((selection) => selection.decision)),
        ),
        aliases: [],
        externalIds: [],
      }),
      derivedRecord({
        id: `slot:${slot.slug}` as CatalogId,
        kind: "slot",
        name: slot.title,
        sourcePaths: [
          "ui/content/projects/personal-engineering-platform/platform.yaml",
        ],
        relations: [{ type: "part_of", target: capabilityId }],
        decisionRefs: Array.from(
          new Set(acceptedSelections.map((selection) => selection.decision)),
        ),
        aliases: [],
        externalIds: [],
      }),
    );
  }

  for (const [projectSlug, uses] of repository.platform.projectLayerUses) {
    for (const use of uses) {
      const adoptedKey = use.adopted.replaceAll(/[^0-9]/g, "");
      const decisionRefs = use.decision ? [use.decision] : [];
      records.push(
        derivedRecord({
          id: `adoption:${projectSlug}/${use.layer}/${adoptedKey}` as CatalogId,
          kind: "adoption",
          name: `${projectSlug} adoption of ${use.layer}`,
          project: projectId(projectSlug),
          sourcePaths: [`ui/content/projects/${projectSlug}/index.mdx`],
          relations: manifest.policies
            .filter((policy) => policy.layer === use.layer)
            .map((policy) => ({
              type: "adopts" as const,
              target: `capability:${policy.slot}` as CatalogId,
            })),
          decisionRefs,
          aliases: [],
          externalIds: [],
        }),
      );
    }
  }

  for (const [adrRef, override] of repository.platform.adrOverrides) {
    const adr = repository.adrs.get(adrRef);
    if (!adr) continue;
    records.push(
      derivedRecord({
        id: `override:${adr.projectSlug}/${adr.slug}` as CatalogId,
        kind: "override",
        name: adr.title,
        project: projectId(adr.projectSlug),
        sourcePaths: [
          `ui/content/projects/${adr.projectSlug}/adrs/${adr.slug}.mdx`,
        ],
        relations: [
          {
            type: "overrides",
            target: `slot:${override.slot}` as CatalogId,
          },
          ...(override.kind === "technology"
            ? [
                {
                  type: "selects" as const,
                  target: `technology:${override.technology}` as CatalogId,
                },
              ]
            : []),
        ],
        decisionRefs: [adrRef],
        aliases: [],
        externalIds: [],
      }),
    );
  }
  return records;
}

export function buildCatalogDocument(
  repository: DomainRepository,
): CatalogDocument | undefined {
  const manifest = repository.platform.manifest;
  if (!manifest) return undefined;
  const records: CatalogViewRecord[] = [];
  for (const [slug, project] of repository.projects) {
    records.push(
      derivedRecord({
        id: projectId(slug),
        kind: "project",
        name: project.title,
        sourcePaths: [`ui/content/projects/${slug}/index.mdx`],
        relations: [],
        decisionRefs: [],
        aliases: Array.from(repository.projectAliases)
          .filter(([, target]) => target === slug)
          .map(([alias]) => projectId(alias)),
        externalIds: [],
      }),
    );
  }
  for (const [slug, technology] of repository.technologies) {
    records.push(
      derivedRecord({
        id: `technology:${slug}` as CatalogId,
        kind: "technology",
        name: technology.name,
        sourcePaths: ["ui/content/technologies.ts"],
        relations: [],
        decisionRefs: [],
        aliases: [],
        externalIds: [],
      }),
    );
  }
  const evidenceRefs = new Set(
    manifest.selections.flatMap((selection) => selection.evidenceADRs),
  );
  for (const adrRef of repository.adrs.keys()) {
    const record = decisionRecord(repository, adrRef);
    if (record) records.push(record);
  }
  for (const adrRef of evidenceRefs) {
    const record = evidenceRecord(repository, adrRef);
    if (record) records.push(record);
  }
  records.push(...platformRecords(repository));
  records.push(
    ...manifest.catalog.records.map(
      (record): CatalogViewRecord => ({
        ...record,
        uri: catalogIdToUri(record.id),
        source: "declared",
      }),
    ),
  );
  records.sort((left, right) => left.id.localeCompare(right.id));
  validateCatalogView(records);
  return {
    schemaVersion: manifest.schemaVersion,
    source: "ui/content/projects/personal-engineering-platform/platform.yaml",
    records,
    platformManifest: manifest,
  };
}
