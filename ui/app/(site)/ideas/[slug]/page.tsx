import {
  Blocks,
  ExternalLink,
  FileCheck2,
  FileText,
  FolderKanban,
  GitBranch,
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

type ProductDecisionReference = NonNullable<
  ReturnType<typeof getIdea>
>["relatedContent"]["productDecisions"][number];

function ProductDecisionReferences({
  decisions,
}: Readonly<{ decisions: ProductDecisionReference[] }>) {
  if (decisions.length === 0) return null;
  return (
    <div className="space-y-3">
      <h3 className="flex items-center gap-2 text-lg font-medium">
        <FileCheck2 className="size-5" /> Product decisions
      </h3>
      <div className="grid gap-3 md:grid-cols-2">
        {decisions.map((decision) => (
          <RelatedCard
            key={decision.slug}
            href={`/product-decisions/${decision.slug}`}
            title={decision.title}
            description={decision.status}
          />
        ))}
      </div>
    </div>
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
  const productDecisions = idea.relatedContent.productDecisions ?? [];

  const hasReferences =
    idea.relatedContent.technologies.length > 0 ||
    idea.relatedContent.projects.length > 0 ||
    idea.relatedContent.blogs.length > 0 ||
    idea.relatedContent.adrs.length > 0 ||
    productDecisions.length > 0;

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

        {hasReferences ? (
          <section className="space-y-6" aria-labelledby="idea-references">
            <h2 id="idea-references" className="text-2xl font-semibold">
              Where it appears
            </h2>
            {idea.relatedContent.technologies.length > 0 && (
              <div className="space-y-3">
                <h3 className="flex items-center gap-2 text-lg font-medium">
                  <Blocks className="size-5" /> Technologies
                </h3>
                <div className="grid gap-3 md:grid-cols-2">
                  {idea.relatedContent.technologies.map((technology) => (
                    <RelatedCard
                      key={technology.slug}
                      href={`/technologies/${technology.slug}`}
                      title={technology.name}
                      description={technology.description ?? technology.website}
                    />
                  ))}
                </div>
              </div>
            )}
            {idea.relatedContent.projects.length > 0 && (
              <div className="space-y-3">
                <h3 className="flex items-center gap-2 text-lg font-medium">
                  <FolderKanban className="size-5" /> Projects
                </h3>
                <div className="grid gap-3 md:grid-cols-2">
                  {idea.relatedContent.projects.map((project) => (
                    <RelatedCard
                      key={project.slug}
                      href={`/projects/${project.slug}`}
                      title={project.title}
                      description={project.status.replace("_", " ")}
                    />
                  ))}
                </div>
              </div>
            )}
            {idea.relatedContent.blogs.length > 0 && (
              <div className="space-y-3">
                <h3 className="flex items-center gap-2 text-lg font-medium">
                  <FileText className="size-5" /> Blog posts
                </h3>
                <div className="grid gap-3 md:grid-cols-2">
                  {idea.relatedContent.blogs.map((blog) => (
                    <RelatedCard
                      key={blog.slug}
                      href={`/blog/${blog.slug}`}
                      title={blog.title}
                      description={`${blog.date} · ${blog.readingTime}`}
                    />
                  ))}
                </div>
              </div>
            )}
            {idea.relatedContent.adrs.length > 0 && (
              <div className="space-y-3">
                <h3 className="flex items-center gap-2 text-lg font-medium">
                  <GitBranch className="size-5" /> Architecture decisions
                </h3>
                <div className="grid gap-3 md:grid-cols-2">
                  {idea.relatedContent.adrs.map((adr) => (
                    <RelatedCard
                      key={`${adr.projectSlug}:${adr.slug}`}
                      href={`/projects/${adr.projectSlug}/adrs/${adr.slug}`}
                      title={adr.title}
                      description={adr.status}
                    />
                  ))}
                </div>
              </div>
            )}
            <ProductDecisionReferences decisions={productDecisions} />
          </section>
        ) : (
          <p className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
            This idea has no technology or published-content references yet.
          </p>
        )}
      </div>
    </div>
  );
}
