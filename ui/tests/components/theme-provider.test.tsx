import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@/tests/test-utils";

const navigation = vi.hoisted(() => ({ pathname: "/" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
}));

vi.mock("next-themes", () => ({
  ThemeProvider: ({
    children,
    forcedTheme,
  }: {
    children: ReactNode;
    forcedTheme?: string;
  }) => (
    <div data-testid="theme" data-forced-theme={forcedTheme}>
      {children}
    </div>
  ),
}));

import { ThemeProvider } from "@/components/theme-provider";

describe("ThemeProvider", () => {
  it.each(["/wedding-planner", "/wedding-planner/sharing"])(
    "keeps %s in light mode",
    (pathname) => {
      navigation.pathname = pathname;
      render(<ThemeProvider>Planner</ThemeProvider>);
      expect(screen.getByTestId("theme")).toHaveAttribute(
        "data-forced-theme",
        "light",
      );
    },
  );

  it("respects the caller's theme on other pages", () => {
    navigation.pathname = "/projects";
    render(<ThemeProvider forcedTheme="dark">Projects</ThemeProvider>);
    expect(screen.getByTestId("theme")).toHaveAttribute(
      "data-forced-theme",
      "dark",
    );
  });
});
