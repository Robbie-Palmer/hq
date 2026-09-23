import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  compareUtcInstants,
  isEffectiveAt,
} from "@/lib/domain/platform/platform";
import type { ProjectWithADRsView } from "@/lib/domain/project/projectViews";

type Manifest = NonNullable<ProjectWithADRsView["platformManifest"]>;

function adrHref(adrRef: string): string {
  const [project, adr] = adrRef.split(":");
  return `/projects/${project}/adrs/${adr}`;
}

export function PlatformManifest({
  manifest,
}: Readonly<{ manifest: Manifest }>) {
  const instant = new Date().toISOString();
  return (
    <section className="space-y-8" aria-labelledby="platform-manifest-heading">
      <div>
        <h2 id="platform-manifest-heading" className="text-2xl font-semibold">
          Current layer manifest
        </h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
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
                        <Link
                          href={`#slot-${policy.slot}`}
                          className="underline underline-offset-4"
                        >
                          {policy.slot}
                        </Link>{" "}
                        <Badge variant="outline">{policy.mode}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            );
          })}
        </div>
      </div>

      <div>
        <h2 className="text-2xl font-semibold">Default history</h2>
        <div className="mt-4 space-y-4">
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
      </div>
    </section>
  );
}
