import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ScrollNavbar } from "@/components/scroll-navbar";

vi.mock("@/components/command-palette-shell", () => ({
  CommandPaletteTrigger: () => <button type="button">Search</button>,
}));

vi.mock("@/components/ui/animated-theme-toggler", () => ({
  AnimatedThemeToggler: () => <button type="button">Toggle theme</button>,
}));

vi.mock("@/contexts/navbar-actions-context", () => ({
  useNavbarActions: () => ({ hasActions: false }),
}));

vi.mock("@/hooks/use-navbar-visibility", () => ({
  useNavbarVisibility: () => true,
}));

describe("ScrollNavbar", () => {
  it("uses the shorter experience label below the 420px breakpoint", () => {
    render(<ScrollNavbar />);

    expect(screen.getByText("Exp")).toHaveClass("min-[420px]:hidden");
    expect(screen.getByText("Experience")).toHaveClass(
      "hidden",
      "min-[420px]:inline",
    );
  });

  it("groups secondary destinations under More", async () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    const user = userEvent.setup();
    render(<ScrollNavbar />);

    expect(screen.queryByRole("link", { name: "Ideas" })).toBeNull();
    await user.click(screen.getByRole("button", { name: /More/ }));

    expect(screen.getByRole("link", { name: /Ideas/ })).toHaveAttribute(
      "href",
      "/ideas",
    );
    expect(screen.getByRole("link", { name: /Technologies/ })).toHaveAttribute(
      "href",
      "/technologies",
    );
  });
});
