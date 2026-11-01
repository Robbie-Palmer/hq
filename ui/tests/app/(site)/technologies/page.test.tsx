import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TechnologiesPage from "@/app/(site)/technologies/page";

vi.mock("@/components/technology/searchable-technology-grid", () => ({
  SearchableTechnologyGrid: ({ technologies }: { technologies: unknown[] }) => (
    <div>{technologies.length} technologies</div>
  ),
}));

vi.mock("@/lib/domain", () => ({
  loadDomainRepository: () => ({ technologies: new Map() }),
}));

vi.mock("@/lib/domain/technology", () => ({
  getAllTechnologyBadges: () => [{ slug: "react" }, { slug: "typescript" }],
  rankTechnologiesByConnections: (
    _repository: unknown,
    technologies: unknown[],
  ) => technologies,
}));

describe("TechnologiesPage", () => {
  it("renders the searchable technology collection", () => {
    render(<TechnologiesPage />);

    expect(
      screen.getByRole("heading", { name: "Technologies" }),
    ).toBeInTheDocument();
    expect(screen.getByText("2 technologies")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Subscribe/ })).toHaveAttribute(
      "href",
      "/technologies/feed.xml",
    );
  });
});
