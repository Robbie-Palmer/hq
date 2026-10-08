import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProjectCard } from "@/components/projects/project-card";
import type { Project } from "@/lib/api/projects";

vi.mock("posthog-js", () => ({
  default: { capture: vi.fn() },
}));

const project = {
  slug: "autonomic-satellite-swarm",
  title: "Autonomic Satellite Swarm",
  description: "A satellite-swarm research prototype",
  date: "2019-07-30",
  status: "in_progress",
  paperUrl: "https://doi.org/10.1109/SMC-IT.2019.00015",
  content: "",
  technologies: [],
  adrSlugs: [],
  adrs: [],
  tags: ["research"],
} satisfies Project;

describe("ProjectCard", () => {
  it("links to a project's published research paper", () => {
    render(
      <ProjectCard
        project={project}
        onTechClick={vi.fn()}
        onTagClick={vi.fn()}
        onStatusClick={vi.fn()}
        onRoleClick={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("link", { name: "Read Research Paper" }),
    ).toHaveAttribute("href", "https://doi.org/10.1109/SMC-IT.2019.00015");
    expect(screen.queryByText("Paper")).not.toBeInTheDocument();
  });
});
