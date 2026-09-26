import { Calendar } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { IdeaBadges } from "@/components/ideas/idea-badges";
import { Markdown } from "@/components/markdown";
import { Mermaid } from "@/components/mermaid";
import { ADRBadge } from "@/components/projects/adr-badge";
import { ADRPagination } from "@/components/projects/adr-pagination";
import { EmblaDemoCarousel } from "@/components/technology/embla-demo-carousel";
import { KnowledgeGraph } from "@/components/technology/knowledge-graph";
import { LazyRechartsDemoChart } from "@/components/technology/lazy-recharts-demo-chart";
import { MermaidDemo } from "@/components/technology/mermaid-demo";
import { ShikiDemo } from "@/components/technology/shiki-demo";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { getIdeasForADR } from "@/lib/api/ideas";
import {
  type ADRDetailView,
  getAllLegacyADRPaths,
  getAllProjectAliasADRPaths,
  getAllProjects,
  getProject,
  getProjectADR,
  type ProjectWithADRs,
} from "@/lib/api/projects";
import { hasTechIcon, TechIcon } from "@/lib/api/tech-icons";
import {
  formatADRSlugIndex,
  normalizeADRTitle,
  parseADRRef,
} from "@/lib/domain/adr/adr";

const adrComponents = {
  EmblaDemoCarousel,
  KnowledgeGraph,
  Mermaid,
  MermaidDemo,
  RechartsDemoChart: LazyRechartsDemoChart,
  ShikiDemo,
};

// Responsive behavior for the pagination container:
// Goal: On desktop, keep buttons on the same row as metadata, shifted right.
// If forced to a new row (e.g. by nav bar layout shifts), fill the row (flex-grow) rather than leaving whitespace.
// - Default (Mobile) & lg (Desktop): Full width, flex-grow. (Fills row when layout is constrained/buttons wrap).
// - md (Tablet) & xl (Wide): Auto width, ml-auto. (Sits inline with metadata).
const PAGINATION_CONTAINER_CLASSES =
  "w-full flex-grow min-w-[200px] md:w-auto md:flex-grow-0 md:ml-auto lg:w-full lg:flex-grow lg:ml-0 xl:w-auto xl:flex-grow-0 xl:ml-auto";

interface PageProps {
  params: Promise<{ slug: string; adrSlug: string }>;
}

export async function generateStaticParams() {
  const projects = getAllProjects();
  const projectADRs = projects.flatMap((project) =>
    project.adrs.map((adr) => ({
      slug: project.slug,
      adrSlug: adr.slug,
    })),
  );
  const projectAliasADRs = getAllProjectAliasADRPaths().map(
    ({ alias, adrSlug }) => ({ slug: alias, adrSlug }),
  );
  return [
    ...projectADRs,
    ...projectAliasADRs,
    ...getAllLegacyADRPaths().map(({ projectSlug, adrSlug }) => ({
      slug: projectSlug,
      adrSlug,
    })),
  ];
}

export async function generateMetadata({ params }: PageProps) {
  const { slug, adrSlug } = await params;
  try {
    const project = getProject(slug);
    const adr = getProjectADR(slug, adrSlug);
    const canonicalPath = `/projects/${adr.projectSlug}/adrs/${adr.slug}`;
    return {
      title: `${adr.title} - ${project.title} - ADR`,
      description: `Architecture Decision Record for ${project.title}: ${adr.title}`,
      alternates:
        adr.projectSlug === slug ? undefined : { canonical: canonicalPath },
    };
  } catch (_e) {
    return {
      title: "ADR Not Found",
    };
  }
}

export default async function ADRPage({ params }: Readonly<PageProps>) {
  const { slug, adrSlug } = await params;
  let project: ProjectWithADRs;
  let adr: ADRDetailView;

  try {
    project = getProject(slug);
    adr = getProjectADR(slug, adrSlug);
  } catch (_e) {
    notFound();
  }

  // Find ADRs that supersede this one (automatic backlinks)
  const supersededAdrs = project.adrs.filter(
    (a) => a.supersedes === adr.adrRef,
  );

  const currentIndex = project.adrs.findIndex((a) => a.adrRef === adr.adrRef);
  const prevAdr = currentIndex > 0 ? project.adrs[currentIndex - 1] : undefined;
  const nextAdr =
    currentIndex >= 0 && currentIndex < project.adrs.length - 1
      ? project.adrs[currentIndex + 1]
      : undefined;
  const displayIndex = formatADRSlugIndex(adrSlug);
  const displayTitle = normalizeADRTitle(adr.title);
  const ideas = getIdeasForADR(adr.adrRef);
  const supersedesRef = adr.supersedes ? parseADRRef(adr.supersedes) : null;
  const adrContent = (() => {
    if (!adr.isInherited) {
      return <Markdown source={adr.content} components={adrComponents} />;
    }
    if (!adr.inheritedProjectNotes) {
      return (
        <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
          No project-specific notes have been added for this inherited ADR.
        </div>
      );
    }
    return (
      <div className="space-y-3">
        <h2 className="text-xl font-semibold">Project Notes</h2>
        <Markdown
          source={adr.inheritedProjectNotes}
          components={adrComponents}
        />
      </div>
    );
  })();

  return (
    <div className="max-w-4xl">
      <div className="space-y-6">
        {/* Header */}
        <div className="space-y-4">
          <nav
            aria-label="Breadcrumb"
            className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap"
          >
            <Link
              href="/projects"
              className="hover:underline underline-offset-4"
            >
              Projects
            </Link>
            <span>/</span>
            <Link
              href={`/projects/${slug}?tab=adrs`}
              className="hover:underline underline-offset-4"
            >
              {project.title}
            </Link>
            <span>/</span>
            <span>Architecture Decisions</span>
          </nav>

          <h1 className="text-3xl md:text-4xl font-bold">
            ADR {displayIndex}: {displayTitle}
          </h1>

          <div className="flex flex-wrap items-center gap-4">
            <IdeaBadges ideas={ideas} />

            {adr.technologies && adr.technologies.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {adr.technologies.map((tech) => (
                  <Link
                    key={tech.slug}
                    href={`/technologies/${tech.slug}`}
                    aria-label={`View ${tech.name} technology`}
                  >
                    <Badge
                      variant="secondary"
                      interactive
                      className="flex items-center gap-1.5"
                    >
                      {hasTechIcon(tech.name) && (
                        <TechIcon name={tech.name} className="w-3 h-3" />
                      )}
                      <span>{tech.name}</span>
                    </Badge>
                  </Link>
                ))}
              </div>
            )}

            <ADRBadge status={adr.status} className="px-3 py-1" />

            <div className="flex items-center gap-1.5 text-muted-foreground text-sm">
              <Calendar className="w-4 h-4" />
              {adr.date}
            </div>

            <ADRPagination
              projectSlug={slug}
              prevAdr={prevAdr}
              nextAdr={nextAdr}
              compact
              className={PAGINATION_CONTAINER_CLASSES}
            />
          </div>

          {adr.projectSlug !== slug && (
            <div className="rounded-lg border border-sky-200 bg-sky-50 p-4 dark:border-sky-900 dark:bg-sky-950/30">
              <p className="text-sm text-sky-900 dark:text-sky-100">
                This legacy URL now resolves to{" "}
                <Link
                  href={`/projects/${adr.projectSlug}/adrs/${adr.slug}`}
                  className="font-semibold underline underline-offset-4"
                >
                  the canonical ADR
                </Link>
                .
              </p>
            </div>
          )}

          {adr.isInherited && (
            <div className="bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-900 rounded-lg p-4">
              <p className="text-sm text-sky-900 dark:text-sky-100">
                This ADR is inherited from{" "}
                <span className="font-semibold">{adr.originProjectSlug}</span>.{" "}
                <Link
                  href={`/projects/${adr.originProjectSlug}/adrs/${adr.originAdrSlug}`}
                  className="font-semibold underline underline-offset-4 hover:text-sky-700 dark:hover:text-sky-300"
                >
                  Read the canonical source ADR
                </Link>
                .
              </p>
              {adr.inheritedSourceSummary && (
                <p className="text-sm text-sky-900 dark:text-sky-100 mt-2">
                  <span className="font-semibold">Source summary:</span>{" "}
                  {adr.inheritedSourceSummary}
                </p>
              )}
            </div>
          )}

          {adr.supersedes && (
            <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 rounded-lg p-4">
              <p className="text-sm text-blue-900 dark:text-blue-100">
                This decision supersedes{" "}
                <Link
                  href={`/projects/${supersedesRef?.projectSlug}/adrs/${supersedesRef?.adrSlug}`}
                  className="font-semibold underline underline-offset-4 hover:text-blue-700 dark:hover:text-blue-300"
                >
                  {project.adrs.find((a) => a.adrRef === adr.supersedes)
                    ?.title || adr.supersedes}
                </Link>
              </p>
            </div>
          )}

          {supersededAdrs.length > 0 && (
            <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-lg p-4">
              <p className="text-sm text-amber-900 dark:text-amber-100">
                This decision is superseded by:{" "}
                {supersededAdrs.map((superseded, index) => (
                  <span key={superseded.slug}>
                    <Link
                      href={`/projects/${slug}/adrs/${superseded.slug}`}
                      className="font-semibold underline underline-offset-4 hover:text-amber-700 dark:hover:text-amber-300"
                    >
                      {superseded.title}
                    </Link>
                    {index < supersededAdrs.length - 1 && ", "}
                  </span>
                ))}
              </p>
            </div>
          )}
        </div>

        <Separator className="my-8" />

        {adrContent}
      </div>
    </div>
  );
}
