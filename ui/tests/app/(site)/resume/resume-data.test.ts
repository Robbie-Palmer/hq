import { describe, expect, it } from "vitest";
import { buildResumeData } from "@/app/(site)/resume/resume-data";
import type { Experience } from "@/lib/api/experience";
import type { Project } from "@/lib/api/projects";

const experiences: Experience[] = [
  {
    company: "Current Company",
    companyUrl: "https://current.example",
    logoPath: "/company-logos/current.png",
    title: "Principal Engineer",
    location: "Remote",
    startDate: "2024-01",
    description: "Builds canonical products.",
    responsibilities: [
      "Ships useful software",
      "Built a current-company platform",
    ],
    technologies: ["TypeScript", "React", "Python"],
  },
  {
    company: "Previous Company",
    companyUrl: "https://previous.example",
    logoPath: "/company-logos/previous.png",
    title: "Senior Engineer",
    location: "Belfast, UK",
    startDate: "2020-01",
    endDate: "2023-12",
    description: "Built earlier products.",
    responsibilities: ["Led delivery", "Built a previous-company platform"],
    technologies: ["TypeScript", "Python", "AWS"],
  },
];

function project(
  slug: string,
  date: string,
  status: Project["status"] = "live",
): Project {
  return {
    slug,
    title: slug.toUpperCase(),
    description: `${slug} description`,
    date,
    status,
    repoUrl: `https://github.com/example/${slug}`,
    content: "",
    technologies: [
      {
        slug: "typescript",
        name: "TypeScript",
        iconSlug: "typescript",
        hasIcon: true,
        website: "https://typescriptlang.org",
      },
    ],
    adrSlugs: [],
    adrs: [],
    tags: [],
  };
}

function careerProject(slug: string, company: string, date: string): Project {
  return {
    ...project(slug, date, "completed"),
    role: {
      slug: company.toLowerCase().replaceAll(" ", "-"),
      company,
      logoPath: "/company-logos/example.png",
      title: "Engineer",
      startDate: "2020-01",
    },
  };
}

const profile = {
  name: "Example Person",
  website: "https://example.com",
  github: "https://github.com/example",
  linkedin: "https://linkedin.com/in/example",
};

describe("buildResumeData", () => {
  it("derives résumé copy and skills from canonical experience", () => {
    const data = buildResumeData(experiences, [], profile);

    expect(data.headline).toBe("Principal Engineer");
    expect(data.summary).toBe("Builds canonical products.");
    expect(data.skills.slice(0, 2)).toEqual(["Python", "TypeScript"]);
    expect(data.experiences).toBe(experiences);
    expect(data.professionalProjects).toEqual([]);
  });

  it("selects two recent eligible canonical independent projects", () => {
    const projects = [
      project("one", "2024-01-01"),
      project("two", "2024-02-01"),
      project("three", "2024-03-01"),
      project("four", "2024-04-01"),
      project("five", "2024-05-01"),
      project("six", "2024-06-01"),
      project("archived", "2025-01-01", "archived"),
      careerProject("genomic-prediction", "Sonrai Analytics", "2025-02-01"),
    ];

    const data = buildResumeData(experiences, projects, profile);

    expect(data.independentProjects.map(({ slug }) => slug)).toEqual([
      "six",
      "five",
    ]);
    expect(data.independentProjects[0]?.technologies).toEqual(["TypeScript"]);
  });

  it("selects career projects through canonical employment relationships", () => {
    const projects = [
      careerProject("genomic-prediction", "Sonrai Analytics", "2020-03-30"),
      careerProject("pii-detection", "Confluent", "2022-05-01"),
      careerProject("multi-modal-product-search", "Bestomer", "2023-07-01"),
      careerProject(
        "real-time-multi-camera-video-analytics",
        "Terminal Industries",
        "2024-05-01",
      ),
    ];

    const data = buildResumeData(experiences, projects, profile);

    expect(data.professionalProjects.map(({ slug }) => slug)).toEqual([
      "real-time-multi-camera-video-analytics",
      "multi-modal-product-search",
      "pii-detection",
      "genomic-prediction",
    ]);
    expect(data.professionalProjects.at(-1)).toEqual(
      expect.objectContaining({
        company: "Sonrai Analytics",
        description: "genomic-prediction description",
        title: "GENOMIC-PREDICTION",
      }),
    );
  });

  it("requires canonical experience content", () => {
    expect(() => buildResumeData([], [], profile)).toThrow(
      "at least one canonical experience",
    );
  });
});
