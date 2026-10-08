import { Rss } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { InitiativeStatusBadge } from "@/components/initiatives/initiative-status-badge";
import { Markdown } from "@/components/markdown";
import { Mermaid } from "@/components/mermaid";
import { ProjectStatusBadge } from "@/components/projects/project-status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  getAllInitiativeSlugs,
  getInitiative,
  type InitiativeWithProjects,
} from "@/lib/api/initiatives";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return getAllInitiativeSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;
  const initiative = getInitiative(slug);

  if (!initiative) {
    return { title: "Initiative Not Found" };
  }

  return {
    title: `${initiative.title} - Initiative`,
    description: initiative.description,
    alternates: {
      types: {
        "application/rss+xml": [
          {
            url: `/initiatives/${initiative.slug}/feed.xml`,
            title: `${initiative.title} RSS feed`,
          },
        ],
      },
    },
  };
}

export default async function InitiativePage({ params }: Readonly<PageProps>) {
  const { slug } = await params;
  const initiative: InitiativeWithProjects | null = getInitiative(slug);

  if (!initiative) {
    notFound();
  }

  return (
    <div className="container mx-auto max-w-5xl px-4 py-8">
      <nav
        aria-label="Breadcrumb"
        className="mb-8 flex flex-wrap items-center gap-2 text-sm text-muted-foreground"
      >
        <Link
          href="/projects"
          className="hover:underline hover:underline-offset-4"
        >
          Initiatives
        </Link>
        <span>/</span>
        <span>{initiative.title}</span>
      </nav>

      <div className="space-y-8">
        <header className="space-y-4">
          <div className="flex flex-wrap items-center gap-4">
            <h1 className="text-4xl font-bold md:text-5xl">
              {initiative.title}
            </h1>
            <InitiativeStatusBadge
              status={initiative.status}
              className="px-3 py-1 text-sm"
            />
          </div>
          <p className="max-w-3xl text-xl leading-relaxed text-muted-foreground">
            {initiative.description}
          </p>
          <Button asChild variant="outline" size="sm">
            <a
              href={`/initiatives/${initiative.slug}/feed.xml`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Subscribe to ${initiative.title}`}
            >
              <Rss className="h-4 w-4" />
              Subscribe
            </a>
          </Button>
          <div className="flex flex-wrap gap-2">
            {initiative.projects.map((project) => (
              <Badge key={project.slug} variant="outline" asChild>
                <Link href={`/projects/${project.slug}`}>{project.title}</Link>
              </Badge>
            ))}
          </div>
        </header>

        <Markdown source={initiative.content} components={{ Mermaid }} />

        {initiative.projects.length > 0 && (
          <section className="space-y-4" aria-labelledby="initiative-projects">
            <h2 id="initiative-projects" className="text-2xl font-semibold">
              Projects advancing this goal
            </h2>
            <div className="grid gap-4 md:grid-cols-2">
              {initiative.projects.map((project) => (
                <Card key={project.slug} className="gap-4">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-4">
                      <CardTitle className="text-lg">
                        <Link
                          href={`/projects/${project.slug}`}
                          className="hover:text-primary hover:underline hover:underline-offset-4"
                        >
                          {project.title}
                        </Link>
                      </CardTitle>
                      <ProjectStatusBadge status={project.status} />
                    </div>
                    <CardDescription className="leading-6">
                      {project.contribution ?? project.description}
                    </CardDescription>
                  </CardHeader>
                </Card>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
