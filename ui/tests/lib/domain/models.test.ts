import { describe, expect, it } from "vitest";
import {
  ADRSchema,
  ADRStatusSchema,
  BlogPostSchema,
  IdeaSchema,
  InitiativeSchema,
  InitiativeStatusSchema,
  JobRoleSchema,
  ProjectSchema,
  ProjectStatusSchema,
  TechnologySchema,
} from "@/lib/domain/models";

describe("Domain Model Schemas", () => {
  describe("IdeaSchema", () => {
    it("validates an idea with related ideas", () => {
      const result = IdeaSchema.safeParse({
        slug: "conways-law",
        title: "Conway's Law",
        description: "Systems reflect communication structures.",
        sourceUrl: "https://example.com/conways-law",
        content: "A useful diagnostic.",
        relations: { relatedIdeas: ["reverse-conway-maneuver"] },
      });

      expect(result.success).toBe(true);
    });
  });

  describe("TechnologySchema", () => {
    it("should validate a complete technology object", () => {
      const validTech = {
        name: "React",
        description: "A JavaScript library for building user interfaces",
        website: "https://react.dev",
        iconSlug: "react",
        relations: {
          blogs: ["my-blog"],
          adrs: ["personal-knowledge-graph:001-react"],
          projects: ["my-project"],
          roles: ["microsoft-0"],
          ideas: ["component-composition"],
        },
      };

      const result = TechnologySchema.safeParse(validTech);
      expect(result.success).toBe(true);
    });

    it("should validate minimal technology object with defaults", () => {
      const minimalTech = {
        name: "TypeScript",
      };

      const result = TechnologySchema.safeParse(minimalTech);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.relations).toEqual({
          blogs: [],
          adrs: [],
          projects: [],
          roles: [],
          ideas: [],
        });
      }
    });

    it("should reject technology with invalid website URL", () => {
      const invalidTech = {
        name: "React",
        website: "not-a-valid-url",
        relations: {
          blogs: [],
          adrs: [],
          projects: [],
          roles: [],
        },
      };

      const result = TechnologySchema.safeParse(invalidTech);
      expect(result.success).toBe(false);
    });

    it("should reject technology with empty name", () => {
      const invalidTech = {
        name: "",
      };

      const result = TechnologySchema.safeParse(invalidTech);
      expect(result.success).toBe(false);
    });
  });

  describe("BlogPostSchema", () => {
    it("should validate a complete blog post", () => {
      const validPost = {
        slug: "my-blog-post",
        title: "My Blog Post",
        description: "An interesting article",
        date: "2025-10-19",
        updated: "2025-10-20",
        tags: ["tech", "programming"],
        canonicalUrl: "https://example.com/original",
        content: "# Blog Content",
        readingTime: "5 min read",
        image: "blog/my-post-2025-10-19",
        imageAlt: "Blog post cover image",
        relations: {
          technologies: ["react", "typescript"],
        },
      };

      const result = BlogPostSchema.safeParse(validPost);
      expect(result.success).toBe(true);
    });

    it("should validate minimal blog post with defaults", () => {
      const minimalPost = {
        slug: "minimal-post",
        title: "Minimal Post",
        description: "A minimal post",
        date: "2025-01-01",
        content: "Content",
        readingTime: "1 min read",
        image: "blog/minimal-2025-01-01",
        imageAlt: "Image",
      };

      const result = BlogPostSchema.safeParse(minimalPost);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tags).toEqual([]);
        expect(result.data.relations.technologies).toEqual([]);
      }
    });

    it("should reject blog post with invalid date format", () => {
      const invalidPost = {
        slug: "bad-date",
        title: "Bad Date",
        description: "Desc",
        date: "2025/10/19", // Wrong format
        content: "Content",
        readingTime: "1 min read",
        image: "blog/bad-2025-10-19",
        imageAlt: "Image",
      };

      const result = BlogPostSchema.safeParse(invalidPost);
      expect(result.success).toBe(false);
    });

    it("should reject blog post with invalid image ID format", () => {
      const invalidPost = {
        slug: "bad-image",
        title: "Bad Image",
        description: "Desc",
        date: "2025-10-19",
        content: "Content",
        readingTime: "1 min read",
        image: "invalid-format", // Wrong format
        imageAlt: "Image",
      };

      const result = BlogPostSchema.safeParse(invalidPost);
      expect(result.success).toBe(false);
    });

    it("should reject blog post with invalid canonical URL", () => {
      const invalidPost = {
        slug: "bad-url",
        title: "Bad URL",
        description: "Desc",
        date: "2025-10-19",
        canonicalUrl: "not-a-url",
        content: "Content",
        readingTime: "1 min read",
        image: "blog/bad-2025-10-19",
        imageAlt: "Image",
      };

      const result = BlogPostSchema.safeParse(invalidPost);
      expect(result.success).toBe(false);
    });
  });

  describe("ADRSchema", () => {
    it("should validate a complete ADR", () => {
      const validADR = {
        adrRef: "personal-knowledge-graph:001-next-js",
        slug: "001-next-js",
        projectSlug: "personal-knowledge-graph",
        title: "ADR 001: Next.js",
        date: "2025-10-18",
        status: "Accepted" as const,
        supersedes: "personal-knowledge-graph:002-remix",
        content: "We decided to use Next.js",
        readingTime: "3 min read",
        relations: {
          project: "personal-knowledge-graph",
          technologies: ["nextjs", "react"],
        },
      };

      const result = ADRSchema.safeParse(validADR);
      expect(result.success).toBe(true);
    });

    it("should validate ADR with minimal fields", () => {
      const minimalADR = {
        adrRef: "test-project:001-minimal",
        slug: "001-minimal",
        projectSlug: "test-project",
        title: "Minimal ADR",
        date: "2025-01-01",
        status: "Proposed" as const,
        content: "Content",
        readingTime: "1 min read",
        relations: {
          project: "test-project",
          technologies: [],
        },
      };

      const result = ADRSchema.safeParse(minimalADR);
      expect(result.success).toBe(true);
    });

    it("should reject ADR with invalid status", () => {
      const invalidADR = {
        adrRef: "test:001-bad",
        slug: "001-bad",
        projectSlug: "test",
        title: "Bad ADR",
        date: "2025-01-01",
        status: "Invalid", // Not a valid status
        content: "Content",
        readingTime: "1 min read",
        relations: {
          project: "test",
          technologies: [],
        },
      };

      const result = ADRSchema.safeParse(invalidADR);
      expect(result.success).toBe(false);
    });

    it("should validate all valid ADR statuses", () => {
      const statuses = ["Accepted", "Rejected", "Deprecated", "Proposed"];

      for (const status of statuses) {
        const result = ADRStatusSchema.safeParse(status);
        expect(result.success).toBe(true);
      }
    });
  });

  describe("ProjectSchema", () => {
    it("should validate a complete project", () => {
      const validProject = {
        slug: "personal-knowledge-graph",
        title: "Personal Knowledge Graph",
        description: "My portfolio",
        date: "2025-11-02",
        updated: "2025-12-15",
        status: "live" as const,
        repoUrl: "https://github.com/user/repo",
        demoUrl: "https://example.com",
        paperUrl: "https://doi.org/10.1000/example",
        paperTitle: "A Complete Project Paper",
        content: "# Overview",
        relations: {
          technologies: ["nextjs", "react", "typescript"],
          adrs: [
            "personal-knowledge-graph:001-next-js",
            "personal-knowledge-graph:002-react",
          ],
        },
      };

      const result = ProjectSchema.safeParse(validProject);
      expect(result.success).toBe(true);
    });

    it("should reject project with invalid status", () => {
      const invalidProject = {
        slug: "bad-status",
        title: "Bad Status",
        description: "Desc",
        date: "2025-01-01",
        status: "invalid",
        content: "Content",
        relations: {
          technologies: ["react"],
          adrs: [],
        },
      };

      const result = ProjectSchema.safeParse(invalidProject);
      expect(result.success).toBe(false);
    });

    it("should validate all valid project statuses", () => {
      const statuses = ["idea", "in_progress", "live", "archived", "completed"];

      for (const status of statuses) {
        const result = ProjectStatusSchema.safeParse(status);
        expect(result.success).toBe(true);
      }
    });

    it("should reject project with invalid URLs", () => {
      const invalidProject = {
        slug: "bad-urls",
        title: "Bad URLs",
        description: "Desc",
        date: "2025-01-01",
        status: "live" as const,
        repoUrl: "https://github.com/user/repo",
        demoUrl: "https://example.com",
        paperUrl: "not-a-paper-url",
        content: "Content",
        relations: {
          technologies: ["react"],
          adrs: [],
        },
      };

      const result = ProjectSchema.safeParse(invalidProject);
      expect(result.success).toBe(false);
    });

    it("should require complete research paper metadata", () => {
      const project = {
        slug: "research-project",
        title: "Research Project",
        description: "Desc",
        date: "2025-01-01",
        status: "completed" as const,
        content: "Content",
      };

      expect(
        ProjectSchema.safeParse({
          ...project,
          paperUrl: "https://doi.org/10.1000/example",
        }).success,
      ).toBe(false);
      expect(
        ProjectSchema.safeParse({
          ...project,
          paperTitle: "A Research Paper",
        }).success,
      ).toBe(false);
    });

    it("should apply default empty arrays when relations is omitted", () => {
      const projectWithoutRelations = {
        slug: "test-project",
        title: "Test Project",
        description: "Test description",
        date: "2025-01-01",
        status: "live" as const,
        content: "# Test content",
        // relations field is completely omitted
      };

      const result = ProjectSchema.safeParse(projectWithoutRelations);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.relations).toEqual({
          technologies: [],
          ideas: [],
          adrs: [],
          initiatives: [],
        });
      }
    });

    it("should apply default empty arrays when relations is empty object", () => {
      const projectWithEmptyRelations = {
        slug: "test-project-2",
        title: "Test Project 2",
        description: "Test description 2",
        date: "2025-01-02",
        status: "idea" as const,
        content: "# Test content 2",
        relations: {}, // Empty object provided
      };

      const result = ProjectSchema.safeParse(projectWithEmptyRelations);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.relations).toEqual({
          technologies: [],
          ideas: [],
          adrs: [],
          initiatives: [],
        });
      }
    });
  });

  describe("InitiativeSchema", () => {
    it("validates an initiative", () => {
      const result = InitiativeSchema.safeParse({
        slug: "personalized-medicine",
        title: "Personalized Medicine",
        description: "Making patient-specific treatment decisions accessible",
        date: "2017-07-04",
        status: "inactive",
        content: "# Goal",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.projectContributions).toEqual({});
      }
    });

    it("rejects an initiative without a description", () => {
      const result = InitiativeSchema.safeParse({
        slug: "personalized-medicine",
        title: "Personalized Medicine",
        description: "",
        date: "2017-07-04",
        status: "inactive",
        content: "# Goal",
      });

      expect(result.success).toBe(false);
    });

    it.each(["2023-02-29", "2023-02-30", "2023-13-01"])(
      "rejects the invalid calendar date %s",
      (date) => {
        const result = InitiativeSchema.safeParse({
          slug: "personalized-medicine",
          title: "Personalized Medicine",
          description: "Making patient-specific treatment decisions accessible",
          date,
          status: "inactive",
          content: "# Goal",
        });

        expect(result.success).toBe(false);
      },
    );

    it.each(["Personalized-Medicine", "personalized medicine", "../medicine"])(
      "rejects an unsafe initiative slug: %s",
      (slug) => {
        const result = InitiativeSchema.safeParse({
          slug,
          title: "Personalized Medicine",
          description: "Making patient-specific treatment decisions accessible",
          date: "2017-07-04",
          status: "inactive",
          content: "# Goal",
        });

        expect(result.success).toBe(false);
      },
    );

    it.each(["idea", "active", "inactive"])(
      "accepts the %s lifecycle state",
      (status) => {
        expect(InitiativeStatusSchema.safeParse(status).success).toBe(true);
      },
    );

    it("rejects completed as an initiative lifecycle state", () => {
      expect(InitiativeStatusSchema.safeParse("completed").success).toBe(false);
    });
  });

  describe("JobRoleSchema", () => {
    it("should validate a complete job role", () => {
      const validRole = {
        slug: "microsoft-0",
        company: "Microsoft",
        companyUrl: "https://microsoft.com",
        logoPath: "/logos/microsoft.png",
        title: "Software Engineer",
        location: "Seattle, WA",
        startDate: "2020-01",
        endDate: "2022-06",
        description: "Worked on cool stuff",
        responsibilities: ["Built features", "Fixed bugs", "Wrote tests"],
        relations: {
          technologies: ["csharp", "dotnet", "azure"],
        },
      };

      const result = JobRoleSchema.safeParse(validRole);
      expect(result.success).toBe(true);
    });

    it("should validate current role without endDate", () => {
      const currentRole = {
        slug: "current-role",
        company: "Current Co",
        companyUrl: "https://current.com",
        logoPath: "/logos/current.png",
        title: "Senior Engineer",
        location: "Remote",
        startDate: "2023-01",
        // No endDate for current role
        description: "Current position",
        responsibilities: ["Leading projects"],
        relations: {
          technologies: ["typescript", "react"],
        },
      };

      const result = JobRoleSchema.safeParse(currentRole);
      expect(result.success).toBe(true);
    });

    it("should reject role with invalid date format", () => {
      const invalidRole = {
        slug: "bad-date",
        company: "Bad Co",
        companyUrl: "https://bad.com",
        logoPath: "/logo.png",
        title: "Engineer",
        location: "Remote",
        startDate: "2020-01-01", // Wrong format (should be YYYY-MM)
        description: "Desc",
        responsibilities: ["Work"],
        relations: {
          technologies: [],
        },
      };

      const result = JobRoleSchema.safeParse(invalidRole);
      expect(result.success).toBe(false);
    });

    it("should reject role with invalid company URL", () => {
      const invalidRole = {
        slug: "bad-url",
        company: "Bad Co",
        companyUrl: "not-a-url",
        logoPath: "/logo.png",
        title: "Engineer",
        location: "Remote",
        startDate: "2020-01",
        description: "Desc",
        responsibilities: ["Work"],
        relations: {
          technologies: [],
        },
      };

      const result = JobRoleSchema.safeParse(invalidRole);
      expect(result.success).toBe(false);
    });

    it("should reject role with empty responsibilities", () => {
      const invalidRole = {
        slug: "no-resp",
        company: "No Resp Co",
        companyUrl: "https://noresp.com",
        logoPath: "/logo.png",
        title: "Engineer",
        location: "Remote",
        startDate: "2020-01",
        description: "Desc",
        responsibilities: [], // Must have at least one
        relations: {
          technologies: [],
        },
      };

      const result = JobRoleSchema.safeParse(invalidRole);
      expect(result.success).toBe(false);
    });

    it("should apply default empty technologies when relations is omitted", () => {
      const roleWithoutRelations = {
        slug: "test-role",
        company: "Test Co",
        companyUrl: "https://test.com",
        logoPath: "/logo.png",
        title: "Engineer",
        location: "Remote",
        startDate: "2020-01",
        description: "Test description",
        responsibilities: ["Test responsibility"],
        // relations field is completely omitted
      };

      const result = JobRoleSchema.safeParse(roleWithoutRelations);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.relations).toEqual({
          technologies: [],
        });
      }
    });

    it("should apply default empty technologies when relations is empty object", () => {
      const roleWithEmptyRelations = {
        slug: "test-role-2",
        company: "Test Co 2",
        companyUrl: "https://test2.com",
        logoPath: "/logo2.png",
        title: "Senior Engineer",
        location: "Remote",
        startDate: "2021-01",
        description: "Test description 2",
        responsibilities: ["Test responsibility 2"],
        relations: {}, // Empty object provided
      };

      const result = JobRoleSchema.safeParse(roleWithEmptyRelations);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.relations).toEqual({
          technologies: [],
        });
      }
    });

    it("should validate a role with previousTitles", () => {
      const roleWithProgression = {
        slug: "philips",
        company: "Philips",
        companyUrl: "https://philips.com",
        logoPath: "/logo.png",
        title: "Senior Software Engineer",
        previousTitles: [
          {
            title: "Software Engineer",
            startDate: "2018-04",
            endDate: "2019-09",
          },
          {
            title: "Graduate Software Engineer",
            startDate: "2017-07",
            endDate: "2018-04",
          },
        ],
        location: "Belfast, UK",
        startDate: "2017-07",
        endDate: "2020-03",
        description: "Led development",
        responsibilities: ["Built stuff"],
        relations: { technologies: ["python"] },
      };

      const result = JobRoleSchema.safeParse(roleWithProgression);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.previousTitles).toHaveLength(2);
      }
    });

    it("should validate a role without previousTitles (backward compatible)", () => {
      const singleTitleRole = {
        slug: "bestomer",
        company: "Bestomer",
        companyUrl: "https://bestomer.com",
        logoPath: "/logo.png",
        title: "ML Lead",
        location: "Remote",
        startDate: "2023-05",
        endDate: "2024-02",
        description: "Led ML",
        responsibilities: ["ML stuff"],
        relations: { technologies: [] },
      };

      const result = JobRoleSchema.safeParse(singleTitleRole);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.previousTitles).toBeUndefined();
      }
    });

    it("should reject previousTitles with invalid date format", () => {
      const invalidRole = {
        slug: "bad",
        company: "Bad Co",
        companyUrl: "https://bad.com",
        logoPath: "/logo.png",
        title: "Engineer",
        previousTitles: [
          { title: "Junior", startDate: "2020-01-01", endDate: "2021-01" },
        ],
        location: "Remote",
        startDate: "2020-01",
        description: "Desc",
        responsibilities: ["Work"],
        relations: { technologies: [] },
      };

      const result = JobRoleSchema.safeParse(invalidRole);
      expect(result.success).toBe(false);
    });
  });
});
