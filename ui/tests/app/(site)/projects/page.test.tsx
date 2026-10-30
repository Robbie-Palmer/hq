import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ProjectsPage from "@/app/(site)/projects/page";

vi.mock("next/navigation", () => ({
  usePathname: () => "/projects",
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("posthog-js", () => ({
  default: { capture: vi.fn() },
}));

vi.mock("@/lib/api/initiatives", () => ({
  getAllInitiatives: () => [
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
  ],
}));

vi.mock("@/lib/api/projects", () => ({
  getAllProjects: () => [],
}));

vi.mock("@/components/projects/projects-page-tabs", () => ({
  ProjectsPageTabs: ({
    initiatives,
    projects,
  }: {
    initiatives: React.ReactNode;
    projects: React.ReactNode;
  }) => (
    <div>
      {initiatives}
      {projects}
    </div>
  ),
}));

vi.mock("@/components/projects/project-list", () => ({
  ProjectList: () => <div>Complete project list</div>,
}));

describe("projects page", () => {
  it("passes initiatives and projects to the project tabs", async () => {
    render(await ProjectsPage());

    expect(
      screen.getByRole("link", { name: "Personalized Medicine" }),
    ).toHaveAttribute("href", "/initiatives/personalized-medicine");
    expect(screen.getByText("Complete project list")).toBeInTheDocument();
  });
});
