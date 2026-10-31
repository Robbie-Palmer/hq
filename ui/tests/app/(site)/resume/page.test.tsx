import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ResumePage, { metadata } from "@/app/(site)/resume/page";

vi.mock("@/lib/api/experience", () => ({
  getAllExperience: () => [
    {
      company: "Canonical Company",
      companyUrl: "https://company.example",
      logoPath: "/company-logos/example.png",
      title: "Canonical Role",
      location: "Belfast, UK",
      startDate: "2024-01",
      description: "Canonical summary.",
      responsibilities: ["Canonical responsibility"],
      technologies: ["TypeScript"],
    },
  ],
}));

vi.mock("@/lib/api/projects", () => ({
  getAllProjects: () => [],
}));

vi.mock("@/app/(site)/resume/resume-document", () => ({
  ResumeDocument: ({ data }: { data: { headline: string } }) => (
    <div data-testid="resume-document">{data.headline}</div>
  ),
}));

describe("ResumePage", () => {
  it("builds the client document from canonical site APIs", () => {
    render(<ResumePage />);

    expect(screen.getByTestId("resume-document")).toHaveTextContent(
      "Canonical Role",
    );
  });

  it("publishes canonical résumé metadata", () => {
    expect(metadata.alternates).toEqual({
      canonical: "https://robbiepalmer.me/resume",
    });
  });
});
