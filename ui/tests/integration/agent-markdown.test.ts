import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Validates the agent-friendly Markdown twins generated into out/ by
 * scripts/generate-agent-markdown.ts (run as part of `pnpm build`).
 */

const OUT_DIR = path.join(process.cwd(), "out");

// Runtime-backed recipe app pages are static export shells, not recipe content.
// They intentionally have no Markdown, JSON, or Cooklang twins.
const RECIPE_APP_PAGES = new Set([
  "add",
  "cooks",
  "discover",
  "edit",
  "kitchen",
  "log",
  "notifications",
  "offline",
  "onboarding",
  "profile",
  "saved",
  "settings",
  "shopping",
]);

function read(relativePath: string): string {
  return fs.readFileSync(path.join(OUT_DIR, relativePath), "utf-8");
}

describe("agent markdown generation", () => {
  it("generates markdown twins for the main pages", () => {
    for (const file of [
      "index.md",
      "experience.md",
      "projects.md",
      "ideas.md",
      "blog.md",
      "recipes.md",
      "satellite-swarm.md",
      "posthog.md",
      "llms.txt",
      "llms-full.txt",
      "_headers",
      "_routes.json",
    ]) {
      expect(fs.existsSync(path.join(OUT_DIR, file)), file).toBe(true);
    }
  });

  it("publishes the PostHog application with direct evidence", () => {
    const application = read("posthog.md");

    expect(application).toContain("# I want to help products drive themselves");
    expect(application).toContain("## Direct evidence");
    expect(application).toContain("## What the weirdness looks like");
    expect(application).toContain(
      "## The subjects vary. The passion for building is consistent.",
    );
    expect(application).toContain("/images/posthog/knowledge-graph.png");
    expect(application).toContain(
      "I used it to coordinate the work on this page",
    );
    expect(application).toContain("/projects/agentic-code-review");
    expect(read("llms.txt")).toContain("https://robbiepalmer.me/posthog.md");
  });

  it("generates a markdown twin for every idea page", () => {
    const htmlPages = fs
      .readdirSync(path.join(OUT_DIR, "ideas"))
      .filter((file) => file.endsWith(".html"));
    expect(htmlPages).toContain("human-in-the-loop.html");
    expect(htmlPages).toContain("human-on-the-loop.html");
    expect(htmlPages).toContain("context-engineering.html");
    expect(htmlPages).toContain("commit-log.html");
    expect(htmlPages).toContain("stream-table-duality.html");
    expect(htmlPages).toHaveLength(28);
    for (const htmlPage of htmlPages) {
      const mdPage = htmlPage.replace(/\.html$/, ".md");
      expect(fs.existsSync(path.join(OUT_DIR, "ideas", mdPage))).toBe(true);
    }
  });

  it("includes inferred technology backlinks on idea markdown pages", () => {
    const wal = read("ideas/write-ahead-log.md");
    expect(wal).toContain(
      "Technology: [Kafka](https://robbiepalmer.me/technologies/kafka.md)",
    );

    expect(read("llms.txt")).toContain(
      "links to related ideas, technologies, projects, ADRs, and posts",
    );
  });

  it("keeps technology-specific explanations on technology pages", () => {
    const kafka = read("technologies/kafka.md");
    expect(kafka).toContain(
      "Kafka's core abstraction is a distributed, replicated commit log.",
    );
    expect(kafka).toContain("It does not prescribe the topology");
    expect(kafka).toContain("/ideas/commit-log.md");
    expect(kafka).toContain("/ideas/write-ahead-log.md");

    const wal = read("ideas/write-ahead-log.md");
    expect(wal).not.toContain("Kafka's core abstraction");
  });

  it("includes the building philosophy in projects.md", () => {
    const projects = read("projects.md");
    expect(projects).toContain("# Building Philosophy");
    expect(projects).toContain("## Short Feedback Loops");
  });

  it("includes the research paper in the satellite swarm project twin", () => {
    const project = read("projects/autonomic-satellite-swarm.md");
    expect(project).toContain(
      "- Research paper: https://doi.org/10.1109/SMC-IT.2019.00015",
    );
  });

  it("includes the platform manifest and selection history in its project twin", () => {
    const platform = read("projects/personal-engineering-platform.md");
    expect(platform).toContain("## Current layer manifest");
    expect(platform).toContain("### Backend API");
    expect(platform).toContain("backend-api.runtime: preferred");
    expect(platform).toContain("## Default history");
    expect(platform).toContain("### Primary language");
    expect(platform).toContain("### Source licence");
    expect(platform).toContain("AGPL-3.0: Accepted");
    expect(platform).toContain(
      "/projects/personal-engineering-platform/adrs/001-language-defaults.md",
    );
    expect(platform).toContain(
      "driven by [personal-knowledge-graph](https://robbiepalmer.me/projects/personal-knowledge-graph.md)",
    );
  });

  it("includes inherited governance policy in adopter project twins", () => {
    const recipe = read("projects/recipe-site.md");
    expect(recipe).toContain(
      "- Platform policies: Public source, AGPL-3.0, Shared personal-project monorepo",
    );
    expect(recipe.match(/Codex/g)).toHaveLength(1);
  });

  it("keeps Markdown routes for the previous project slug", () => {
    expect(read("projects/personal-site.md")).toContain(
      "[Personal Knowledge Graph](https://robbiepalmer.me/projects/personal-knowledge-graph.md)",
    );
    expect(read("projects/personal-site/adrs/038-content-graph.md")).toContain(
      "https://robbiepalmer.me/projects/personal-knowledge-graph/adrs/038-content-graph.md",
    );
  });

  it("generates a markdown twin for every project HTML page", () => {
    const projectDirs = fs
      .readdirSync(path.join(OUT_DIR, "projects"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory());
    for (const dir of projectDirs) {
      expect(
        fs.existsSync(path.join(OUT_DIR, "projects", `${dir.name}.md`)),
        `projects/${dir.name}.md`,
      ).toBe(true);
    }
  });

  it("generates a markdown twin for every initiative page", () => {
    const htmlPages = fs
      .readdirSync(path.join(OUT_DIR, "initiatives"))
      .filter((file) => file.endsWith(".html"));
    expect(htmlPages.length).toBeGreaterThan(0);
    for (const htmlPage of htmlPages) {
      const mdPage = htmlPage.replace(/\.html$/, ".md");
      expect(
        fs.existsSync(path.join(OUT_DIR, "initiatives", mdPage)),
        `initiatives/${mdPage}`,
      ).toBe(true);
    }
  });

  it("generates a markdown twin for every technology page", () => {
    const htmlPages = fs
      .readdirSync(path.join(OUT_DIR, "technologies"))
      .filter((file) => file.endsWith(".html"));
    expect(htmlPages.length).toBeGreaterThan(0);
    for (const htmlPage of htmlPages) {
      const mdPage = htmlPage.replace(/\.html$/, ".md");
      expect(
        fs.existsSync(path.join(OUT_DIR, "technologies", mdPage)),
        `technologies/${mdPage}`,
      ).toBe(true);
    }
  });

  it("keeps runtime-backed app pages out of agent markdown outputs", () => {
    for (const page of [
      "cooks",
      "log",
      "notifications",
      "offline",
      "onboarding",
      "profile",
      "settings",
    ]) {
      expect(fs.existsSync(path.join(OUT_DIR, "recipes", `${page}.md`))).toBe(
        false,
      );
      expect(read("llms.txt")).not.toContain(`/recipes/${page}`);
      expect(read("llms-full.txt")).not.toContain(`/recipes/${page}`);
    }
  });

  it("leaves recipe detail representations to the runtime function", () => {
    const recipeFiles = fs.readdirSync(path.join(OUT_DIR, "recipes"));
    expect(
      recipeFiles.filter((file) => /\.(md|json|cook)$/.test(file)),
    ).toEqual([]);
    expect(
      recipeFiles
        .filter((file) => file.endsWith(".html"))
        .map((file) => file.replace(/\.html$/, ""))
        .filter((page) => !RECIPE_APP_PAGES.has(page)),
    ).toEqual([]);
  });

  it("scopes the middleware to page routes in _routes.json", () => {
    const routes = JSON.parse(read("_routes.json"));
    expect(routes.include).toContain("/.well-known/agent-configuration");
    expect(routes.include).toContain("/api/auth/*");
    expect(routes.include).toContain("/api/profile/*");
    expect(routes.include).toContain("/api/households");
    expect(routes.include).toContain("/api/households/*");
    expect(routes.include).toContain("/api/notifications");
    expect(routes.include).toContain("/api/notifications/*");
    expect(routes.include).toContain("/api/pantry");
    expect(routes.include).toContain("/api/pantry/*");
    expect(routes.include).toContain("/api/shopping-lists");
    expect(routes.include).toContain("/api/shopping-lists/*");
    expect(routes.include).toContain("/api/recipes");
    expect(routes.include).toContain("/api/recipes/*");
    expect(routes.include).toContain("/api/recipe-imports");
    expect(routes.include).toContain("/api/recipe-imports/*");
    expect(routes.include).toContain("/ingest/*");
    expect(routes.include).toContain("/llms.txt");
    expect(routes.include).toContain("/llms-full.txt");
    expect(routes.include).toContain("/sitemap.xml");
    expect(routes.include).toContain("/satellite-swarm");
    expect(routes.include).toContain("/projects/*");
    expect(routes.include).toContain("/initiatives/*");
    expect(routes.include).toContain("/ideas/*");
    expect(routes.exclude).toContain("/_next/*");
    expect(routes.include.length + routes.exclude.length).toBeLessThanOrEqual(
      100,
    );
  });

  it("links every llms.txt entry to a generated file", () => {
    const llms = read("llms.txt");
    const urls = [...llms.matchAll(/\(https:\/\/robbiepalmer\.me(\/[^)]+)\)/g)]
      .map((match) => match[1])
      .filter((urlPath): urlPath is string =>
        Boolean(urlPath?.endsWith(".md")),
      );
    expect(urls.length).toBeGreaterThan(10);
    for (const urlPath of urls) {
      expect(fs.existsSync(path.join(OUT_DIR, urlPath.slice(1))), urlPath).toBe(
        true,
      );
    }
  });

  it("contains no leftover MDX syntax in generated markdown", () => {
    const sample = ["projects.md", "blog.md", "experience.md"];
    for (const file of sample) {
      const content = read(file);
      expect(content, file).not.toMatch(/^import .* from/m);
    }
  });

  it("renders migrated project ADRs as local records", () => {
    const localAdr = read(
      "projects/agent-friendly-remote-development/adrs/001-nixos-host.md",
    );
    expect(localAdr).not.toContain("## Source summary");
    expect(localAdr).not.toContain("Inherited from project");
    expect(localAdr.match(/# Project-specific context/g)).toHaveLength(1);
  });

  it("advertises markdown alternates for entry pages in _headers", () => {
    const headers = read("_headers");
    expect(headers).toContain("/projects");
    expect(headers).toContain(
      'Link: <https://robbiepalmer.me/projects.md>; rel="alternate"; type="text/markdown"',
    );
    expect(headers).toContain(
      'Link: <https://robbiepalmer.me/satellite-swarm.md>; rel="alternate"; type="text/markdown"',
    );
    const ruleCount = (headers.match(/^ {2}Link:/gm) ?? []).length;
    expect(ruleCount).toBeLessThanOrEqual(100);
  });

  it("preserves the global security headers in the generated _headers file", () => {
    const headers = read("_headers");
    expect(headers).toContain("Content-Security-Policy: default-src 'self'");
    expect(headers).toContain("frame-ancestors 'none'");
    expect(headers).toContain("Strict-Transport-Security: max-age=31536000");
    expect(headers).toContain("X-Content-Type-Options: nosniff");
    expect(headers).toContain("X-Frame-Options: DENY");
  });

  it("merges the PostHog alternate link into its security exception", () => {
    const headers = read("_headers");
    const posthogRules = headers.match(/^\/posthog$/gm) ?? [];
    const posthogRule = headers.split("/posthog\n")[1]?.split("\n\n")[0];

    expect(posthogRules).toHaveLength(1);
    expect(posthogRule).toContain("! X-Frame-Options");
    expect(posthogRule).toContain("frame-ancestors 'self'");
    expect(posthogRule).toContain("https://a.storyblok.com");
    expect(posthogRule).toContain("https://res.cloudinary.com");
    expect(posthogRule).toContain("https://ugc.production.linktr.ee");
    expect(posthogRule).toContain(
      'Link: <https://robbiepalmer.me/posthog.md>; rel="alternate"; type="text/markdown"',
    );
  });
});
