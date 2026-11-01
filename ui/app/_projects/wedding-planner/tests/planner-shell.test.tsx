import { fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({
  pathname: "/wedding-planner/readiness",
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
}));

import { PlannerShell } from "@/app/_projects/wedding-planner/components/planner-shell";
import { WeddingPlannerLayout } from "@/app/_projects/wedding-planner/routes/layout";
import { render, screen } from "@/tests/test-utils";

describe("Wedding planner shell", () => {
  beforeEach(() => {
    navigation.pathname = "/wedding-planner/readiness";
  });

  it("links every retained workflow and marks the current route", () => {
    navigation.pathname = "/wedding-planner/accommodation/inventory";
    render(
      <PlannerShell>
        <main id="wedding-planner-content">Inventory route</main>
      </PlannerShell>,
    );

    const current = screen.getAllByRole("link", {
      name: "Accommodation",
      current: "page",
    });
    expect(current).toHaveLength(2);
    for (const label of ["Readiness", "Guests", "Seating", "Music", "Exports"])
      expect(screen.getAllByRole("link", { name: label })).not.toHaveLength(0);
    expect(
      screen.getByRole("link", { name: "Inventory", current: "step" }),
    ).toHaveAttribute("href", "/wedding-planner/accommodation/inventory");
    expect(
      screen.getByRole("link", { name: "Skip to planner content" }),
    ).toHaveAttribute("href", "#wedding-planner-content");
  });

  it("closes the mobile section list after navigation", () => {
    render(
      <PlannerShell>
        <main id="wedding-planner-content">Readiness route</main>
      </PlannerShell>,
    );
    const sections = screen.getByText("Sections").closest("details");
    if (!sections) throw new Error("Expected mobile navigation details");
    fireEvent.click(screen.getByText("Sections"));
    expect(sections).toHaveAttribute("open");
    const guestLink = screen.getAllByRole("link", { name: "Guests" })[0]!;
    guestLink.addEventListener("click", (event) => event.preventDefault(), {
      once: true,
    });
    fireEvent.click(guestLink);
    expect(sections).not.toHaveAttribute("open");
  });

  it("keeps the guest playlist outside the private planning shell", () => {
    navigation.pathname = "/wedding-planner/playlist";
    render(
      <WeddingPlannerLayout>
        <main>Guest playlist</main>
      </WeddingPlannerLayout>,
    );
    expect(screen.getByRole("main")).toHaveTextContent("Guest playlist");
    expect(
      screen.queryByRole("navigation", { name: "Wedding planner sections" }),
    ).not.toBeInTheDocument();
  });
});
