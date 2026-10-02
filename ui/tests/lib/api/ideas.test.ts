import { describe, expect, it } from "vitest";
import {
  getAllIdeaSlugs,
  getAllIdeas,
  getIdea,
  getIdeasForADR,
  getIdeasForBlog,
  getIdeasForProject,
} from "@/lib/api/ideas";

describe("ideas API", () => {
  it("lists every idea with canonical reference counts", () => {
    expect(getAllIdeaSlugs()).toHaveLength(33);

    const ideas = getAllIdeas();
    expect(ideas.map((idea) => idea.title)).toEqual(
      [...ideas.map((idea) => idea.title)].sort((a, b) => a.localeCompare(b)),
    );
    expect(ideas).toContainEqual(
      expect.objectContaining({
        slug: "goodharts-law",
        referenceCount: 12,
      }),
    );
  });

  it("loads one idea with related ideas and backlinks", () => {
    const idea = getIdea("goodharts-law");
    if (!idea) throw new Error("Expected Goodhart's Law to exist");

    expect(idea.relatedIdeas.map((related) => related.slug)).toEqual([
      "adaptive-planning",
      "dora-metrics",
      "jevons-paradox",
    ]);
    expect(idea.relatedContent.projects.map((project) => project.slug)).toEqual(
      ["agentic-code-review"],
    );
    expect(idea.relatedContent.blogs.map((post) => post.slug)).toEqual([
      "2026-08-18-crossing-the-chasm-with-ai-platform-teams",
    ]);
    expect(idea.relatedContent.adrs).toHaveLength(7);
    expect(idea.relatedContent.adrs).toContainEqual(
      expect.objectContaining({
        slug: "048-zizmor",
        projectSlug: "personal-knowledge-graph",
      }),
    );
  });

  it("derives technology backlinks from technology-to-idea relations", () => {
    const idea = getIdea("write-ahead-log");
    if (!idea) throw new Error("Expected Write-Ahead Log to exist");

    expect(
      idea.relatedContent.technologies.map((technology) => technology.slug),
    ).toEqual(["kafka", "neon", "postgresql"]);

    const commitLog = getIdea("commit-log");
    if (!commitLog) throw new Error("Expected Commit Log to exist");
    expect(
      commitLog.relatedContent.technologies.map(
        (technology) => technology.slug,
      ),
    ).toEqual(["kafka"]);
  });

  it("finds ideas attached to projects, posts, and ADRs", () => {
    expect(
      getIdeasForProject("agentic-code-review").map((idea) => idea.slug),
    ).toEqual(["dora-metrics", "goodharts-law"]);
    expect(
      getIdeasForProject("autonomic-satellite-swarm").map((idea) => idea.slug),
    ).toEqual(["flp-impossibility", "two-generals-problem"]);
    expect(
      getIdeasForProject("intelligent-document-processing").map(
        (idea) => idea.slug,
      ),
    ).toEqual([
      "domain-driven-design",
      "human-in-the-loop",
      "intelligent-document-processing",
      "ner",
      "nlp",
      "ocr",
      "ontology-engineering",
    ]);
    expect(
      getIdeasForProject("commercial-knowledge-graph").map((idea) => idea.slug),
    ).toEqual([
      "intelligent-document-processing",
      "nlp",
      "ocr",
      "ontology-engineering",
    ]);
    expect(
      getIdeasForProject("pii-detection").map((idea) => idea.slug),
    ).toEqual(["ner", "nlp"]);
    expect(
      getIdeasForProject("real-time-multi-camera-video-analytics").map(
        (idea) => idea.slug,
      ),
    ).toEqual(["data-mesh", "human-on-the-loop"]);
    expect(
      getIdeasForBlog(
        "2026-08-18-crossing-the-chasm-with-ai-platform-teams",
      ).map((idea) => idea.slug),
    ).toEqual(["goodharts-law", "reverse-conway-maneuver"]);
    expect(
      getIdeasForBlog("2022-03-02-the-philosophy-of-data-science").map(
        (idea) => idea.slug,
      ),
    ).toEqual([
      "bounded-context",
      "data-mesh",
      "domain-driven-design",
      "epistemology",
      "falsifiability",
      "incommensurability",
      "paradigm-shift",
      "postpositivism",
      "theory-ladenness",
    ]);
    expect(
      getIdeasForBlog(
        "2023-03-28-uniting-machine-learning-data-streaming-1",
      ).map((idea) => idea.slug),
    ).toEqual(["bounded-context", "conways-law", "data-mesh"]);
    expect(
      getIdeasForBlog(
        "2023-05-23-automatically-detect-pii-real-time-cyber-defense",
      ).map((idea) => idea.slug),
    ).toEqual(["ner", "nlp"]);
    expect(
      getIdeasForADR("recipe-site:002-openrouter").map((idea) => idea.slug),
    ).toEqual(["intelligent-document-processing", "nlp", "ocr"]);
    expect(
      getIdeasForADR("recipe-site:026-food-ontology-alignment").map(
        (idea) => idea.slug,
      ),
    ).toEqual(["ontology-engineering"]);
    expect(
      getIdeasForADR("recipe-site:009-sonarqube").map((idea) => idea.slug),
    ).toEqual(["goodharts-law"]);
  });

  it("returns null and empty links for unknown content", () => {
    expect(getIdea("missing")).toBeNull();
    expect(getIdeasForProject("missing")).toEqual([]);
    expect(getIdeasForBlog("missing")).toEqual([]);
    expect(getIdeasForADR("missing:001")).toEqual([]);
  });
});
