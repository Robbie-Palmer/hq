import { describe, expect, it } from "vitest";
import {
  buildContentGraph,
  createEmptyRelationData,
  getADRsImplementingProductDecision,
  getBlogsForProductDecision,
  getContentReferencingIdea,
  getContentReferencingIdeaByType,
  getContentUsingTechnology,
  getContentUsingTechnologyByType,
  getIdeasForADR,
  getIdeasForBlog,
  getIdeasForProject,
  getIdeasForTechnology,
  getInitiativesForProject,
  getNodeSlug,
  getNodeType,
  getProjectForADR,
  getProjectsForInitiative,
  getProjectsForProductDecision,
  getRelatedIdeas,
  getSupersededADR,
  getSupersedingADR,
  getTechnologiesForADR,
  getTechnologiesForBlog,
  getTechnologiesForIdea,
  getTechnologiesForProject,
  getTechnologiesForRole,
  isNodeType,
  makeNodeId,
  parseNodeId,
} from "@/lib/repository";

describe("NodeId utilities", () => {
  it("makeNodeId creates correct format", () => {
    expect(makeNodeId("project", "personal-knowledge-graph")).toBe(
      "project:personal-knowledge-graph",
    );
    expect(makeNodeId("technology", "typescript")).toBe(
      "technology:typescript",
    );
  });

  it("parseNodeId extracts type and slug", () => {
    const parsed = parseNodeId("project:personal-knowledge-graph");
    expect(parsed.type).toBe("project");
    expect(parsed.slug).toBe("personal-knowledge-graph");
  });

  it("parseNodeId handles slugs with colons", () => {
    const parsed = parseNodeId("blog:2025-01-01-my:post");
    expect(parsed.type).toBe("blog");
    expect(parsed.slug).toBe("2025-01-01-my:post");
  });

  it("getNodeType returns correct type", () => {
    expect(getNodeType("project:test")).toBe("project");
    expect(getNodeType("adr:001")).toBe("adr");
  });

  it("getNodeSlug returns correct slug", () => {
    expect(getNodeSlug("project:personal-knowledge-graph")).toBe(
      "personal-knowledge-graph",
    );
  });

  it("isNodeType correctly identifies types", () => {
    const nodeId = makeNodeId("project", "test");
    expect(isNodeType(nodeId, "project")).toBe(true);
    expect(isNodeType(nodeId, "adr")).toBe(false);
  });
});

describe("buildContentGraph", () => {
  it("builds technology edges for projects", () => {
    const relations = createEmptyRelationData();
    relations.projectTechnologies.set("site", ["typescript", "react"]);

    const graph = buildContentGraph({
      technologySlugs: ["typescript", "react"],
      projectSlugs: ["site"],
      relations,
    });

    const techs = graph.edges.usesTechnology.get("project:site");
    expect(techs).toBeDefined();
    expect(techs?.has("typescript")).toBe(true);
    expect(techs?.has("react")).toBe(true);
  });

  it("builds initiative-project edges", () => {
    const relations = createEmptyRelationData();
    relations.projectInitiatives.set("site", ["software-development"]);

    const graph = buildContentGraph({
      technologySlugs: [],
      initiativeSlugs: ["software-development"],
      projectSlugs: ["site"],
      relations,
    });

    expect(
      getInitiativesForProject(graph, "site").has("software-development"),
    ).toBe(true);
    expect(
      getProjectsForInitiative(graph, "software-development").has("site"),
    ).toBe(true);
  });

  it("builds reverse edges for technologies", () => {
    const relations = createEmptyRelationData();
    relations.projectTechnologies.set("site", ["typescript"]);
    relations.adrTechnologies.set("001", ["typescript"]);
    relations.adrProject.set("001", "site");
    relations.blogTechnologies.set("post", ["typescript"]);
    relations.roleTechnologies.set("eng", ["typescript"]);

    const graph = buildContentGraph({
      technologySlugs: ["typescript"],
      projectSlugs: ["site"],
      relations,
    });

    const usedBy = graph.reverse.technologyUsedBy.get("typescript");
    expect(usedBy).toBeDefined();
    expect(usedBy?.has("project:site")).toBe(true);
    expect(usedBy?.has("adr:001")).toBe(true);
    expect(usedBy?.has("blog:post")).toBe(true);
    expect(usedBy?.has("role:eng")).toBe(true);
  });

  it("builds ADR-project edges", () => {
    const relations = createEmptyRelationData();
    relations.adrProject.set("001", "site");
    relations.adrProject.set("002", "site");

    const graph = buildContentGraph({
      technologySlugs: [],
      projectSlugs: ["site"],
      relations,
    });

    expect(graph.edges.partOfProject.get("001")).toBe("site");
    expect(graph.edges.partOfProject.get("002")).toBe("site");
    expect(graph.reverse.projectADRs.get("site")?.has("001")).toBe(true);
    expect(graph.reverse.projectADRs.get("site")?.has("002")).toBe(true);
  });

  it("builds supersedes edges", () => {
    const relations = createEmptyRelationData();
    relations.adrProject.set("001", "site");
    relations.adrProject.set("002", "site");
    relations.adrSupersedes.set("002", "001");

    const graph = buildContentGraph({
      technologySlugs: [],
      projectSlugs: ["site"],
      relations,
    });

    expect(graph.edges.supersedes.get("002")).toBe("001");
    expect(graph.reverse.supersededBy.get("001")).toBe("002");
  });

  it("builds forward and reverse product-decision edges", () => {
    const relations = createEmptyRelationData();
    relations.productDecisionAffectedProjects.set("001-publication", ["site"]);
    relations.productDecisionIdeas.set("001-publication", [
      "context-engineering",
    ]);
    relations.productDecisionInformedByADRs.set("001-publication", [
      "site:001-static-generation",
    ]);
    relations.productDecisionEvidence.set("001-publication", [
      { title: "Reader study", url: "https://example.com/study" },
    ]);
    relations.adrImplementsProductDecisions.set("site:002-markdown", [
      "001-publication",
    ]);
    relations.blogProductDecisions.set("shipping-markdown", [
      "001-publication",
    ]);

    const graph = buildContentGraph({
      technologySlugs: [],
      projectSlugs: ["site"],
      ideaSlugs: ["context-engineering"],
      relations,
    });

    expect(getProjectsForProductDecision(graph, "001-publication")).toEqual(
      new Set(["site"]),
    );
    expect(
      getADRsImplementingProductDecision(graph, "001-publication"),
    ).toEqual(new Set(["site:002-markdown"]));
    expect(getBlogsForProductDecision(graph, "001-publication")).toEqual(
      new Set(["shipping-markdown"]),
    );
    expect(
      graph.reverse.adrInformedProductDecisions.get(
        "site:001-static-generation",
      ),
    ).toEqual(new Set(["001-publication"]));
    expect(graph.edges.productDecisionEvidence.get("001-publication")).toEqual([
      { title: "Reader study", url: "https://example.com/study" },
    ]);
  });

  it("builds inherits-from edges", () => {
    const relations = createEmptyRelationData();
    relations.adrProject.set("site:014-ssg", "site");
    relations.adrProject.set("recipe:014-ssg", "recipe");
    relations.adrInheritsFrom.set("recipe:014-ssg", "site:014-ssg");

    const graph = buildContentGraph({
      technologySlugs: [],
      projectSlugs: ["site", "recipe"],
      relations,
    });

    expect(graph.edges.inheritsFrom.get("recipe:014-ssg")).toBe("site:014-ssg");
    expect(
      graph.reverse.inheritedBy.get("site:014-ssg")?.has("recipe:014-ssg"),
    ).toBe(true);
  });

  it("builds tag edges for blogs", () => {
    const relations = createEmptyRelationData();
    relations.blogTags.set("post", ["javascript", "react"]);

    const graph = buildContentGraph({
      technologySlugs: [],
      projectSlugs: [],
      relations,
    });

    expect(graph.edges.hasTag.get("blog:post")?.has("javascript")).toBe(true);
    expect(graph.edges.hasTag.get("blog:post")?.has("react")).toBe(true);
    expect(graph.reverse.tagUsedBy.get("javascript")?.has("blog:post")).toBe(
      true,
    );
  });

  it("builds project-initiative edges in both directions", () => {
    const relations = createEmptyRelationData();
    relations.projectInitiatives.set("pathology-viewer", [
      "personalized-medicine",
    ]);

    const graph = buildContentGraph({
      technologySlugs: [],
      projectSlugs: ["pathology-viewer"],
      initiativeSlugs: ["personalized-medicine"],
      relations,
    });

    expect(
      graph.edges.contributesToInitiative
        .get("pathology-viewer")
        ?.has("personalized-medicine"),
    ).toBe(true);
    expect(
      graph.reverse.initiativeProjects
        .get("personalized-medicine")
        ?.has("pathology-viewer"),
    ).toBe(true);
  });
});

describe("graph queries", () => {
  const relations = createEmptyRelationData();
  relations.projectTechnologies.set("site", ["typescript", "react"]);
  relations.adrTechnologies.set("001", ["typescript"]);
  relations.adrProject.set("001", "site");
  relations.blogTechnologies.set("post", ["react"]);
  relations.roleTechnologies.set("eng", ["typescript", "react"]);
  relations.projectInitiatives.set("site", ["connected-work"]);
  relations.projectIdeas.set("site", ["conways-law", "goodharts-law"]);
  relations.blogIdeas.set("post", ["conways-law"]);
  relations.adrIdeas.set("001", ["goodharts-law"]);
  relations.ideaRelatedIdeas.set("conways-law", ["reverse-conway-maneuver"]);
  relations.ideaRelatedIdeas.set("reverse-conway-maneuver", ["goodharts-law"]);
  relations.technologyIdeas.set("typescript", ["conways-law"]);

  const graph = buildContentGraph({
    technologySlugs: ["typescript", "react"],
    projectSlugs: ["site"],
    initiativeSlugs: ["connected-work"],
    ideaSlugs: ["conways-law", "reverse-conway-maneuver", "goodharts-law"],
    relations,
  });

  it("getTechnologiesForProject returns correct technologies", () => {
    const techs = getTechnologiesForProject(graph, "site");
    expect(techs.has("typescript")).toBe(true);
    expect(techs.has("react")).toBe(true);
  });

  it("getTechnologiesForADR returns correct technologies", () => {
    const techs = getTechnologiesForADR(graph, "001");
    expect(techs.has("typescript")).toBe(true);
    expect(techs.has("react")).toBe(false);
  });

  it("getTechnologiesForBlog returns correct technologies", () => {
    const techs = getTechnologiesForBlog(graph, "post");
    expect(techs.has("react")).toBe(true);
    expect(techs.has("typescript")).toBe(false);
  });

  it("getTechnologiesForRole returns correct technologies", () => {
    const techs = getTechnologiesForRole(graph, "eng");
    expect(techs.has("typescript")).toBe(true);
    expect(techs.has("react")).toBe(true);
  });

  it("queries technology-to-idea relationships in both directions", () => {
    expect(getIdeasForTechnology(graph, "typescript")).toEqual(
      new Set(["conways-law"]),
    );
    expect(getTechnologiesForIdea(graph, "conways-law")).toEqual(
      new Set(["typescript"]),
    );
  });

  it("getContentUsingTechnology returns all content using a tech", () => {
    const content = getContentUsingTechnology(graph, "typescript");
    expect(content.has("project:site")).toBe(true);
    expect(content.has("adr:001")).toBe(true);
    expect(content.has("role:eng")).toBe(true);
    expect(content.has("blog:post")).toBe(false);
  });

  it("getContentUsingTechnologyByType returns grouped content", () => {
    const content = getContentUsingTechnologyByType(graph, "typescript");
    expect(content.projects).toContain("site");
    expect(content.adrs).toContain("001");
    expect(content.roles).toContain("eng");
    expect(content.blogs).toHaveLength(0);
  });

  it("getProjectForADR returns correct project", () => {
    expect(getProjectForADR(graph, "001")).toBe("site");
  });

  it("queries project-initiative relationships", () => {
    expect(getInitiativesForProject(graph, "site")).toEqual(
      new Set(["connected-work"]),
    );
    expect(getProjectsForInitiative(graph, "connected-work")).toEqual(
      new Set(["site"]),
    );
  });

  it("queries ideas referenced by each content type", () => {
    expect(getIdeasForProject(graph, "site")).toEqual(
      new Set(["conways-law", "goodharts-law"]),
    );
    expect(getIdeasForBlog(graph, "post")).toEqual(new Set(["conways-law"]));
    expect(getIdeasForADR(graph, "001")).toEqual(new Set(["goodharts-law"]));
    expect(getIdeasForProject(graph, "missing")).toEqual(new Set());
  });

  it("queries content that references an idea", () => {
    expect(getContentReferencingIdea(graph, "conways-law")).toEqual(
      new Set(["project:site", "blog:post"]),
    );
    expect(getContentReferencingIdeaByType(graph, "goodharts-law")).toEqual({
      projects: ["site"],
      adrs: ["001"],
      blogs: [],
      productDecisions: [],
    });
    expect(getContentReferencingIdea(graph, "missing")).toEqual(new Set());
  });

  it("combines outgoing and incoming related ideas", () => {
    expect(getRelatedIdeas(graph, "reverse-conway-maneuver")).toEqual(
      new Set(["goodharts-law", "conways-law"]),
    );
    expect(getRelatedIdeas(graph, "missing")).toEqual(new Set());
  });

  it("supersedes queries work correctly", () => {
    const relations2 = createEmptyRelationData();
    relations2.adrProject.set("001", "site");
    relations2.adrProject.set("002", "site");
    relations2.adrSupersedes.set("002", "001");

    const graph2 = buildContentGraph({
      technologySlugs: [],
      projectSlugs: ["site"],
      relations: relations2,
    });

    expect(getSupersedingADR(graph2, "001")).toBe("002");
    expect(getSupersededADR(graph2, "002")).toBe("001");
  });

  it("returns empty set for non-existent entities", () => {
    expect(getTechnologiesForProject(graph, "nonexistent").size).toBe(0);
    expect(getContentUsingTechnology(graph, "nonexistent").size).toBe(0);
  });
});
