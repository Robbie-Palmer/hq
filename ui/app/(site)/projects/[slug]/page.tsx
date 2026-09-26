import { ExternalLink, FileText, Github, Globe, Rss } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { IdeaBadges } from "@/components/ideas/idea-badges";
import { Markdown } from "@/components/markdown";
import { Mermaid } from "@/components/mermaid";
import { ADRList } from "@/components/projects/adr-list";
import { DesignEmbed } from "@/components/projects/design-embed";
import { EmbeddedPitchDeckContent } from "@/components/projects/pitch-deck/embedded-pitch-deck-content";
import { LazyProjectPitchDeck } from "@/components/projects/pitch-deck/lazy-project-pitch-deck";
import { PlatformManifest } from "@/components/projects/platform-manifest";
import { PlatformSummary } from "@/components/projects/platform-summary";
import {
  InitiativeProjectNavigation,
  ProjectInitiativeContext,
} from "@/components/projects/project-initiative-context";
import { ProjectRoleBadge } from "@/components/projects/project-role-badge";
import { ProjectStatusBadge } from "@/components/projects/project-status-badge";
import { ProjectTabs } from "@/components/projects/project-tabs";
import { ProjectTabsSkeleton } from "@/components/projects/project-tabs-skeleton";
import { ProjectTechStack } from "@/components/projects/project-tech-stack";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { getIdeasForProject } from "@/lib/api/ideas";
import { getInitiativesForProject } from "@/lib/api/initiatives";
import {
  getAllProjectAliases,
  getAllProjectSlugs,
  getProject,
  type ProjectWithADRs,
} from "@/lib/api/projects";

const projectComponents = { DesignEmbed, Mermaid };

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  const slugs = getAllProjectSlugs();
  return [
    ...slugs.map((slug) => ({ slug })),
    ...getAllProjectAliases().map(({ alias }) => ({ slug: alias })),
  ];
}

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;
  try {
    const project = getProject(slug);
    return {
      title: `${project.title} - Projects`,
      description: project.description,
      alternates:
        project.slug === slug
          ? {
              types: {
                "application/rss+xml": [
                  {
                    url: `/projects/${project.slug}/feed.xml`,
                    title: `${project.title} RSS feed`,
                  },
                ],
              },
            }
          : {
              canonical: `/projects/${project.slug}`,
            },
    };
  } catch (_e) {
    return {
      title: "Project Not Found",
    };
  }
}

export default async function ProjectPage({ params }: Readonly<PageProps>) {
  const { slug } = await params;
  let project: ProjectWithADRs;

  try {
    project = getProject(slug);
  } catch (_e) {
    notFound();
  }

  if (project.slug !== slug) {
    const canonicalPath = `/projects/${project.slug}`;
    return (
      <>
        <meta httpEquiv="refresh" content={`0;url=${canonicalPath}`} />
        <div className="container mx-auto max-w-5xl px-4 py-12">
          <p className="text-muted-foreground">
            This project is now called {project.title}. Opening the{" "}
            <Link className="underline underline-offset-4" href={canonicalPath}>
              renamed project
            </Link>
            ...
          </p>
        </div>
      </>
    );
  }

  const initiatives = getInitiativesForProject(project.slug);
  const ideas = getIdeasForProject(project.slug);

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl">
      <nav
        aria-label="Breadcrumb"
        className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap mb-8"
      >
        <Link href="/projects" className="hover:underline underline-offset-4">
          Projects
        </Link>
        <span>/</span>
        <span>{project.title}</span>
      </nav>

      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row gap-6 justify-between items-start">
          <div className="space-y-4">
            <div className="flex items-center gap-4 flex-wrap">
              <h1 className="text-4xl md:text-5xl font-bold">
                {project.title}
              </h1>
              <ProjectStatusBadge
                status={project.status}
                className="text-sm px-3 py-1"
              />
              {project.role && (
                <ProjectRoleBadge
                  role={project.role}
                  className="text-sm px-3 py-1"
                />
              )}
            </div>

            <p className="text-xl text-muted-foreground max-w-3xl leading-relaxed">
              {project.description}
            </p>
            <ProjectInitiativeContext
              initiatives={initiatives}
              projectSlug={project.slug}
            />
            <div className="flex flex-wrap items-start gap-2 pt-2">
              <IdeaBadges ideas={ideas} />
              <ProjectTechStack
                techStack={project.technologies.map((t) => ({
                  name: t.name,
                  slug: t.slug,
                  iconSlug: t.iconSlug,
                }))}
              />
            </div>
            <PlatformSummary
              builtOn={project.builtOn ?? []}
              platformPolicies={project.platformPolicies ?? []}
              platformTechnologies={project.platformTechnologies ?? []}
            />
          </div>

          <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
            <Button
              asChild
              variant="outline"
              className="gap-2 w-full sm:w-auto"
            >
              <a
                href={`/projects/${project.slug}/feed.xml`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Subscribe to ${project.title}`}
              >
                <Rss className="w-4 h-4" />
                Subscribe
              </a>
            </Button>
            {project.repoUrl && (
              <Button
                asChild
                variant="outline"
                className="gap-2 w-full sm:w-auto"
              >
                <a
                  href={project.repoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Github className="w-4 h-4" />
                  View Source
                </a>
              </Button>
            )}
            {project.demoUrl && (
              <Button asChild className="gap-2 w-full sm:w-auto">
                <a
                  href={project.demoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="w-4 h-4" />
                  Live Demo
                </a>
              </Button>
            )}
            {project.productUrl && (
              <Button asChild className="gap-2 w-full sm:w-auto">
                <a
                  href={project.productUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Globe className="w-4 h-4" />
                  Product Page
                </a>
              </Button>
            )}
            {project.paperUrl && (
              <Button asChild className="gap-2 w-full sm:w-auto">
                <a
                  href={project.paperUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <FileText className="w-4 h-4" />
                  Read Paper
                </a>
              </Button>
            )}
          </div>
        </div>

        <Separator className="my-8" />

        {project.platformManifest && (
          <PlatformManifest manifest={project.platformManifest} />
        )}

        {/* Content Tabs */}
        {project.pitch || project.adrs.length > 0 ? (
          <Suspense fallback={<ProjectTabsSkeleton />}>
            <ProjectTabs
              projectSlug={project.slug}
              adrCount={project.adrs.length}
              pitch={
                project.pitch ? (
                  <LazyProjectPitchDeck
                    projectSlug={project.slug}
                    title={project.pitch.title}
                  >
                    <EmbeddedPitchDeckContent source={project.pitch.content} />
                  </LazyProjectPitchDeck>
                ) : undefined
              }
              overview={
                <Markdown
                  source={project.content}
                  components={projectComponents}
                />
              }
              adrs={
                <ADRList
                  projectSlug={project.slug}
                  adrs={project.adrs}
                  description={
                    <div className="prose dark:prose-invert max-w-none">
                      <p className="text-lg text-muted-foreground m-0">
                        Architecture Decision Records (ADRs) document the
                        important architectural choices made during the
                        development of this project, along with the context and
                        consequences of those decisions.
                      </p>
                    </div>
                  }
                />
              }
            />
          </Suspense>
        ) : (
          <Markdown source={project.content} components={projectComponents} />
        )}

        <InitiativeProjectNavigation
          initiatives={initiatives}
          projectSlug={project.slug}
        />
      </div>
    </div>
  );
}
