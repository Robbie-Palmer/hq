import {
  Blocks,
  ExternalLink,
  FileCheck2,
  FileText,
  FolderKanban,
  GitBranch,
  Goal,
  type LucideIcon,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { IdeaBadges } from "@/components/ideas/idea-badges";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getAllIdeaSlugs, getIdea } from "@/lib/api/ideas";
import { siteConfig } from "@/lib/config/site-config";
import { productDecisionPath } from "@/lib/domain/product-decision";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return getAllIdeaSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const idea = getIdea(slug);
  if (!idea) return { title: "Idea Not Found" };
  const url = `${siteConfig.url}/ideas/${slug}`;
  return {
    title: `${idea.title} - Ideas`,
    description: idea.description,
    alternates: { canonical: url },
    openGraph: { title: idea.title, description: idea.description, url },
  };
}

function RelatedCard({
  href,
  title,
  description,
}: Readonly<{ href: string; title: string; description: string }>) {
  return (
    <Link href={href} className="h-full">
      <Card className="h-full transition-colors hover:border-primary/50">
        <CardHeader className="gap-1">
          <CardTitle className="text-base">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
      </Card>
    </Link>
  );
}

type Idea = NonNullable<ReturnType<typeof getIdea>>;

interface ReferenceGroupData {
  title: string;
  icon: LucideIcon;
  references: Array<{
    key: string;
    href: string;
    title: string;
    description: string;
  }>;
}

function buildReferenceGroups(idea: Idea): ReferenceGroupData[] {
  return [
    {
      title: "Technologies",
      icon: Blocks,
      references: idea.relatedContent.technologies.map((technology) => ({
        key: technology.slug,
        href: `/technologies/${technology.slug}`,
        title: technology.name,
        description: technology.description ?? technology.website,
      })),
    },
    {
      title: "Projects",
      icon: FolderKanban,
      references: idea.relatedContent.projects.map((project) => ({
        key: project.slug,
        href: `/projects/${project.slug}`,
        title: project.title,
        description: project.status.replace("_", " "),
      })),
    },
    {
      title: "Initiatives",
      icon: Goal,
      references: idea.relatedContent.initiatives.map((initiative) => ({
        key: initiative.slug,
        href: `/initiatives/${initiative.slug}`,
        title: initiative.title,
        description: initiative.status,
      })),
    },
    {
      title: "Blog posts",
      icon: FileText,
      references: idea.relatedContent.blogs.map((blog) => ({
        key: blog.slug,
        href: `/blog/${blog.slug}`,
        title: blog.title,
        description: `${blog.date} · ${blog.readingTime}`,
      })),
    },
    {
      title: "Architecture decisions",
      icon: GitBranch,
      references: idea.relatedContent.adrs.map((adr) => ({
        key: `${adr.projectSlug}:${adr.slug}`,
        href: `/projects/${adr.projectSlug}/adrs/${adr.slug}`,
        title: adr.title,
        description: adr.status,
      })),
    },
    {
      title: "Product decisions",
      icon: FileCheck2,
      references: (idea.relatedContent.productDecisions ?? []).map(
        (decision) => ({
          key: decision.pdrRef,
          href: productDecisionPath(decision.pdrRef),
          title: decision.title,
          description: decision.status,
        }),
      ),
    },
  ];
}

function ReferenceGroup({ group }: Readonly<{ group: ReferenceGroupData }>) {
  const Icon = group.icon;
  return (
    <div className="space-y-3">
      <h3 className="flex items-center gap-2 text-lg font-medium">
        <Icon className="size-5" /> {group.title}
      </h3>
      <div className="grid gap-3 md:grid-cols-2">
        {group.references.map((reference) => (
          <RelatedCard
            key={reference.key}
            href={reference.href}
            title={reference.title}
            description={reference.description}
          />
        ))}
      </div>
    </div>
  );
}

function IdeaReferences({
  groups,
}: Readonly<{ groups: ReferenceGroupData[] }>) {
  const populatedGroups = groups.filter((group) => group.references.length > 0);
  if (populatedGroups.length === 0) {
    return (
      <p className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
        This idea has no related references yet.
      </p>
    );
  }
  return (
    <section className="space-y-6" aria-labelledby="idea-references">
      <h2 id="idea-references" className="text-2xl font-semibold">
        Where it appears
      </h2>
      {populatedGroups.map((group) => (
        <ReferenceGroup key={group.title} group={group} />
      ))}
    </section>
  );
}

function IdeaBreadcrumb({ title }: Readonly<{ title: string }>) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="mb-8 flex items-center gap-2 text-sm text-muted-foreground"
    >
      <Link href="/ideas" className="hover:underline hover:underline-offset-4">
        Ideas
      </Link>
      <span>/</span>
      <span>{title}</span>
    </nav>
  );
}

export default async function IdeaPage({ params }: Readonly<PageProps>) {
  const { slug } = await params;
  const idea = getIdea(slug);
  if (!idea) notFound();
  const referenceGroups = buildReferenceGroups(idea);

  return (
    <div className="container mx-auto max-w-5xl px-4 py-8">
      <IdeaBreadcrumb title={idea.title} />

      <div className="space-y-10">
        <header className="space-y-4">
          <h1 className="text-4xl font-bold md:text-5xl">{idea.title}</h1>
          <p className="max-w-3xl text-xl leading-relaxed text-muted-foreground">
            {idea.description}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            {idea.sourceUrl && (
              <Button asChild variant="outline" size="sm">
                <a
                  href={idea.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Read the source <ExternalLink className="size-4" />
                </a>
              </Button>
            )}
            <IdeaBadges ideas={idea.relatedIdeas} />
          </div>
        </header>

        <Markdown source={idea.content} />

        <IdeaReferences groups={referenceGroups} />
      </div>
    </div>
  );
}
