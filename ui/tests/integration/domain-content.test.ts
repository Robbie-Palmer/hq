import { beforeAll, describe, expect, it } from "vitest";
import { extractGraphData } from "@/lib/api/graph-data";
import {
  type DomainRepository,
  getADRSlugsForProject,
  getInitiativesForProject,
  getProjectForADR,
  getProjectsForInitiative,
  getTechnologiesForADR,
  getTechnologiesForProject,
  getTechnologiesForRole,
  loadDomainRepository,
} from "@/lib/repository";

/**
 * Integration test: Validate all real content against domain models
 *
 * loadDomainRepository() already validates all content against Zod schemas
 * and checks referential integrity (throwing on any errors). These tests
 * verify content loaded successfully and that bidirectional relations
 * were built correctly.
 */
describe("Domain Content Validation (Integration)", () => {
  let repo: DomainRepository;

  beforeAll(() => {
    // Throws if any schema validation or referential integrity check fails
    repo = loadDomainRepository();
  });

  it("should load all content and pass validation", () => {
    expect(repo.blogs.size).toBeGreaterThan(0);
    expect(repo.projects.size).toBeGreaterThan(0);
    expect(repo.initiatives.size).toBeGreaterThan(0);
    expect(repo.adrs.size).toBeGreaterThan(0);
    expect(repo.roles.size).toBeGreaterThan(0);
    expect(repo.technologies.size).toBeGreaterThan(0);
    expect(repo.ideas.size).toBe(28);
    expect(repo.referentialIntegrityErrors).toEqual([]);
  });

  it("should explain every technology page", () => {
    for (const technology of repo.technologies.values()) {
      expect(technology.description, technology.name).toMatch(/\S/);
    }
  });

  it("should connect technologies to the ideas they build on or expose", () => {
    expect(repo.graph.edges.technologyIdeas.get("kafka")).toEqual(
      new Set(["commit-log", "stream-table-duality", "write-ahead-log"]),
    );
    expect(repo.graph.reverse.ideaTechnologies.get("commit-log")).toEqual(
      new Set(["kafka"]),
    );
    expect(repo.graph.reverse.ideaTechnologies.get("write-ahead-log")).toEqual(
      new Set(["kafka", "postgresql", "neon"]),
    );
    expect(
      repo.graph.reverse.ideaTechnologies.get("context-engineering"),
    ).toEqual(new Set(["basic-memory"]));
    expect(repo.graph.reverse.ideaTechnologies.get("feature-stores")).toEqual(
      new Set(["google-bigquery"]),
    );
    expect(
      repo.graph.reverse.ideaTechnologies.get("feature-engineering"),
    ).toEqual(new Set(["google-bigquery"]));
    expect(repo.graph.edges.relatedIdea.get("context-engineering")).toContain(
      "feature-engineering",
    );
    expect(repo.graph.edges.relatedIdea.get("feature-engineering")).toContain(
      "context-engineering",
    );
  });

  it("should have bidirectional idea references in the graph", () => {
    for (const [nodeId, ideaSlugs] of repo.graph.edges.referencesIdea) {
      for (const ideaSlug of ideaSlugs) {
        expect(repo.graph.reverse.ideaReferencedBy.get(ideaSlug)).toContain(
          nodeId,
        );
      }
    }
    for (const [ideaSlug, nodeIds] of repo.graph.reverse.ideaReferencedBy) {
      for (const nodeId of nodeIds) {
        expect(repo.graph.edges.referencesIdea.get(nodeId)).toContain(ideaSlug);
      }
    }
    expect(
      repo.graph.reverse.ideaReferencedBy.get("goodharts-law")?.size,
    ).toBeGreaterThan(0);
    expect(repo.graph.reverse.ideaReferencedBy.get("eventstorming")?.size).toBe(
      0,
    );
  });

  it("should connect personalized medicine projects across roles", () => {
    const initiativeSlug = "personalized-medicine";
    const projectSlugs = getProjectsForInitiative(repo.graph, initiativeSlug);

    expect(projectSlugs).toEqual(
      new Set([
        "ai-assisted-macrodissection",
        "automated-macrodissection",
        "bioinformatics-platform",
        "genomic-prediction",
        "pathology-viewer",
      ]),
    );
    for (const projectSlug of projectSlugs) {
      expect(getInitiativesForProject(repo.graph, projectSlug)).toContain(
        initiativeSlug,
      );
      expect(
        repo.initiatives.get(initiativeSlug)?.projectContributions[projectSlug],
      ).toBeTruthy();
    }
  });

  it("should publish research papers as linked knowledge graph nodes", () => {
    const graph = extractGraphData(repo);

    expect(graph.nodes).toContainEqual({
      id: "paper:autonomic-satellite-swarm",
      name: "Autonomic Providing Pre-Programmed Death of Cubesats for Avoiding Space JUNK",
      type: "paper",
      href: "https://doi.org/10.1109/SMC-IT.2019.00015",
      connections: 1,
    });
    expect(graph.edges).toContainEqual({
      source: "project:autonomic-satellite-swarm",
      target: "paper:autonomic-satellite-swarm",
      type: "HAS_RESEARCH_PAPER",
    });
  });

  it("should have bidirectional technology relations in graph", () => {
    // For each project, verify that the graph has reverse references
    for (const [projectSlug] of repo.projects) {
      const techSlugs = getTechnologiesForProject(repo.graph, projectSlug);
      for (const techSlug of techSlugs) {
        const usedBy = repo.graph.reverse.technologyUsedBy.get(techSlug);
        expect(
          usedBy?.has(`project:${projectSlug}`),
          `Tech ${techSlug} should reference project ${projectSlug} in graph`,
        ).toBe(true);
      }
    }

    // For each ADR, verify that the graph has reverse references
    for (const [adrSlug] of repo.adrs) {
      const techSlugs = getTechnologiesForADR(repo.graph, adrSlug);
      for (const techSlug of techSlugs) {
        const usedBy = repo.graph.reverse.technologyUsedBy.get(techSlug);
        expect(
          usedBy?.has(`adr:${adrSlug}`),
          `Tech ${techSlug} should reference ADR ${adrSlug} in graph`,
        ).toBe(true);
      }
    }

    // For each role, verify that the graph has reverse references
    for (const [roleSlug] of repo.roles) {
      const techSlugs = getTechnologiesForRole(repo.graph, roleSlug);
      for (const techSlug of techSlugs) {
        const usedBy = repo.graph.reverse.technologyUsedBy.get(techSlug);
        expect(
          usedBy?.has(`role:${roleSlug}`),
          `Tech ${techSlug} should reference role ${roleSlug} in graph`,
        ).toBe(true);
      }
    }
  });

  it("should have consistent project-ADR relationships", () => {
    // For each project's ADRs, verify owner exists (can differ for inherited ADRs)
    for (const [projectSlug] of repo.projects) {
      const adrSlugs = getADRSlugsForProject(repo.graph, projectSlug);
      for (const adrSlug of adrSlugs) {
        const adrProject = getProjectForADR(repo.graph, adrSlug);
        expect(
          adrProject,
          `ADR ${adrSlug} should have an owning project`,
        ).toBeDefined();
      }
    }

    // For each ADR, verify its project lists it
    for (const [adrSlug] of repo.adrs) {
      const projectSlug = getProjectForADR(repo.graph, adrSlug);
      expect(projectSlug).toBeDefined();
      const projectADRs = getADRSlugsForProject(repo.graph, projectSlug!);
      expect(
        projectADRs.includes(adrSlug),
        `Project ${projectSlug} should reference ADR ${adrSlug}`,
      ).toBe(true);
    }
  });
});
