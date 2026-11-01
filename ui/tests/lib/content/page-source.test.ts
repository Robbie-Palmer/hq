import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { siteConfig } from "@/lib/config/site-config";
import { resolvePageSource } from "@/lib/content/page-source";

const repositoryFileCases = [
  ["/", "ui/app/(site)/page.tsx"],
  ["/blog", "ui/app/(site)/blog/page.tsx"],
  ["/ideas", "ui/app/(site)/ideas/page.tsx"],
  ["/initiatives", "ui/app/(site)/initiatives/page.tsx"],
  ["/product-decisions", "ui/app/(site)/product-decisions/page.tsx"],
  ["/projects", "ui/app/(site)/projects/page.tsx"],
  ["/building-philosophy", "ui/content/projects/building-philosophy.mdx"],
  ["/experience", "ui/content/experience.ts"],
  ["/posthog", "ui/content/posthog.ts"],
  [
    "/blog/2021-12-10-just-right-engineering",
    "ui/content/blog/2021-12-10-just-right-engineering.mdx",
  ],
  ["/ideas/data-provenance", "ui/content/ideas/data-provenance.mdx"],
  [
    "/initiatives/semi-autonomous-software-development",
    "ui/content/initiatives/semi-autonomous-software-development.mdx",
  ],
  [
    "/projects/personal-knowledge-graph",
    "ui/content/projects/personal-knowledge-graph/index.mdx",
  ],
  [
    "/projects/personal-knowledge-graph/adrs/038-content-graph",
    "ui/content/projects/personal-knowledge-graph/adrs/038-content-graph.mdx",
  ],
  [
    "/projects/personal-finance-app/pdrs/000-data-entry-first-wealth-tracking",
    "ui/content/projects/personal-finance-app/pdrs/000-data-entry-first-wealth-tracking.mdx",
  ],
  ["/technologies/typescript", "ui/content/technologies.ts"],
  ["/recipes", "ui/app/recipes/page.tsx"],
  ["/satellite-swarm", "ui/app/satellite-swarm/page.tsx"],
] as const;

describe("resolvePageSource", () => {
  it.each(repositoryFileCases)(
    "maps %s to its checked-in source",
    (pathname, sourcePath) => {
      expect(resolvePageSource(pathname)).toEqual({
        kind: "repository-file",
        url: `${siteConfig.author.sourceRepo}/blob/main/${sourcePath}`,
      });
      expect(fs.existsSync(path.join(process.cwd(), "..", sourcePath))).toBe(
        true,
      );
    },
  );

  it.each([
    [
      "/projects/personal-site",
      "ui/content/projects/personal-knowledge-graph/index.mdx",
    ],
    [
      "/projects/recipe-site/adrs/000-github-public-repo",
      "ui/content/projects/personal-knowledge-graph/adrs/000-github-public-repo.mdx",
    ],
  ])(
    "maps renamed route %s to its canonical repository source",
    (pathname, sourcePath) => {
      expect(resolvePageSource(`${pathname}///`)).toEqual({
        kind: "repository-file",
        url: `${siteConfig.author.sourceRepo}/blob/main/${sourcePath}`,
      });
      expect(fs.existsSync(path.join(process.cwd(), "..", sourcePath))).toBe(
        true,
      );
    },
  );

  it.each([
    ["/recipes/settings", "ui/app/recipes"],
    ["/resume", "ui/app/(site)/resume"],
  ])(
    "uses an intentional source-area fallback for %s",
    (pathname, sourcePath) => {
      expect(resolvePageSource(pathname)).toEqual({
        kind: "runtime-fallback",
        url: `${siteConfig.author.sourceRepo}/tree/main/${sourcePath}`,
      });
    },
  );

  it("keeps the repository as the fallback for an unknown route", () => {
    expect(resolvePageSource("/not-a-route")).toEqual({
      kind: "repository-fallback",
      url: siteConfig.author.sourceRepo,
    });
  });
});
