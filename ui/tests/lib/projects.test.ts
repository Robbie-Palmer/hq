import { describe, expect, it } from "vitest";
import {
  getAllADRs,
  getAllProjectAliasADRPaths,
  getAllProjectAliases,
  getAllProjectSlugs,
  getAllProjects,
  getProject,
  getProjectADR,
} from "@/lib/api/projects";

/**
 * Projects tests - Integration tests for domain-backed project functions
 *
 * These tests verify that the project functions correctly use the domain repository.
 * The domain repository handles all validation, security, and file loading.
 * See tests/lib/domain/repository.test.ts for detailed validation tests.
 */
describe("Projects functions", () => {
  describe("getAllProjectSlugs", () => {
    it("should return array of project slugs", () => {
      const slugs = getAllProjectSlugs();
      expect(Array.isArray(slugs)).toBe(true);
      // Verify slugs are valid
      for (const slug of slugs) {
        expect(slug).toMatch(/^[a-z0-9_-]+$/);
      }
    });

    it("should return at least one project", () => {
      const slugs = getAllProjectSlugs();
      expect(slugs.length).toBeGreaterThan(0);
    });
  });

  describe("getProject", () => {
    it("resolves the previous Personal Site slug", () => {
      expect(getAllProjectAliases()).toContainEqual({
        alias: "personal-site",
        target: "personal-knowledge-graph",
      });
      expect(getProject("personal-site")).toMatchObject({
        slug: "personal-knowledge-graph",
        title: "Personal Knowledge Graph",
      });
      expect(getAllProjectAliasADRPaths()).toContainEqual({
        alias: "personal-site",
        target: "personal-knowledge-graph",
        adrSlug: "048-sonarqube",
      });
    });

    it("loads an optional project pitch deck", () => {
      const project = getProject("agentic-code-review");

      expect(project.pitch).toMatchObject({
        title: "Agentic Code Review pitch",
      });
      expect(project.pitch?.content).toContain("<PitchNotes>");
      expect(project.pitch?.content).not.toContain("integration test");
      expect(project.pitch?.content).not.toContain("<ReviewDepthDemo />");
    });

    it("loads published research paper metadata", () => {
      const project = getProject("autonomic-satellite-swarm");

      expect(project.paperUrl).toBe(
        "https://doi.org/10.1109/SMC-IT.2019.00015",
      );
      expect(project.paperTitle).toBe(
        "Autonomic Providing Pre-Programmed Death of Cubesats for Avoiding Space JUNK",
      );
    });

    it("should return project with all required fields", () => {
      const slugs = getAllProjectSlugs();
      expect(slugs.length).toBeGreaterThan(0);

      const project = getProject(slugs[0] ?? "");

      // Verify all required fields exist
      expect(project.slug).toBe(slugs[0]);
      expect(typeof project.title).toBe("string");
      expect(project.title.length).toBeGreaterThan(0);
      expect(typeof project.description).toBe("string");
      expect(project.description.length).toBeGreaterThan(0);
      expect(typeof project.date).toBe("string");
      expect(project.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Array.isArray(project.technologies)).toBe(true);
      expect(typeof project.content).toBe("string");
      expect(Array.isArray(project.adrs)).toBe(true);
      expect([
        "idea",
        "in_progress",
        "live",
        "archived",
        "completed",
      ]).toContain(project.status);
    });

    it("should throw error for non-existent project", () => {
      expect(() => getProject("non-existent-project-12345")).toThrow(
        "Project not found",
      );
    });

    it("should include ADRs for the project", () => {
      const slugs = getAllProjectSlugs();
      const project = getProject(slugs[0] ?? "");

      // Verify ADRs structure (card views don't have content)
      for (const adr of project.adrs) {
        expect(typeof adr.slug).toBe("string");
        expect(typeof adr.title).toBe("string");
        expect(typeof adr.date).toBe("string");
        expect(adr.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(["Accepted", "Rejected", "Deprecated", "Proposed"]).toContain(
          adr.status,
        );
        expect(typeof adr.readingTime).toBe("string");
        expect(Array.isArray(adr.technologies)).toBe(true);
      }
    });

    it("should dedupe technologies shared across multiple accepted ADRs", () => {
      const project = getProject("recipe-site");
      const names = project.technologies.map((t) => t.name);
      expect(names.filter((n) => n === "Better Auth")).toHaveLength(1);
      expect(names.filter((n) => n === "Cloudflare Workers")).toHaveLength(1);
    });

    it("should include technologies from accepted ADRs", () => {
      const project = getProject("personal-knowledge-graph");
      const acceptedADRs = project.adrs.filter(
        (adr) => adr.status === "Accepted",
      );
      expect(acceptedADRs.length).toBeGreaterThan(0);
      const adrTechnologies = acceptedADRs.flatMap((adr) =>
        adr.technologies.map((t) => t.name),
      );
      expect(adrTechnologies.length).toBeGreaterThan(0);
      const projectTechNames = project.technologies.map((t) => t.name);
      for (const tech of adrTechnologies) {
        expect(projectTechNames).toContain(tech);
      }
    });
  });

  describe("getAllProjects", () => {
    it("should return array of all projects", () => {
      const projects = getAllProjects();
      expect(Array.isArray(projects)).toBe(true);
      expect(projects.length).toBeGreaterThan(0);
    });

    it("should return projects sorted by date (newest first)", () => {
      const projects = getAllProjects();
      if (projects.length < 2) {
        // Not enough projects to test sorting
        return;
      }

      for (let i = 0; i < projects.length - 1; i++) {
        const currentDate = new Date(projects[i]?.date ?? "").getTime();
        const nextDate = new Date(projects[i + 1]?.date ?? "").getTime();
        expect(currentDate).toBeGreaterThanOrEqual(nextDate);
      }
    });

    it("should return all projects from getAllProjectSlugs", () => {
      const slugs = getAllProjectSlugs();
      const projects = getAllProjects();

      expect(projects.length).toBe(slugs.length);

      const projectSlugs = projects.map((p) => p.slug);
      for (const slug of slugs) {
        expect(projectSlugs).toContain(slug);
      }
    });

    it("should include project technologies", () => {
      const projects = getAllProjects();
      const projectWithTech = projects.find((p) => p.technologies.length > 0);
      expect(projectWithTech).toBeDefined();
      if (!projectWithTech) return;
      expect(projectWithTech.technologies.length).toBeGreaterThan(0);
      for (const tech of projectWithTech.technologies) {
        expect(typeof tech.name).toBe("string");
        expect(tech.name.length).toBeGreaterThan(0);
      }
    });

    it("should not include duplicate technologies", () => {
      const projects = getAllProjects();
      for (const project of projects) {
        const slugs = project.technologies.map((t) => t.slug);
        const uniqueSlugs = new Set(slugs);
        expect(slugs.length).toBe(uniqueSlugs.size);
      }
    });

    it("loads the current project statuses and Ulster University role", () => {
      expect(getProject("homelab").status).toBe("live");
      expect(getProject("agentic-code-review").status).toBe("live");
      expect(getProject("autonomic-satellite-swarm").role?.company).toBe(
        "Ulster University",
      );
    });
  });

  describe("getProjectADR", () => {
    it("should return specific ADR from project", () => {
      const projects = getAllProjects();
      const projectWithLocalADRs = projects.find((p) =>
        p.adrs.some((adr) => adr.originProjectSlug === p.slug),
      );

      if (!projectWithLocalADRs) {
        // Skip if no projects have ADRs
        return;
      }

      const firstADR = projectWithLocalADRs.adrs.find(
        (adr) => adr.originProjectSlug === projectWithLocalADRs.slug,
      );
      if (!firstADR) {
        return;
      }

      const adr = getProjectADR(projectWithLocalADRs.slug, firstADR.slug);

      expect(adr.slug).toBe(firstADR.slug);
      expect(adr.title).toBe(firstADR.title);
      expect(adr.date).toBe(firstADR.date);
      expect(adr.status).toBe(firstADR.status);
    });

    it("should throw error for non-existent ADR", () => {
      const slugs = getAllProjectSlugs();
      if (slugs.length === 0) {
        return;
      }

      expect(() =>
        getProjectADR(slugs[0] ?? "", "non-existent-adr-12345"),
      ).toThrow("ADR not found");
    });

    it("resolves a legacy ADR URL to its canonical record", () => {
      expect(
        getProjectADR("recipe-site", "000-github-public-repo"),
      ).toMatchObject({
        projectSlug: "personal-knowledge-graph",
        slug: "000-github-public-repo",
        adrRef: "personal-knowledge-graph:000-github-public-repo",
      });
    });

    it.each([
      [
        "agentic-code-review",
        "031-custom-agentic-code-review",
        "000-custom-agentic-code-review",
      ],
      [
        "recipe-site",
        "067-versioned-ingredient-density-catalog-and-source-ingestion",
        "025-versioned-ingredient-density-catalog-and-source-ingestion",
      ],
    ])(
      "resolves the former canonical URL %s:%s after sequence compaction",
      (projectSlug, legacySlug, canonicalSlug) => {
        expect(getProjectADR(projectSlug, legacySlug)).toMatchObject({
          projectSlug,
          slug: canonicalSlug,
          adrRef: `${projectSlug}:${canonicalSlug}`,
        });
      },
    );

    it("should throw error if ADR is requested from a different project route", () => {
      const projects = getAllProjects();
      if (projects.length < 2) {
        // Need at least 2 projects
        return;
      }

      const project1 = projects[0];
      const project2 = projects[1];
      const adr = project1?.adrs[0];

      if (!adr || !project2) {
        return;
      }

      // Try to get project1's ADR using project2's slug
      expect(() => getProjectADR(project2.slug, adr.slug)).toThrow(
        "ADR not found",
      );
    });

    it("should resolve inherited ADR in child project context", () => {
      const projects = getAllProjects();
      const projectWithInherited = projects.find((p) =>
        p.adrs.some((adr) => adr.isInherited),
      );

      if (!projectWithInherited) {
        return;
      }

      const inheritedADR = projectWithInherited.adrs.find(
        (adr) => adr.isInherited,
      );
      if (!inheritedADR) {
        return;
      }

      const adr = getProjectADR(projectWithInherited.slug, inheritedADR.slug);
      expect(adr.isInherited).toBe(true);
      expect(adr.projectSlug).toBe(projectWithInherited.slug);
      expect(adr.originProjectSlug).not.toBe(projectWithInherited.slug);
      expect(typeof adr.inheritedSourceSummary).toBe("string");
    });
  });

  describe("getAllADRs", () => {
    it("should return all ADRs across all projects", () => {
      const adrs = getAllADRs();
      expect(Array.isArray(adrs)).toBe(true);
    });

    it("should include project context in each ADR", () => {
      const adrs = getAllADRs();

      if (adrs.length === 0) {
        // No ADRs to test
        return;
      }

      for (const adr of adrs) {
        expect(typeof adr.projectSlug).toBe("string");
        expect(typeof adr.projectTitle).toBe("string");
        expect(adr.projectSlug.length).toBeGreaterThan(0);
        expect(adr.projectTitle.length).toBeGreaterThan(0);
      }
    });

    it("should return ADRs sorted by date (newest first)", () => {
      const adrs = getAllADRs();
      if (adrs.length < 2) {
        return;
      }

      for (let i = 0; i < adrs.length - 1; i++) {
        const currentDate = new Date(adrs[i]?.date ?? "").getTime();
        const nextDate = new Date(adrs[i + 1]?.date ?? "").getTime();
        expect(currentDate).toBeGreaterThanOrEqual(nextDate);
      }
    });
  });
});
