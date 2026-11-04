import { Briefcase, FileText, Layers, Rss } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ExperienceCard } from "@/components/experience/experience-card";
import { Button } from "@/components/ui/button";
import {
  type Experience,
  formatExperienceDateLabel,
  getAllExperience,
  getExperienceSlug,
} from "@/lib/api/experience";
import { siteConfig } from "@/lib/config/site-config";
import { loadDomainRepository } from "@/lib/domain";
import { getRoleBlogs } from "@/lib/domain/blog/blogQueries";
import { getRoleProjects } from "@/lib/domain/project/projectQueries";

const pageDescription =
  "Professional experience and career history of Robbie Palmer, a Principal Software Engineer and Engineering Manager specializing in machine learning, computer vision, and data engineering.";

function getExperienceDateLabel(experience: Experience): string {
  return formatExperienceDateLabel(experience.startDate, experience.endDate);
}

export const metadata: Metadata = {
  title: "Experience",
  description: pageDescription,
  openGraph: {
    title: "Experience - Robbie Palmer",
    description: pageDescription,
    url: `${siteConfig.url}/experience`,
  },
  twitter: {
    title: "Experience - Robbie Palmer",
    description: pageDescription,
  },
  alternates: {
    canonical: `${siteConfig.url}/experience`,
    types: {
      "application/rss+xml": [
        { url: "/feed.xml", title: `${siteConfig.name} RSS Feed` },
        {
          url: "/experience/feed.xml",
          title: `${siteConfig.name} — Experience`,
        },
      ],
    },
  },
};

function ExperiencePageHeader() {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 className="text-4xl md:text-5xl font-bold mb-4">Experience</h1>
        <p className="text-xl text-muted-foreground">
          Professional experience and career history
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <Button asChild variant="default" size="sm">
          <Link href="/resume">
            <FileText className="h-4 w-4" /> Résumé
          </Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href="/technologies">
            <Layers className="size-4" /> Technologies
          </Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <a href="/experience/feed.xml" target="_blank" rel="noreferrer">
            <Rss className="h-4 w-4" /> Subscribe
          </a>
        </Button>
      </div>
    </div>
  );
}

function RolesSection({
  experiences,
  repository,
}: Readonly<{
  experiences: Experience[];
  repository: ReturnType<typeof loadDomainRepository>;
}>) {
  return (
    <section className="mb-16">
      <h2 className="text-3xl font-semibold mb-8 flex items-center gap-2">
        <Briefcase className="w-7 h-7 text-primary" /> Roles
      </h2>
      <div className="relative">
        <div
          className="absolute left-[19px] w-0.5 bg-gradient-to-b from-primary/50 via-primary/30 to-primary/10 hidden md:block"
          style={{ top: "44px", height: "calc(100% - 88px)" }}
        />

        <div className="space-y-6">
          {experiences.map((experience) => {
            const roleSlug = getExperienceSlug(experience);
            return (
              <ExperienceCard
                key={`${experience.company}-${experience.startDate}`}
                experience={experience}
                dateLabel={getExperienceDateLabel(experience)}
                id={roleSlug}
                projects={getRoleProjects(repository, roleSlug)}
                blogs={getRoleBlogs(repository, roleSlug)}
              />
            );
          })}
        </div>
      </div>
    </section>
  );
}

export default function ExperiencePage() {
  const experiences = getAllExperience();
  const repository = loadDomainRepository();

  return (
    <div className="container mx-auto px-4 py-12 max-w-6xl">
      <ExperiencePageHeader />
      <RolesSection experiences={experiences} repository={repository} />
    </div>
  );
}
