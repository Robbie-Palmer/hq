import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { hasTechIcon, TechIcon } from "@/lib/api/tech-icons";
import type { ProjectWithADRsView } from "@/lib/domain/project/projectViews";

type PlatformSummaryProps = Pick<
  ProjectWithADRsView,
  "builtOn" | "platformPolicies" | "platformTechnologies"
>;

function adrHref(adrRef: string): string {
  const [project, adr] = adrRef.split(":");
  return `/projects/${project}/adrs/${adr}`;
}

function ADRLink({
  adrRef,
  label,
}: Readonly<{ adrRef: string; label: string }>) {
  return (
    <Link href={adrHref(adrRef)} className="underline underline-offset-4">
      {label}
    </Link>
  );
}

function AdoptionProvenance({
  decision,
  rationale,
}: Readonly<{ decision?: string; rationale?: string }>) {
  if (decision) {
    return (
      <>
        {", "}
        <ADRLink adrRef={decision} label="adoption" />
      </>
    );
  }
  if (rationale) return <>{`, adoption: ${rationale}`}</>;
  return null;
}

export function PlatformSummary({
  builtOn = [],
  platformPolicies = [],
  platformTechnologies = [],
}: Readonly<PlatformSummaryProps>) {
  if (builtOn.length === 0) return null;
  return (
    <section className="text-xs text-muted-foreground" aria-label="Platform">
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <span>Built on</span>
        {builtOn.map((layer, index) => (
          <span key={layer.slug}>
            <Link
              href={`/projects/personal-engineering-platform#layer-${layer.slug}`}
              className="text-foreground/80 underline-offset-4 hover:text-foreground hover:underline"
            >
              {layer.title}
            </Link>
            {index < builtOn.length - 1 ? "," : ""}
          </span>
        ))}
      </div>
      <details className="mt-1 w-fit">
        <summary className="cursor-pointer hover:text-foreground">
          Adoption provenance
        </summary>
        <ul className="mt-1.5 space-y-1 pl-4">
          {builtOn.map((layer) => (
            <li key={layer.slug}>
              <Link
                href={`/projects/personal-engineering-platform#layer-${layer.slug}`}
                className="text-foreground/80 underline underline-offset-4"
              >
                {layer.title}
              </Link>
              {layer.decision ? (
                <>
                  {": "}
                  <ADRLink adrRef={layer.decision} label="adoption decision" />
                </>
              ) : (
                `: ${layer.rationale}`
              )}
            </li>
          ))}
        </ul>
      </details>
      {platformTechnologies.length > 0 && (
        <details className="mt-1 w-fit">
          <summary className="cursor-pointer hover:text-foreground">
            {platformTechnologies.length} platform technologies
          </summary>
          <ul className="mt-1.5 space-y-1.5">
            {platformTechnologies.map((technology) => {
              const hasIcon = hasTechIcon(technology.name, technology.iconSlug);
              return (
                <li key={`${technology.slot}:${technology.slug}`}>
                  <Link href={`/technologies/${technology.slug}`}>
                    <Badge
                      variant="secondary"
                      interactive
                      className="h-6 gap-1 px-2 text-xs"
                    >
                      {hasIcon && (
                        <TechIcon
                          name={technology.name}
                          iconSlug={technology.iconSlug}
                          className="size-3"
                        />
                      )}
                      {technology.name}
                      <span className="sr-only">
                        {` from ${technology.layer}, ${technology.source}`}
                      </span>
                    </Badge>
                  </Link>{" "}
                  <span>
                    via {technology.slot}
                    <AdoptionProvenance
                      decision={technology.adoptionDecision}
                      rationale={technology.adoptionRationale}
                    />
                    {technology.policyDecision && (
                      <>
                        {", "}
                        <ADRLink
                          adrRef={technology.policyDecision}
                          label="policy"
                        />
                      </>
                    )}
                    {technology.decision && (
                      <>
                        {", "}
                        <ADRLink adrRef={technology.decision} label="default" />
                      </>
                    )}
                    {(technology.evidenceADRs?.length ?? 0) > 0 && (
                      <>
                        {", evidence "}
                        {technology.evidenceADRs?.map((adrRef, index) => (
                          <span key={adrRef}>
                            <ADRLink adrRef={adrRef} label={adrRef} />
                            {index < (technology.evidenceADRs?.length ?? 0) - 1
                              ? ", "
                              : ""}
                          </span>
                        ))}
                      </>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </details>
      )}
      {platformPolicies.length > 0 && (
        <details className="mt-1 w-fit">
          <summary className="cursor-pointer hover:text-foreground">
            {platformPolicies.length} platform policies
          </summary>
          <ul className="mt-1.5 space-y-1.5">
            {platformPolicies.map((policy) => (
              <li key={`${policy.slot}:${policy.value}`}>
                <Link
                  href={`/projects/personal-engineering-platform#slot-${policy.slot}`}
                >
                  <Badge
                    variant="outline"
                    interactive
                    className="h-6 px-2 text-xs"
                  >
                    {policy.value}
                    <span className="sr-only">
                      {` from ${policy.layer}, ${policy.source}`}
                    </span>
                  </Badge>
                </Link>{" "}
                <span>
                  via {policy.slot}
                  <AdoptionProvenance
                    decision={policy.adoptionDecision}
                    rationale={policy.adoptionRationale}
                  />
                  {policy.policyDecision && (
                    <>
                      {", "}
                      <ADRLink adrRef={policy.policyDecision} label="policy" />
                    </>
                  )}
                  {policy.decision && (
                    <>
                      {", "}
                      <ADRLink adrRef={policy.decision} label="default" />
                    </>
                  )}
                  {(policy.evidenceADRs?.length ?? 0) > 0 && (
                    <>
                      {", evidence "}
                      {policy.evidenceADRs?.map((adrRef, index) => (
                        <span key={adrRef}>
                          <ADRLink adrRef={adrRef} label={adrRef} />
                          {index < (policy.evidenceADRs?.length ?? 0) - 1
                            ? ", "
                            : ""}
                        </span>
                      ))}
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
