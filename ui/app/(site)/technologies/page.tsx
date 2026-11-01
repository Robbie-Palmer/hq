import { Layers, Rss } from "lucide-react";
import type { Metadata } from "next";
import { SearchableTechnologyGrid } from "@/components/technology/searchable-technology-grid";
import { Button } from "@/components/ui/button";
import { siteConfig } from "@/lib/config/site-config";
import { loadDomainRepository } from "@/lib/domain";
import {
  getAllTechnologyBadges,
  rankTechnologiesByConnections,
} from "@/lib/domain/technology";

const pageDescription =
  "Tools, languages, frameworks, and platforms used across my professional work and personal projects.";

export const metadata: Metadata = {
  title: "Technologies",
  description: pageDescription,
  alternates: {
    canonical: `${siteConfig.url}/technologies`,
    types: {
      "application/rss+xml": [
        {
          url: "/technologies/feed.xml",
          title: `${siteConfig.name} - Technologies`,
        },
      ],
    },
  },
  openGraph: {
    title: "Technologies - Robbie Palmer",
    description: pageDescription,
    url: `${siteConfig.url}/technologies`,
  },
  twitter: {
    title: "Technologies - Robbie Palmer",
    description: pageDescription,
  },
};

export default function TechnologiesPage() {
  const repository = loadDomainRepository();
  const technologies = rankTechnologiesByConnections(
    repository,
    getAllTechnologyBadges(repository),
  );

  return (
    <div className="max-w-5xl py-4">
      <header className="mb-10 space-y-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-3xl">
            <div className="mb-4 flex items-center gap-3">
              <Layers className="size-8 text-primary" />
              <h1 className="text-4xl font-bold md:text-5xl">Technologies</h1>
            </div>
            <p className="text-xl leading-relaxed text-muted-foreground">
              {pageDescription}
            </p>
          </div>
          <Button asChild variant="outline" size="sm" className="shrink-0">
            <a href="/technologies/feed.xml" target="_blank" rel="noreferrer">
              <Rss className="size-4" /> Subscribe
            </a>
          </Button>
        </div>
      </header>

      <SearchableTechnologyGrid technologies={technologies} />
    </div>
  );
}
