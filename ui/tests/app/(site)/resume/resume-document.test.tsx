import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ResumeData } from "@/app/(site)/resume/resume-data";
import { ResumeDocument } from "@/app/(site)/resume/resume-document";

vi.mock("@/app/(site)/resume/resume.module.css", () => ({
  default: {
    backLink: "backLink",
    contactLinks: "contactLinks",
    contentGrid: "contentGrid",
    description: "description",
    document: "document",
    earlierExperienceList: "earlierExperienceList",
    evidenceColumn: "evidenceColumn",
    entryHeading: "entryHeading",
    experienceEntry: "experienceEntry",
    experienceList: "experienceList",
    headline: "headline",
    pageFooter: "pageFooter",
    printActions: "printActions",
    profileSummary: "profileSummary",
    projectEntry: "projectEntry",
    projectHeading: "projectHeading",
    projectList: "projectList",
    resumeHeader: "resumeHeader",
    sectionTitle: "sectionTitle",
    sheet: "sheet",
    shell: "shell",
    skills: "skills",
    technologyLine: "technologyLine",
    toolbar: "toolbar",
  },
}));

const experience = {
  company: "Example Company",
  companyUrl: "https://company.example",
  logoPath: "/company-logos/example.png",
  title: "Principal Engineer",
  location: "Belfast, UK",
  startDate: "2024-01",
  description: "Builds useful products from canonical content.",
  responsibilities: ["Led delivery", "Built platforms", "Mentored engineers"],
  technologies: ["TypeScript", "React", "Python"],
};

const data: ResumeData = {
  person: {
    name: "Example Person",
    website: "https://example.com",
    github: "https://github.com/example",
    linkedin: "https://linkedin.com/in/example",
  },
  headline: "Principal Engineer",
  summary: "Builds useful products from canonical content.",
  experiences: [
    experience,
    { ...experience, company: "Second Company" },
    { ...experience, company: "Third Company" },
    { ...experience, company: "Fourth Company" },
    { ...experience, company: "Earlier Company" },
  ],
  professionalProjects: [
    {
      company: "Example Company",
      companyUrl: "https://company.example",
      description: "Led delivery",
      experienceStartDate: "2024-01",
      technologies: ["TypeScript", "React"],
    },
  ],
  independentProjects: [
    {
      slug: "example-project",
      title: "Example Project",
      description: "A canonical project description.",
      technologies: ["TypeScript", "React"],
      repositoryUrl: "https://github.com/example/project",
    },
    {
      slug: "website-only-project",
      title: "Website-only Project",
      description: "A project without a separate source repository.",
      technologies: ["React"],
    },
  ],
  skills: ["TypeScript", "React", "Python"],
};

describe("ResumeDocument", () => {
  it("renders professional and independent work on one printable sheet", () => {
    render(<ResumeDocument data={data} />);

    expect(screen.getAllByTestId("resume-sheet")).toHaveLength(1);
    expect(
      screen.getByRole("heading", { name: "Example Person", level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByText("Earlier Company")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Career projects" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Independent builds" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Example Project")).toHaveAttribute(
      "href",
      "/projects/example-project",
    );
    expect(
      screen.getByLabelText("Example Project source code"),
    ).toHaveAttribute("href", "https://github.com/example/project");
    expect(
      screen.getByRole("link", { name: "Back to experience" }),
    ).toHaveAttribute("href", "/experience");
  });

  it("opens the native print dialog", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    render(<ResumeDocument data={data} />);

    await userEvent.click(
      screen.getByRole("button", { name: "Print / save PDF" }),
    );

    expect(print).toHaveBeenCalledOnce();
    print.mockRestore();
  });
});
