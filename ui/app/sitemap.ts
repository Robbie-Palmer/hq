import type { MetadataRoute } from "next";
import { getAllPosts } from "@/lib/api/blog";
import { getAllIdeas } from "@/lib/api/ideas";
import { getAllInitiatives } from "@/lib/api/initiatives";
import { getAllLegacyADRPaths, getAllProjects } from "@/lib/api/projects";
import { siteConfig } from "@/lib/config/site-config";
import { getAllTechnologySlugs, loadDomainRepository } from "@/lib/domain";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const posts = getAllPosts();
  const initiatives = getAllInitiatives();
  const ideas = getAllIdeas();
  const projects = getAllProjects();
  const repository = loadDomainRepository();
  const technologySlugs = getAllTechnologySlugs(repository);

  const blogPosts = posts.map((post) => ({
    url: `${siteConfig.url}/blog/${post.slug}`,
    lastModified: post.updated || post.date,
    priority: 0.9,
  }));

  const initiativePages = initiatives.map((initiative) => ({
    url: `${siteConfig.url}/initiatives/${initiative.slug}`,
    lastModified: initiative.updated || initiative.date,
    priority: 0.8,
  }));

  const projectPages = projects.map((project) => ({
    url: `${siteConfig.url}/projects/${project.slug}`,
    lastModified: project.updated || project.date,
    priority: 0.8,
  }));

  const pitchDeckPages = projects.flatMap((project) =>
    project.pitch
      ? [
          {
            url: `${siteConfig.url}/projects/${project.slug}/deck`,
            lastModified: project.updated || project.date,
            priority: 0.7,
          },
        ]
      : [],
  );

  const adrPages = projects.flatMap((project) =>
    project.adrs.map((adr) => ({
      url: `${siteConfig.url}/projects/${project.slug}/adrs/${adr.slug}`,
      lastModified: adr.date,
      priority: 0.8,
    })),
  );
  const legacyAdrPages = getAllLegacyADRPaths().map(
    ({ projectSlug, adrSlug, lastModified }) => ({
      url: `${siteConfig.url}/projects/${projectSlug}/adrs/${adrSlug}`,
      lastModified,
      priority: 0.1,
    }),
  );
  const technologyPages = technologySlugs.map((slug) => ({
    url: `${siteConfig.url}/technologies/${slug}`,
    lastModified: new Date().toISOString(),
    priority: 0.6,
  }));

  const ideaPages = ideas.map((idea) => ({
    url: `${siteConfig.url}/ideas/${idea.slug}`,
    lastModified: new Date().toISOString(),
    priority: 0.7,
  }));

  const latestPostDate = posts.reduce((latest, post) => {
    const postDate = new Date(post.updated || post.date);
    return postDate > latest ? postDate : latest;
  }, new Date(0));

  const latestProjectDate = projects.reduce((latest, project) => {
    const projectDate = new Date(project.updated || project.date);
    return projectDate > latest ? projectDate : latest;
  }, new Date(0));

  return [
    {
      url: siteConfig.url,
      lastModified: new Date().toISOString(),
      priority: 1,
    },
    {
      url: `${siteConfig.url}/blog`,
      lastModified: latestPostDate.toISOString(),
      priority: 0.7,
    },
    {
      url: `${siteConfig.url}/experience`,
      lastModified: new Date().toISOString(),
      priority: 0.7,
    },
    {
      url: `${siteConfig.url}/projects`,
      lastModified: latestProjectDate.toISOString(),
      priority: 0.7,
    },
    {
      url: `${siteConfig.url}/ideas`,
      lastModified: new Date().toISOString(),
      priority: 0.7,
    },
    {
      url: `${siteConfig.url}/recipes`,
      lastModified: new Date().toISOString(),
      priority: 0.4,
    },
    {
      url: `${siteConfig.url}/satellite-swarm`,
      lastModified: new Date().toISOString(),
      priority: 0.6,
    },
    {
      url: `${siteConfig.url}/posthog`,
      lastModified: new Date().toISOString(),
      priority: 0.5,
    },
    ...blogPosts,
    ...initiativePages,
    ...projectPages,
    ...pitchDeckPages,
    ...adrPages,
    ...legacyAdrPages,
    ...ideaPages,
    ...technologyPages,
    {
      url: `${siteConfig.url}/technologies/revealdotjs/deck`,
      lastModified: new Date().toISOString(),
      priority: 0.5,
    },
  ];
}
