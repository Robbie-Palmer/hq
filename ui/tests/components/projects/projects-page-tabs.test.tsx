import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({
  replace: vi.fn(),
  search: "",
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/projects",
  useRouter: () => ({ replace: navigation.replace }),
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

import { ProjectsPageTabs } from "@/components/projects/projects-page-tabs";

describe("ProjectsPageTabs", () => {
  beforeEach(() => {
    navigation.replace.mockReset();
    navigation.search = "";
    window.location.hash = "";
  });

  it("puts the default initiatives tab first", () => {
    render(
      <ProjectsPageTabs
        initiatives={<div>Initiative list</div>}
        projects={<div>Project list</div>}
      />,
    );

    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Initiatives",
      "All Projects",
    ]);
    expect(
      screen.getByRole("link", { name: "Read Building Philosophy" }),
    ).toHaveAttribute("href", "/building-philosophy");
  });

  it("shows initiatives by default", () => {
    render(
      <ProjectsPageTabs
        initiatives={<div>Initiative list</div>}
        projects={<div>Project list</div>}
      />,
    );

    expect(screen.getByRole("tab", { name: "Initiatives" })).toHaveAttribute(
      "data-state",
      "active",
    );
    expect(screen.getByText("Initiative list")).toBeVisible();
  });

  it("renders initiatives when selected in the URL", () => {
    navigation.search = "tab=initiatives";

    render(
      <ProjectsPageTabs
        initiatives={<div>Initiative list</div>}
        projects={<div>Project list</div>}
      />,
    );

    expect(screen.getByText("Initiative list")).toBeVisible();
  });

  it("redirects the legacy philosophy tab URL and preserves its section", async () => {
    navigation.search = "tab=philosophy";
    window.location.hash = "#short-feedback-loops";

    render(
      <ProjectsPageTabs
        initiatives={<div>Initiative list</div>}
        projects={<div>Project list</div>}
      />,
    );

    await waitFor(() => {
      expect(navigation.replace).toHaveBeenCalledWith(
        "/building-philosophy#short-feedback-loops",
      );
    });
  });

  it("uses the query-free projects URL for the default tab", async () => {
    navigation.search = "tab=projects";
    const user = userEvent.setup();

    render(
      <ProjectsPageTabs
        initiatives={<div>Initiative list</div>}
        projects={<div>Project list</div>}
      />,
    );

    await user.click(screen.getByRole("tab", { name: "Initiatives" }));

    expect(navigation.replace).toHaveBeenCalledWith("/projects", {
      scroll: false,
    });
  });
});
