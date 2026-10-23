import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useSession: vi.fn(),
  selectedRecipeCount: 2,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/recipes",
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: { useSession: mocks.useSession },
}));

vi.mock("@/components/recipes/recipe-nav-tabs", () => ({
  RecipeNavTabs: () => <div>Personal recipe tabs</div>,
}));

vi.mock("@/components/recipes/recipe-mobile-nav", () => ({
  RecipeMobileNav: ({ count }: { count: number }) => (
    <nav aria-label="Primary recipe sections">Mobile tabs: {count}</nav>
  ),
}));

vi.mock("@/hooks/use-shopping-list", () => ({
  useSelectedRecipeCount: () => mocks.selectedRecipeCount,
}));

import {
  RecipeMobileSiteNav,
  RecipeSiteNav,
} from "@/components/recipes/recipe-site-nav";

describe("RecipeSiteNav", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders neutral navigation while the session is loading", () => {
    mocks.useSession.mockReturnValue({ data: null, isPending: true });

    render(<RecipeSiteNav />);

    expect(
      screen.getByRole("status", { name: "Loading recipe navigation" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Discover" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Personal recipe tabs")).not.toBeInTheDocument();
  });

  it("renders personal navigation for signed-in users", () => {
    mocks.useSession.mockReturnValue({
      data: { user: { id: "user-1" } },
      isPending: false,
    });

    render(<RecipeSiteNav />);

    expect(screen.getByText("Personal recipe tabs")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Discover" }),
    ).not.toBeInTheDocument();
  });

  it("renders signed-in mobile navigation outside the page header", () => {
    mocks.useSession.mockReturnValue({
      data: { user: { id: "user-1" } },
      isPending: false,
    });

    render(
      <>
        <header>
          <RecipeSiteNav />
        </header>
        <RecipeMobileSiteNav />
      </>,
    );

    const mobileNavigation = screen.getByRole("navigation", {
      name: "Primary recipe sections",
    });
    expect(mobileNavigation).toHaveTextContent("Mobile tabs: 2");
    expect(screen.getByRole("banner")).not.toContainElement(mobileNavigation);
  });

  it("does not expose personal mobile navigation without a session", () => {
    mocks.useSession.mockReturnValue({ data: null, isPending: false });

    render(<RecipeMobileSiteNav />);

    expect(
      screen.queryByRole("navigation", { name: "Primary recipe sections" }),
    ).not.toBeInTheDocument();
  });
});
