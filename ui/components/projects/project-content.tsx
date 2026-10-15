import { Suspense } from "react";
import { Markdown } from "@/components/markdown";
import { Mermaid } from "@/components/mermaid";
import { ADRList } from "@/components/projects/adr-list";
import { DesignEmbed } from "@/components/projects/design-embed";
import { EmbeddedPitchDeckContent } from "@/components/projects/pitch-deck/embedded-pitch-deck-content";
import { LazyProjectPitchDeck } from "@/components/projects/pitch-deck/lazy-project-pitch-deck";
import { ProductDecisionList } from "@/components/projects/product-decision-list";
import { ProjectTabs } from "@/components/projects/project-tabs";
import { ProjectTabsSkeleton } from "@/components/projects/project-tabs-skeleton";
import { getProductDecisionsForProject } from "@/lib/api/product-decisions";
import type { ProjectWithADRs } from "@/lib/api/projects";

const projectComponents = { DesignEmbed, Mermaid };

export function ProjectContent({
  project,
}: Readonly<{ project: ProjectWithADRs }>) {
  const decisions = getProductDecisionsForProject(project.slug);
  const overview = (
    <Markdown source={project.content} components={projectComponents} />
  );
  if (!project.pitch && project.adrs.length === 0 && decisions.length === 0)
    return overview;
  return (
    <Suspense fallback={<ProjectTabsSkeleton />}>
      <ProjectTabs
        projectSlug={project.slug}
        adrCount={project.adrs.length}
        pdrCount={decisions.length}
        pdrs={<ProductDecisionList decisions={decisions} />}
        overview={overview}
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
        adrs={<ProjectArchitectureDecisions project={project} />}
      />
    </Suspense>
  );
}

function ProjectArchitectureDecisions({
  project,
}: Readonly<{ project: ProjectWithADRs }>) {
  return (
    <ADRList
      projectSlug={project.slug}
      adrs={project.adrs}
      description={
        <div className="prose dark:prose-invert max-w-none">
          <p className="text-lg text-muted-foreground m-0">
            Architecture Decision Records (ADRs) document the important
            architectural choices made during the development of this project,
            along with the context and consequences of those decisions.
          </p>
        </div>
      }
    />
  );
}
