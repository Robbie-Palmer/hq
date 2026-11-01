import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import {
  compareUtcInstants,
  isEffectiveAt,
} from "@/lib/domain/platform/platform";
import type { ProjectWithADRsView } from "@/lib/domain/project/projectViews";

export type PlatformManifestView = NonNullable<
  ProjectWithADRsView["platformManifest"]
>;

type Layer = PlatformManifestView["layers"][number];
type Policy = PlatformManifestView["policies"][number];
type Prerequisite = Policy["prerequisites"][number];
type Slot = PlatformManifestView["slots"][number];
type Selection = Slot["selections"][number];
type CatalogRecord = PlatformManifestView["catalog"]["records"][number];

const CATALOG_KIND_ORDER: CatalogRecord["kind"][] = [
  "project",
  "system",
  "component",
  "api",
  "workload",
  "resource",
  "capability",
  "slot",
  "technology",
  "package",
  "artifact",
  "environment",
  "decision",
  "evidence",
  "adoption",
  "override",
];

type CatalogKindGroup = {
  kind: CatalogRecord["kind"];
  records: CatalogRecord[];
};

type CatalogProjectGroup = {
  project?: string;
  records: CatalogRecord[];
  kinds: CatalogKindGroup[];
};

function prerequisiteLabel(prerequisite: Prerequisite): string {
  if ("requirement" in prerequisite) return prerequisite.requirement;
  return prerequisite.technology
    ? `${prerequisite.slot} = ${prerequisite.technology}`
    : prerequisite.slot;
}

function adrHref(adrRef: string): string {
  const [project, adr] = adrRef.split(":");
  return `/projects/${project}/adrs/${adr}`;
}

function groupCatalogKinds(records: CatalogRecord[]): CatalogKindGroup[] {
  const groups = new Map<CatalogRecord["kind"], CatalogRecord[]>();
  for (const record of records) {
    const kindRecords = groups.get(record.kind) ?? [];
    kindRecords.push(record);
    groups.set(record.kind, kindRecords);
  }
  return CATALOG_KIND_ORDER.flatMap((kind) => {
    const kindRecords = groups.get(kind);
    if (!kindRecords) return [];
    return [
      {
        kind,
        records: kindRecords.toSorted(
          (left, right) =>
            left.name.localeCompare(right.name) ||
            left.id.localeCompare(right.id),
        ),
      },
    ];
  });
}

function groupCatalogProjects(records: CatalogRecord[]): CatalogProjectGroup[] {
  const groups = new Map<string, CatalogRecord[]>();
  for (const record of records) {
    const project = record.project ?? "";
    const projectRecords = groups.get(project) ?? [];
    projectRecords.push(record);
    groups.set(project, projectRecords);
  }
  return Array.from(groups, ([project, projectRecords]) => ({
    project: project || undefined,
    records: projectRecords,
    kinds: groupCatalogKinds(projectRecords),
  }));
}

export function ManifestSection({
  title,
  description,
  count,
  children,
}: Readonly<{
  title: string;
  description: string;
  count: string;
  children: ReactNode;
}>) {
  return (
    <details className="overflow-hidden rounded-lg border" aria-label={title}>
      <summary className="cursor-pointer p-4 marker:text-muted-foreground sm:p-5">
        <h2 className="inline text-lg font-semibold">{title}</h2>{" "}
        <Badge variant="secondary">{count}</Badge>
        <span className="mt-1 block text-sm font-normal text-muted-foreground">
          {description}
        </span>
      </summary>
      <div className="border-t p-4 sm:p-5">{children}</div>
    </details>
  );
}

function CatalogRecordList({
  records,
}: Readonly<{ records: CatalogRecord[] }>) {
  return (
    <ul className="mt-2 divide-y rounded-md border">
      {records.map((record) => (
        <li
          key={record.id}
          className="flex flex-wrap items-baseline gap-2 p-3 text-sm"
        >
          <span className="font-medium">{record.name}</span>
          <code className="break-all text-xs text-muted-foreground">
            {record.id}
          </code>
        </li>
      ))}
    </ul>
  );
}

function CatalogKindSection({ group }: Readonly<{ group: CatalogKindGroup }>) {
  return (
    <section aria-label={`${group.kind} records`}>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {group.kind} <Badge variant="outline">{group.records.length}</Badge>
      </h4>
      <CatalogRecordList records={group.records} />
    </section>
  );
}

function CatalogProjectSection({
  group,
}: Readonly<{ group: CatalogProjectGroup }>) {
  const projectSlug = group.project?.slice("project:".length);
  const label = projectSlug ?? "Shared catalog";
  return (
    <section
      aria-label={`${label} catalog records`}
      className="rounded-lg border p-4"
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="font-semibold">
          {projectSlug ? (
            <Link
              href={`/projects/${projectSlug}`}
              className="underline underline-offset-4"
            >
              {projectSlug}
            </Link>
          ) : (
            label
          )}
        </h3>
        <Badge variant="secondary">{group.records.length} records</Badge>
      </div>
      <div className="mt-4 space-y-4">
        {group.kinds.map((kindGroup) => (
          <CatalogKindSection key={kindGroup.kind} group={kindGroup} />
        ))}
      </div>
    </section>
  );
}

export function ComponentCatalog({
  manifest,
}: Readonly<{ manifest: PlatformManifestView }>) {
  const projectGroups = groupCatalogProjects(manifest.catalog.records);
  return (
    <>
      <p className="text-sm text-muted-foreground">
        Schema version {manifest.schemaVersion}. Repository declarations are
        authoritative; projects, technologies, decisions, and policy records
        join these declarations in the derived{" "}
        <Link href="/catalog.json" className="underline underline-offset-4">
          machine-readable catalog
        </Link>
        .
      </p>
      <div className="mt-4 space-y-4">
        {projectGroups.map((group) => (
          <CatalogProjectSection
            key={group.project ?? "shared"}
            group={group}
          />
        ))}
      </div>
    </>
  );
}

function PolicyPrerequisites({ policy }: Readonly<{ policy: Policy }>) {
  if (policy.prerequisites.length === 0) return null;
  return (
    <ul
      aria-label={`${policy.slot} prerequisites`}
      className="ml-5 mt-1 list-disc text-xs text-muted-foreground"
    >
      {policy.prerequisites.map((prerequisite) => (
        <li key={prerequisiteLabel(prerequisite)}>
          {prerequisiteLabel(prerequisite)}
        </li>
      ))}
    </ul>
  );
}

function LayerPolicies({ policies }: Readonly<{ policies: Policy[] }>) {
  if (policies.length === 0) return null;
  return (
    <ul className="mt-3 space-y-1 text-sm">
      {policies.map((policy) => (
        <li key={policy.id}>
          <div>
            <Link
              href={`#slot-${policy.slot}`}
              className="underline underline-offset-4"
            >
              {policy.slot}
            </Link>{" "}
            <Badge variant="outline">{policy.mode}</Badge>
          </div>
          <PolicyPrerequisites policy={policy} />
        </li>
      ))}
    </ul>
  );
}

function PlatformLayerCard({
  layer,
  policies,
}: Readonly<{ layer: Layer; policies: Policy[] }>) {
  return (
    <article id={`layer-${layer.slug}`} className="rounded-lg border p-4">
      <h3 className="font-semibold">{layer.title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{layer.description}</p>
      {layer.activatedBy && (
        <p className="mt-2 text-sm text-muted-foreground">
          Activated when{" "}
          <Link
            href={`#slot-${layer.activatedBy.slot}`}
            className="underline underline-offset-4"
          >
            {layer.activatedBy.slot}
          </Link>{" "}
          resolves to{" "}
          <Link
            href={`/technologies/${layer.activatedBy.technology}`}
            className="underline underline-offset-4"
          >
            {layer.activatedBy.technology}
          </Link>
          .
        </p>
      )}
      <LayerPolicies policies={policies} />
    </article>
  );
}

export function CurrentLayerManifest({
  manifest,
  instant,
}: Readonly<{ manifest: PlatformManifestView; instant: string }>) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {manifest.layers.map((layer) => (
        <PlatformLayerCard
          key={layer.slug}
          layer={layer}
          policies={manifest.policies.filter(
            (policy) =>
              policy.layer === layer.slug && isEffectiveAt(policy, instant),
          )}
        />
      ))}
    </div>
  );
}

function SelectionValue({ selection }: Readonly<{ selection: Selection }>) {
  if (selection.kind === "technology") {
    return (
      <Link
        href={`/technologies/${selection.technology}`}
        className="font-medium underline underline-offset-4"
      >
        {selection.technology}
      </Link>
    );
  }
  return <span className="font-medium">{selection.value}</span>;
}

function SelectionOrigins({ selection }: Readonly<{ selection: Selection }>) {
  if (selection.originProjects.length === 0) return null;
  return (
    <span className="text-muted-foreground">
      {" originated in "}
      {selection.originProjects.map((project, index) => (
        <span key={project}>
          <Link
            href={`/projects/${project}`}
            className="underline underline-offset-4"
          >
            {project}
          </Link>
          {index < selection.originProjects.length - 1 ? ", " : ""}
        </span>
      ))}
    </span>
  );
}

function SelectionEvidence({ selection }: Readonly<{ selection: Selection }>) {
  return (
    <span className="text-muted-foreground">
      {" with evidence "}
      {selection.evidenceADRs.map((adrRef, index) => (
        <span key={adrRef}>
          <Link href={adrHref(adrRef)} className="underline underline-offset-4">
            {adrRef}
          </Link>
          {index < selection.evidenceADRs.length - 1 ? ", " : ""}
        </span>
      ))}
    </span>
  );
}

function DefaultSelectionRow({
  selection,
}: Readonly<{ selection: Selection }>) {
  return (
    <li>
      <SelectionValue selection={selection} />{" "}
      <Badge variant="secondary">{selection.lifecycleStatus}</Badge>{" "}
      <span className="text-muted-foreground">
        {selection.effectiveFrom}
        {selection.effectiveUntil
          ? ` to ${selection.effectiveUntil}`
          : " to present"}
      </span>{" "}
      <Link
        href={adrHref(selection.decision)}
        className="underline underline-offset-4"
      >
        decision
      </Link>
      <SelectionOrigins selection={selection} />
      <SelectionEvidence selection={selection} />
    </li>
  );
}

function DefaultSelectionHistory({ slot }: Readonly<{ slot: Slot }>) {
  return (
    <ol className="mt-3 space-y-2 text-sm">
      {slot.selections
        .toSorted((left, right) =>
          compareUtcInstants(right.effectiveFrom, left.effectiveFrom),
        )
        .map((selection) => (
          <DefaultSelectionRow key={selection.id} selection={selection} />
        ))}
    </ol>
  );
}

function ProjectLinks({
  label,
  projects,
}: Readonly<{ label: string; projects: string[] }>) {
  if (projects.length === 0) return null;
  return (
    <p>
      {label}:{" "}
      {projects.map((project, index) => (
        <span key={project}>
          <Link
            href={`/projects/${project}`}
            className="underline underline-offset-4"
          >
            {project}
          </Link>
          {index < projects.length - 1 ? ", " : "."}
        </span>
      ))}
    </p>
  );
}

function OverrideLinks({ overrides }: Readonly<{ overrides: string[] }>) {
  if (overrides.length === 0) return null;
  return (
    <p>
      Overrides:{" "}
      {overrides.map((override, index) => (
        <span key={override}>
          <Link
            href={adrHref(override)}
            className="underline underline-offset-4"
          >
            {override}
          </Link>
          {index < overrides.length - 1 ? ", " : "."}
        </span>
      ))}
    </p>
  );
}

function DefaultSlotUsage({ slot }: Readonly<{ slot: Slot }>) {
  const hasUsage =
    slot.adopters.length > 0 ||
    slot.layerConsumers.length > 0 ||
    slot.overrides.length > 0;
  if (!hasUsage) return null;
  return (
    <div className="mt-3 space-y-1 text-xs text-muted-foreground">
      <ProjectLinks label="Adopters" projects={slot.adopters} />
      <ProjectLinks label="Layer consumers" projects={slot.layerConsumers} />
      <OverrideLinks overrides={slot.overrides} />
    </div>
  );
}

function DefaultSlotCard({ slot }: Readonly<{ slot: Slot }>) {
  return (
    <article id={`slot-${slot.slug}`} className="rounded-lg border p-4">
      <h3 className="font-semibold">{slot.title}</h3>
      <div className="mt-1 flex gap-1.5">
        <Badge variant="outline">{slot.kind}</Badge>
        {slot.cardinality === "many" && (
          <Badge variant="outline">multiple</Badge>
        )}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{slot.description}</p>
      <DefaultSelectionHistory slot={slot} />
      <DefaultSlotUsage slot={slot} />
    </article>
  );
}

export function DefaultHistory({ slots }: Readonly<{ slots: Slot[] }>) {
  return (
    <div className="space-y-4">
      {slots.map((slot) => (
        <DefaultSlotCard key={slot.slug} slot={slot} />
      ))}
    </div>
  );
}
