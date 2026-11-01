"use client";

import Link from "next/link";
import { type ReactNode, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import {
  compareUtcInstants,
  isEffectiveAt,
} from "@/lib/domain/platform/platform";
import type { ProjectWithADRsView } from "@/lib/domain/project/projectViews";

type Manifest = NonNullable<ProjectWithADRsView["platformManifest"]>;

function prerequisiteLabel(
  prerequisite: Manifest["policies"][number]["prerequisites"][number],
): string {
  if ("requirement" in prerequisite) return prerequisite.requirement;
  return prerequisite.technology
    ? `${prerequisite.slot} = ${prerequisite.technology}`
    : prerequisite.slot;
}

function adrHref(adrRef: string): string {
  const [project, adr] = adrRef.split(":");
  return `/projects/${project}/adrs/${adr}`;
}

function ManifestSection({
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
        <span className="text-lg font-semibold">{title}</span>{" "}
        <Badge variant="secondary">{count}</Badge>
        <span className="mt-1 block text-sm font-normal text-muted-foreground">
          {description}
        </span>
      </summary>
      <div className="border-t p-4 sm:p-5">{children}</div>
    </details>
  );
}

function ComponentCatalog({ manifest }: Readonly<{ manifest: Manifest }>) {
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
      <ul className="mt-4 divide-y rounded-lg border">
        {manifest.catalog.records.map((record) => (
          <li
            key={record.id}
            className="flex flex-wrap items-baseline gap-2 p-3 text-sm"
          >
            <span className="font-medium">{record.name}</span>
            <code className="break-all text-xs text-muted-foreground">
              {record.id}
            </code>
            <span className="ml-auto">
              <Badge variant="outline">{record.kind}</Badge>
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

export function PlatformManifest({
  manifest,
}: Readonly<{ manifest: Manifest }>) {
  const instant = new Date().toISOString();

  useEffect(() => {
    const revealFragment = () => {
      const targetId = window.location.hash.slice(1);
      const target = targetId ? document.getElementById(targetId) : null;
      const section = target?.closest<HTMLDetailsElement>("details");
      if (section) section.open = true;
    };

    revealFragment();
    window.addEventListener("hashchange", revealFragment);
    return () => window.removeEventListener("hashchange", revealFragment);
  }, []);

  return (
    <section className="space-y-4" aria-label="Platform manifest">
      <ManifestSection
        title="Component catalog"
        description="Repository components and their catalog IDs."
        count={`${manifest.catalog.records.length} records`}
      >
        <ComponentCatalog manifest={manifest} />
      </ManifestSection>
      <ManifestSection
        title="Current layer manifest"
        description="Active layers, activation rules, and slot policies."
        count={`${manifest.layers.length} layers`}
      >
        <div className="grid gap-4 md:grid-cols-2">
          {manifest.layers.map((layer) => {
            const policies = manifest.policies.filter(
              (policy) =>
                policy.layer === layer.slug && isEffectiveAt(policy, instant),
            );
            return (
              <article
                key={layer.slug}
                id={`layer-${layer.slug}`}
                className="rounded-lg border p-4"
              >
                <h3 className="font-semibold">{layer.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {layer.description}
                </p>
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
                {policies.length > 0 && (
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
                        {policy.prerequisites.length > 0 && (
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
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            );
          })}
        </div>
      </ManifestSection>

      <ManifestSection
        title="Default history"
        description="Selections, decision history, adopters, and overrides."
        count={`${manifest.slots.length} slots`}
      >
        <div className="space-y-4">
          {manifest.slots.map((slot) => (
            <article
              key={slot.slug}
              id={`slot-${slot.slug}`}
              className="rounded-lg border p-4"
            >
              <h3 className="font-semibold">{slot.title}</h3>
              <div className="mt-1 flex gap-1.5">
                <Badge variant="outline">{slot.kind}</Badge>
                {slot.cardinality === "many" && (
                  <Badge variant="outline">multiple</Badge>
                )}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {slot.description}
              </p>
              <ol className="mt-3 space-y-2 text-sm">
                {slot.selections
                  .toSorted((left, right) =>
                    compareUtcInstants(right.effectiveFrom, left.effectiveFrom),
                  )
                  .map((selection) => (
                    <li key={selection.id}>
                      {selection.kind === "technology" ? (
                        <Link
                          href={`/technologies/${selection.technology}`}
                          className="font-medium underline underline-offset-4"
                        >
                          {selection.technology}
                        </Link>
                      ) : (
                        <span className="font-medium">{selection.value}</span>
                      )}{" "}
                      <Badge variant="secondary">
                        {selection.lifecycleStatus}
                      </Badge>{" "}
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
                      {selection.originProjects.length > 0 && (
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
                              {index < selection.originProjects.length - 1
                                ? ", "
                                : ""}
                            </span>
                          ))}
                        </span>
                      )}
                      <span className="text-muted-foreground">
                        {" with evidence "}
                        {selection.evidenceADRs.map((adrRef, index) => (
                          <span key={adrRef}>
                            <Link
                              href={adrHref(adrRef)}
                              className="underline underline-offset-4"
                            >
                              {adrRef}
                            </Link>
                            {index < selection.evidenceADRs.length - 1
                              ? ", "
                              : ""}
                          </span>
                        ))}
                      </span>
                    </li>
                  ))}
              </ol>
              {(slot.adopters.length > 0 ||
                slot.layerConsumers.length > 0 ||
                slot.overrides.length > 0) && (
                <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                  {slot.adopters.length > 0 && (
                    <p>
                      Adopters:{" "}
                      {slot.adopters.map((project, index) => (
                        <span key={project}>
                          <Link
                            href={`/projects/${project}`}
                            className="underline underline-offset-4"
                          >
                            {project}
                          </Link>
                          {index < slot.adopters.length - 1 ? ", " : "."}
                        </span>
                      ))}
                    </p>
                  )}
                  {slot.layerConsumers.length > 0 && (
                    <p>
                      Layer consumers:{" "}
                      {slot.layerConsumers.map((project, index) => (
                        <span key={project}>
                          <Link
                            href={`/projects/${project}`}
                            className="underline underline-offset-4"
                          >
                            {project}
                          </Link>
                          {index < slot.layerConsumers.length - 1 ? ", " : "."}
                        </span>
                      ))}
                    </p>
                  )}
                  {slot.overrides.length > 0 && (
                    <p>
                      Overrides:{" "}
                      {slot.overrides.map((override, index) => {
                        const [project, adr] = override.split(":");
                        return (
                          <span key={override}>
                            <Link
                              href={`/projects/${project}/adrs/${adr}`}
                              className="underline underline-offset-4"
                            >
                              {override}
                            </Link>
                            {index < slot.overrides.length - 1 ? ", " : "."}
                          </span>
                        );
                      })}
                    </p>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
      </ManifestSection>
    </section>
  );
}
