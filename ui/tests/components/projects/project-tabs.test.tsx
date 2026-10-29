import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectTabs } from "@/components/projects/project-tabs";
import { ProjectsPageTabs } from "@/components/projects/projects-page-tabs";

const replaceMock = vi.fn();
let query = "";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock }),
  useSearchParams: () => new URLSearchParams(query),
}));

describe("ProjectTabs", () => {
  beforeEach(() => {
    replaceMock.mockReset();
    query = "";
  });

  it("uses the canonical project URL when selecting the ADR tab", async () => {
    const user = userEvent.setup();
    render(
      <ProjectTabs
        projectSlug="recipe-site"
        adrCount={2}
        overview={<div>Overview content</div>}
        adrs={<div>ADR content</div>}
      />,
    );

    await user.click(
      screen.getByRole("tab", { name: /Architecture Decisions/ }),
    );

    expect(replaceMock).toHaveBeenCalledWith("/projects/recipe-site?tab=adrs", {
      scroll: false,
    });
  });

  it("shows a pitch deck first when the project has one", () => {
    render(
      <ProjectTabs
        projectSlug="agentic-code-review"
        pitch={<div>Pitch content</div>}
        adrCount={1}
        overview={<div>Overview content</div>}
        adrs={<div>ADR content</div>}
      />,
    );

    expect(screen.getByRole("tab", { name: "Pitch deck" })).toHaveAttribute(
      "data-state",
      "active",
    );
    expect(screen.getByText("Pitch content")).toBeVisible();
  });

  it("links the product decision tab to its owning project", async () => {
    const user = userEvent.setup();
    render(
      <ProjectTabs
        projectSlug="platform"
        adrCount={0}
        adrs={null}
        overview={<p>Overview</p>}
        pdrCount={1}
        pdrs={<p>Product policy</p>}
      />,
    );
    await user.click(screen.getByRole("tab", { name: /Product decisions/ }));
    expect(replaceMock).toHaveBeenCalledWith("/projects/platform?tab=pdrs", {
      scroll: false,
    });
  });

  it.each([
    ["tab=pdrs", "Product policy"],
    ["tab=missing", "Overview content"],
  ])("restores an available tab or falls back for %s", (params, visible) => {
    query = params;
    render(
      <ProjectTabs
        projectSlug="platform"
        adrCount={0}
        adrs={null}
        overview={<p>Overview content</p>}
        pdrCount={1}
        pdrs={<p>Product policy</p>}
      />,
    );
    expect(screen.getByText(visible)).toBeVisible();
  });

  it("links the Projects philosophy entry to its dedicated page", () => {
    render(
      <ProjectsPageTabs
        initiatives={<div>Initiatives content</div>}
        projects={<div>Projects content</div>}
      />,
    );

    expect(
      screen.getByRole("link", { name: "Building Philosophy" }),
    ).toHaveAttribute("href", "/building-philosophy");
  });
});
