import { describe, expect, it } from "vitest";
import sitemap from "@/app/sitemap";

describe("sitemap", () => {
  it("includes the satellite swarm project space", () => {
    expect(sitemap().map((entry) => entry.url)).toContain(
      "https://robbiepalmer.me/satellite-swarm",
    );
  });

  it("includes the PostHog application", () => {
    expect(sitemap().map((entry) => entry.url)).toContain(
      "https://robbiepalmer.me/posthog",
    );
  });

  it("includes the ideas index and every idea detail page", () => {
    const ideaUrls = sitemap()
      .map((entry) => entry.url)
      .filter((url) => url.includes("/ideas"));

    expect(ideaUrls).toContain("https://robbiepalmer.me/ideas");
    expect(ideaUrls).toContain("https://robbiepalmer.me/ideas/goodharts-law");
    expect(ideaUrls).toContain(
      "https://robbiepalmer.me/ideas/flp-impossibility",
    );
    expect(ideaUrls).toContain(
      "https://robbiepalmer.me/ideas/human-in-the-loop",
    );
    expect(ideaUrls).toContain(
      "https://robbiepalmer.me/ideas/human-on-the-loop",
    );
    expect(ideaUrls).toContain(
      "https://robbiepalmer.me/ideas/stream-table-duality",
    );
    expect(ideaUrls).toContain(
      "https://robbiepalmer.me/ideas/context-engineering",
    );
    expect(ideaUrls).toContain("https://robbiepalmer.me/ideas/commit-log");
    expect(ideaUrls).toContain(
      "https://robbiepalmer.me/ideas/adaptive-planning",
    );
    expect(ideaUrls).toContain("https://robbiepalmer.me/ideas/epistemology");
    expect(ideaUrls).toHaveLength(29);
  });

  it("uses the source ADR date for legacy ADR paths", () => {
    expect(sitemap()).toContainEqual(
      expect.objectContaining({
        url: "https://robbiepalmer.me/projects/recipe-site/adrs/000-github-public-repo",
        lastModified: "2025-10-18",
      }),
    );
  });

  it("excludes project aliases and their ADR paths", () => {
    const urls = sitemap().map((entry) => entry.url);

    expect(urls).not.toContain(
      "https://robbiepalmer.me/projects/personal-site",
    );
    expect(urls).not.toContain(
      "https://robbiepalmer.me/projects/personal-site/adrs/048-sonarqube",
    );
  });
});
