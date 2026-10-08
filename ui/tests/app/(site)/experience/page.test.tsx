import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ExperiencePage from "@/app/(site)/experience/page";
import { formatExperienceDateLabel } from "@/lib/api/experience";

vi.mock("@/components/experience/experience-card", () => ({
  ExperienceCard: ({ dateLabel }: { dateLabel: string }) => (
    <div>{dateLabel}</div>
  ),
}));

vi.mock("@/components/experience/searchable-technology-grid", () => ({
  SearchableTechnologyGrid: () => null,
}));

vi.mock("@/lib/api/experience", () => ({
  formatExperienceDateLabel: vi.fn(() => "server-formatted date label"),
  getAllExperience: () => [
    {
      company: "Example Company",
      startDate: "2024-05",
    },
  ],
  getExperienceSlug: () => "example-company",
}));

vi.mock("@/lib/domain", () => ({
  loadDomainRepository: () => ({}),
}));

vi.mock("@/lib/domain/blog/blogQueries", () => ({
  getRoleBlogs: () => [],
}));

vi.mock("@/lib/domain/project/projectQueries", () => ({
  getRoleProjects: () => [],
}));

vi.mock("@/lib/domain/technology", () => ({
  getAllTechnologyBadges: () => [],
  rankTechnologiesByConnections: () => [],
}));

describe("ExperiencePage", () => {
  it("formats client card dates on the server", () => {
    render(<ExperiencePage />);

    expect(screen.getByText("server-formatted date label")).toBeInTheDocument();
    expect(formatExperienceDateLabel).toHaveBeenCalledWith(
      "2024-05",
      undefined,
    );
  });
});
