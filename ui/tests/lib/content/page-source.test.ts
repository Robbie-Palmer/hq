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
    "/blog/2021-12-10-just-right-engineering",
    "/ideas/data-provenance",
    "/initiatives/semi-autonomous-software-development",
    "/projects/personal-knowledge-graph",
    "/projects/personal-knowledge-graph/adrs/038-content-graph",
    "/projects/personal-knowledge-graph/pdrs/000-example",
    "/technologies/typescript",
    "/recipes",
    "/satellite-swarm",
  ])("uses the canonical Markdown twin for %s", (pathname) => {
    expect(resolvePageSource(pathname)).toEqual({
      kind: "canonical-markdown",
      url: `${siteConfig.url}${pathname}.md`,
    });
  });

  it.each([
    "/projects/personal-site",
    "/projects/recipe-site/adrs/000-github-public-repo",
  ])("keeps renamed routes on their generated alias twin", (pathname) => {
    expect(resolvePageSource(`${pathname}/`)).toEqual({
      kind: "canonical-markdown",
      url: `${siteConfig.url}${pathname}.md`,
    });
  });

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
