import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ExperienceCard } from "@/components/experience/experience-card";
import type { Experience } from "@/lib/api/experience";

vi.mock("posthog-js", () => ({
  default: { capture: vi.fn() },
}));

const experience = {
  company: "Example Company",
  companyUrl: "https://example.com",
  logoPath: "/company-logos/example.png",
  title: "Software Engineer",
  location: "Remote",
  startDate: "2024-05",
  description: "Built useful software.",
  responsibilities: ["Shipped product changes"],
  technologies: [],
} satisfies Experience;

describe("ExperienceCard", () => {
  it("renders the server-provided date label", () => {
    render(
      <ExperienceCard
        experience={experience}
        dateLabel="May 2024 - Present (2 years, 6 months)"
      />,
    );

    expect(
      screen.getByText("May 2024 - Present (2 years, 6 months)"),
    ).toBeInTheDocument();
  });
});
