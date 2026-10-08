import { describe, expect, it, vi } from "vitest";
import { siteConfig } from "@/lib/config/site-config";
import {
  createFeedDocuments,
  SECTION_FEED_MAX_ITEMS,
} from "@/scripts/generate-rss";

const fixtures = vi.hoisted(() => {
  const projects = [
    {
      slug: "alpha",
      title: "Alpha",
      description: "The alpha project",
      date: "2026-12-31",
      status: "live",
      tags: ["alpha-tag"],
    },
    {
      slug: "beta",
      title: "Beta",
      description: "The beta project",
      date: "2026-12-31",
      status: "completed",
      tags: [],
    },
  ];
  const adrs = Array.from({ length: 52 }, (_, index) => ({
    slug: `${String(index + 1).padStart(3, "0")}-decision`,
    title: `Decision ${index + 1}`,
    projectSlug: "alpha",
    projectTitle: "Alpha",
    date: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
    status: "Accepted",
    isInherited: false,
  }));
  const initiatives = [
    {
      slug: "alpha-initiative",
      title: "Alpha Initiative",
      description: "The alpha initiative",
      date: "2027-01-01",
      status: "active",
      projects: [projects[0]],
    },
    {
      slug: "beta-initiative",
      title: "Beta Initiative",
      description: "The beta initiative",
      date: "2027-01-01",
      status: "inactive",
      projects: [projects[1]],
    },
  ];

  return { projects, adrs, initiatives };
});

vi.mock("@/lib/api/blog", () => ({ getAllPosts: () => [] }));
vi.mock("@/lib/api/experience", () => ({
  getAllExperience: () => [],
  getExperienceSlug: () => "unused",
}));
vi.mock("@/lib/api/initiatives", () => ({
  getAllInitiatives: () => fixtures.initiatives,
}));
vi.mock("@/lib/api/projects", () => ({
  getAllADRs: () => fixtures.adrs,
  getAllProjectAliases: () => [{ alias: "old-alpha", target: "alpha" }],
  getAllProjects: () => fixtures.projects,
}));
vi.mock("@/lib/domain", () => ({
  loadDomainRepository: () => ({ technologies: new Map() }),
}));

function itemLinks(xml: string): string[] {
  const document = new DOMParser().parseFromString(xml, "application/xml");
  return Array.from(document.querySelectorAll("item > link"), (link) =>
    link.textContent?.trim(),
  ).filter((link): link is string => Boolean(link));
}

describe("RSS generation", () => {
  const documents = new Map(
    createFeedDocuments().map((document) => [
      document.relativePath,
      document.content,
    ]),
  );

  it("creates a feed for every project and initiative", () => {
    for (const project of fixtures.projects) {
      expect(documents.has(`projects/${project.slug}/feed.xml`)).toBe(true);
    }
    for (const initiative of fixtures.initiatives) {
      expect(documents.has(`initiatives/${initiative.slug}/feed.xml`)).toBe(
        true,
      );
    }
    expect(documents.has("projects/old-alpha/feed.xml")).toBe(true);
  });

  it("limits a project feed to the rolling window of its own entries", () => {
    const links = itemLinks(documents.get("projects/alpha/feed.xml") ?? "");
    const allowedLinks = new Set([
      `${siteConfig.url}/projects/alpha`,
      ...fixtures.adrs.map(
        (adr) =>
          `${siteConfig.url}/projects/${adr.projectSlug}/adrs/${adr.slug}`,
      ),
    ]);

    expect(links).toHaveLength(SECTION_FEED_MAX_ITEMS);
    expect(links).toContain(`${siteConfig.url}/projects/alpha`);
    expect(links.every((link) => allowedLinks.has(link))).toBe(true);
    expect(links).not.toContain(`${siteConfig.url}/projects/beta`);
  });

  it("includes an initiative and its linked project entries", () => {
    const links = itemLinks(
      documents.get("initiatives/alpha-initiative/feed.xml") ?? "",
    );

    expect(links).toContain(`${siteConfig.url}/initiatives/alpha-initiative`);
    expect(links).toContain(`${siteConfig.url}/projects/alpha`);
    expect(links).toContain(
      `${siteConfig.url}/projects/alpha/adrs/052-decision`,
    );
    expect(links).not.toContain(`${siteConfig.url}/projects/beta`);
  });

  it("breaks equal-date ties by URL", () => {
    const links = itemLinks(documents.get("projects/feed.xml") ?? "");

    expect(links.slice(0, 2)).toEqual([
      `${siteConfig.url}/projects/alpha`,
      `${siteConfig.url}/projects/beta`,
    ]);
  });
});
