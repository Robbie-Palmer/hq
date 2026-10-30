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
    responsibilities: ["Ships useful software"],
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
    responsibilities: ["Led delivery"],
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
  });

  it("selects the five newest eligible canonical projects", () => {
    const projects = [
      project("one", "2024-01-01"),
      project("two", "2024-02-01"),
      project("three", "2024-03-01"),
      project("four", "2024-04-01"),
      project("five", "2024-05-01"),
      project("six", "2024-06-01"),
      project("archived", "2025-01-01", "archived"),
    ];

    const data = buildResumeData(experiences, projects, profile);

    expect(data.projects.map(({ slug }) => slug)).toEqual([
      "six",
      "five",
      "four",
      "three",
      "two",
    ]);
    expect(data.projects[0]?.technologies).toEqual(["TypeScript"]);
  });

  it("requires canonical experience content", () => {
    expect(() => buildResumeData([], [], profile)).toThrow(
      "at least one canonical experience",
    );
  });
});
