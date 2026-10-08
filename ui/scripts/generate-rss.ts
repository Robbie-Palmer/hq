#!/usr/bin/env tsx

/**
 * Writes the site's RSS 2.0 feeds into the static export directory (out/):
 * a combined feed of all dated content plus section- and subject-specific feeds.
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
// Import order matters: registers .wasm loading before content imports
import "./lib/register-wasm";
import { Feed } from "feed";
import { getAllPosts } from "@/lib/api/blog";
import { getAllExperience, getExperienceSlug } from "@/lib/api/experience";
import { getAllInitiatives } from "@/lib/api/initiatives";
import {
  getAllADRs,
  getAllProjectAliases,
  getAllProjects,
} from "@/lib/api/projects";
import { siteConfig } from "@/lib/config/site-config";
import { loadDomainRepository } from "@/lib/domain";

const OUT_DIR = path.join(process.cwd(), "out");
// Section feeds stay a tight rolling window; the global feed is the firehose
// of everything, so it keeps a much larger cap.
export const SECTION_FEED_MAX_ITEMS = 50;
const GLOBAL_MAX_ITEMS = 200;

type FeedEntry = {
  title: string;
  url: string;
  description: string;
  date: Date;
  categories: string[];
};

type FeedDocument = {
  relativePath: string;
  content: string;
};

const day = (date: string): Date =>
  date.includes("T") ? new Date(date) : new Date(`${date}T00:00:00Z`);
const month = (value: string): Date => new Date(`${value}-01T00:00:00Z`);

function blogEntries(): FeedEntry[] {
  return getAllPosts().map((post) => {
    const updated = Boolean(post.updated && post.updated !== post.date);
    return {
      title: post.title,
      url: `${siteConfig.url}/blog/${post.slug}`,
      description: post.description,
      date: day(post.updated || post.date),
      categories: ["Blog", ...(updated ? ["Updated"] : []), ...post.tags],
    };
  });
}

function projectEntry(
  project: ReturnType<typeof getAllProjects>[number],
): FeedEntry {
  const updated = Boolean(project.updated && project.updated !== project.date);
  return {
    title: project.title,
    url: `${siteConfig.url}/projects/${project.slug}`,
    description: project.description,
    date: day(project.updated || project.date),
    categories: ["Project", ...(updated ? ["Updated"] : []), ...project.tags],
  };
}

function projectEntries(
  projects: ReturnType<typeof getAllProjects>,
): FeedEntry[] {
  return projects.map(projectEntry);
}

function initiativeEntry(
  initiative: ReturnType<typeof getAllInitiatives>[number],
): FeedEntry {
  const updated = Boolean(
    initiative.updated && initiative.updated !== initiative.date,
  );
  return {
    title: initiative.title,
    url: `${siteConfig.url}/initiatives/${initiative.slug}`,
    description: initiative.description,
    date: day(initiative.updated || initiative.date),
    categories: ["Initiative", ...(updated ? ["Updated"] : [])],
  };
}

function initiativeEntries(
  initiatives: ReturnType<typeof getAllInitiatives>,
): FeedEntry[] {
  return initiatives.map(initiativeEntry);
}

function adrEntry(adr: ReturnType<typeof getAllADRs>[number]): FeedEntry {
  return {
    title: `${adr.projectTitle}: ${adr.title}`,
    url: `${siteConfig.url}/projects/${adr.projectSlug}/adrs/${adr.slug}`,
    description: `Architecture decision record (${adr.status}) for ${adr.projectTitle}.`,
    date: day(adr.date),
    categories: ["ADR", adr.projectTitle],
  };
}

function roleEntries(): FeedEntry[] {
  return getAllExperience().map((role) => ({
    title: `${role.title} at ${role.company}`,
    url: `${siteConfig.url}/experience#${getExperienceSlug(role)}`,
    description: role.description,
    date: month(role.startDate),
    categories: ["Experience", role.company],
  }));
}

function technologyEntries(): FeedEntry[] {
  const repository = loadDomainRepository();
  return Array.from(repository.technologies.values())
    .filter((tech): tech is typeof tech & { added: string } => Boolean(tech.added))
    .map((tech) => ({
      title: tech.name,
      url: `${siteConfig.url}/technologies/${tech.slug}`,
      description: tech.description ?? tech.name,
      date: day(tech.added),
      categories: ["Technology", ...(tech.type ? [tech.type] : [])],
    }));
}

function buildFeed(
  meta: {
    title: string;
    description: string;
    feedPath: string;
    pagePath?: string;
  },
  entries: FeedEntry[],
  max: number = SECTION_FEED_MAX_ITEMS,
): string {
  const items = [...entries]
    .sort(
      (a, b) =>
        b.date.getTime() - a.date.getTime() || a.url.localeCompare(b.url),
    )
    .slice(0, max);

  const feed = new Feed({
    title: meta.title,
    description: meta.description,
    id: `${siteConfig.url}${meta.feedPath}`,
    link: `${siteConfig.url}${meta.pagePath ?? ""}`,
    language: "en",
    copyright: `© ${new Date().getFullYear()} ${siteConfig.author.name}`,
    updated: items[0]?.date ?? new Date(0),
    feedLinks: { rss: `${siteConfig.url}${meta.feedPath}` },
    author: { name: siteConfig.author.name, link: siteConfig.url },
  });

  for (const entry of items) {
    feed.addItem({
      title: entry.title,
      id: entry.url,
      link: entry.url,
      description: entry.description,
      date: entry.date,
      category: entry.categories.map((name) => ({ name })),
    });
  }

  return feed.rss2();
}

export function createFeedDocuments(): FeedDocument[] {
  const blog = blogEntries();
  const initiatives = getAllInitiatives();
  const initiativeFeedEntries = initiativeEntries(initiatives);
  const projectModels = getAllProjects();
  const projects = projectEntries(projectModels);
  // Inherited ADRs restate a decision recorded elsewhere; keep each once.
  const adrModels = getAllADRs().filter((adr) => !adr.isInherited);
  const adrs = adrModels.map(adrEntry);
  const roles = roleEntries();
  const technologies = technologyEntries();
  const combined = [
    ...blog,
    ...initiativeFeedEntries,
    ...projects,
    ...adrs,
    ...roles,
    ...technologies,
  ];

  const documents: FeedDocument[] = [
    {
      relativePath: "feed.xml",
      content: buildFeed(
        {
          title: siteConfig.name,
          description: `Everything from ${siteConfig.name}: posts, initiatives, projects, architecture decisions, roles, and technologies.`,
          feedPath: "/feed.xml",
        },
        combined,
        GLOBAL_MAX_ITEMS,
      ),
    },
    {
      relativePath: "blog/feed.xml",
      content: buildFeed(
        {
          title: `${siteConfig.name} — ${siteConfig.blog.title}`,
          description: siteConfig.blog.description,
          feedPath: "/blog/feed.xml",
        },
        blog,
      ),
    },
    {
      relativePath: "projects/feed.xml",
      content: buildFeed(
        {
          title: `${siteConfig.name} — Projects & ADRs`,
          description: `New projects and architecture decision records from ${siteConfig.name}.`,
          feedPath: "/projects/feed.xml",
        },
        [...projects, ...adrs],
      ),
    },
    {
      relativePath: "experience/feed.xml",
      content: buildFeed(
        {
          title: `${siteConfig.name} — Experience`,
          description: `Roles and career updates from ${siteConfig.name}.`,
          feedPath: "/experience/feed.xml",
        },
        roles,
      ),
    },
    {
      relativePath: "technologies/feed.xml",
      content: buildFeed(
        {
          title: `${siteConfig.name} — Technologies`,
          description: `Technologies ${siteConfig.name} has added to the stack.`,
          feedPath: "/technologies/feed.xml",
        },
        technologies,
      ),
    },
  ];

  for (const project of projectModels) {
    const projectFeedPath = `/projects/${project.slug}/feed.xml`;
    const projectAdrs = adrModels
      .filter((adr) => adr.projectSlug === project.slug)
      .map(adrEntry);
    documents.push({
      relativePath: projectFeedPath.slice(1),
      content: buildFeed(
        {
          title: `${siteConfig.name}: ${project.title}`,
          description: `Updates and architecture decision records for ${project.title}.`,
          feedPath: projectFeedPath,
          pagePath: `/projects/${project.slug}`,
        },
        [projectEntry(project), ...projectAdrs],
      ),
    });
  }

  for (const { alias, target } of getAllProjectAliases()) {
    const project = projectModels.find(({ slug }) => slug === target);
    if (!project) continue;
    const aliasFeedPath = `/projects/${alias}/feed.xml`;
    const projectAdrs = adrModels
      .filter((adr) => adr.projectSlug === project.slug)
      .map(adrEntry);
    documents.push({
      relativePath: aliasFeedPath.slice(1),
      content: buildFeed(
        {
          title: `${siteConfig.name}: ${project.title}`,
          description: `Updates and architecture decision records for ${project.title}.`,
          feedPath: aliasFeedPath,
          pagePath: `/projects/${project.slug}`,
        },
        [projectEntry(project), ...projectAdrs],
      ),
    });
  }

  for (const initiative of initiatives) {
    const initiativeFeedPath = `/initiatives/${initiative.slug}/feed.xml`;
    const projectSlugs = new Set(
      initiative.projects.map((project) => project.slug),
    );
    const relatedProjects = initiative.projects.map(projectEntry);
    const relatedAdrs = adrModels
      .filter((adr) => projectSlugs.has(adr.projectSlug))
      .map(adrEntry);

    documents.push({
      relativePath: initiativeFeedPath.slice(1),
      content: buildFeed(
        {
          title: `${siteConfig.name}: ${initiative.title}`,
          description: `Updates from ${initiative.title} and its projects.`,
          feedPath: initiativeFeedPath,
          pagePath: `/initiatives/${initiative.slug}`,
        },
        [initiativeEntry(initiative), ...relatedProjects, ...relatedAdrs],
      ),
    });
  }

  return documents;
}

function write(relativePath: string, content: string): void {
  const filePath = path.join(OUT_DIR, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function main(): void {
  if (!fs.existsSync(OUT_DIR)) {
    console.error(
      "out/ directory not found. Run `next build` first (this script runs as part of `pnpm build`).",
    );
    process.exit(1);
  }

  const documents = createFeedDocuments();
  for (const document of documents) {
    write(document.relativePath, document.content);
  }

  console.log(`Generated ${documents.length} RSS feeds in out/`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main();
}
