import { render, screen } from "@testing-library/react";
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
  it("uses the shorter experience label below the 375px breakpoint", () => {
    render(<ScrollNavbar />);

    expect(screen.getByText("Exp")).toHaveClass("min-[375px]:hidden");
    expect(screen.getByText("Experience")).toHaveClass(
      "hidden",
      "min-[375px]:inline",
    );
  });
});
