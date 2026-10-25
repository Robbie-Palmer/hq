import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Home from "@/app/(site)/page";
import { getAllInitiatives } from "@/lib/api/initiatives";

vi.mock("@/lib/api/blog-collections", () => ({
  getCollectionsWithIds: () => [{ id: "all", title: "All" }],
  getCollectionPosts: () => [],
}));

vi.mock("@/lib/api/experience", () => ({
  getAllExperience: () => [],
}));

vi.mock("@/lib/api/initiatives", () => ({
  getAllInitiatives: vi.fn(() => [
    {
      slug: "personalized-medicine",
      title: "Personalized Medicine",
      description: "Make patient-specific decisions more accessible.",
      date: "2017-07-04",
      status: "inactive",
      content: "",
      projectContributions: {},
      ideas: [],
      projects: [],
    },
  ]),
}));

vi.mock("@/lib/api/projects", () => ({
  getAllADRs: () => [],
}));

vi.mock("@/lib/domain", () => ({
  loadDomainRepository: () => ({ technologies: new Map() }),
}));

vi.mock("@/lib/domain/technology", () => ({
  getTechnologiesWithConnectionWeights: () => [],
}));

vi.mock("@/components/blog/blog-collection-tabs", () => ({
  BlogCollectionTabs: () => <h2>Explore Posts</h2>,
}));

vi.mock("@/components/home-cta-buttons", () => ({
  HomeCTAButtons: () => null,
}));

vi.mock("@/components/home-knowledge-graph", () => ({
  HomeKnowledgeGraph: () => null,
}));

vi.mock("@/components/projects/adr-carousel", () => ({
  ADRCarousel: () => null,
}));

vi.mock("@/components/ui/light-rays", () => ({
  LightRays: () => null,
}));

vi.mock("@/components/ui/tech-icon-orbit", () => ({
  TechOrbit: () => null,
}));

describe("home page", () => {
  it("places initiatives immediately after the hero and before posts", () => {
    render(<Home />);
    const initiativeHeading = screen.getByRole("heading", {
      name: "What I'm building toward",
    });
    const initiativeWrapper =
      initiativeHeading.closest("section")?.parentElement;
    const postsHeading = screen.getByRole("heading", { name: "Explore Posts" });

    expect(initiativeWrapper?.previousElementSibling).toContainElement(
      screen.getByRole("heading", { level: 1 }),
    );
    expect(initiativeWrapper?.nextElementSibling).toContainElement(
      postsHeading,
    );
    expect(
      screen.getByRole("link", { name: "Personalized Medicine" }),
    ).toHaveAttribute("href", "/initiatives/personalized-medicine");
  });

  it("does not leave initiative spacing when no initiatives exist", () => {
    vi.mocked(getAllInitiatives).mockReturnValueOnce([]);

    render(<Home />);

    const postsSection = screen
      .getByRole("heading", { name: "Explore Posts" })
      .closest("section");
    expect(
      screen.queryByRole("heading", { name: "What I'm building toward" }),
    ).not.toBeInTheDocument();
    expect(postsSection?.previousElementSibling).toContainElement(
      screen.getByRole("heading", { level: 1 }),
    );
  });
});
