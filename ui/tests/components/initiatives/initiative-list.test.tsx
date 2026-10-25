import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InitiativeList } from "@/components/initiatives/initiative-list";
import type { InitiativeWithProjects } from "@/lib/api/initiatives";

const replaceMock = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/projects",
  useRouter: () => ({ replace: replaceMock }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("posthog-js", () => ({
  default: { capture: vi.fn() },
}));

function initiative(
  slug: string,
  title: string,
  date: string,
  projectDate: string,
  projectUpdated?: string,
): InitiativeWithProjects {
  return {
    slug,
    title,
    description: `${title} description`,
    date,
    status: "active",
    content: "",
    projectContributions: {},
    ideas: [],
    projects: [
      {
        slug: `${slug}-project`,
        title: `${title} project`,
        date: projectDate,
        updated: projectUpdated,
      },
    ],
  } as unknown as InitiativeWithProjects;
}

describe("InitiativeList", () => {
  beforeEach(() => {
    replaceMock.mockReset();
  });

  it("defaults to the most recent update among related projects", () => {
    const newerInitiative = initiative(
      "newer-project-update",
      "Newer project update",
      "2025-01-01",
      "2025-02-01",
      "2026-08-01",
    );
    const olderInitiative = initiative(
      "older-project-update",
      "Older project update",
      "2026-09-01",
      "2026-01-01",
    );

    render(<InitiativeList initiatives={[olderInitiative, newerInitiative]} />);

    const initiativeLinks = screen.getAllByRole("link", {
      name: /^(Newer|Older) project update$/,
    });
    expect(initiativeLinks.map((link) => link.textContent)).toEqual([
      "Newer project update",
      "Older project update",
    ]);
    expect(
      screen.getByRole("button", {
        name: "Sort: Recently updated. Click to change sort order.",
      }),
    ).toBeVisible();
  });
});
