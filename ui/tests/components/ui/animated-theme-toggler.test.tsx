import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";

vi.mock("posthog-js", () => ({
  default: { capture: vi.fn() },
}));

describe("AnimatedThemeToggler", () => {
  let resolveReady: () => void;
  const animate = vi.fn();

  beforeEach(() => {
    animate.mockReset();
    document.documentElement.classList.remove("dark");
    document.documentElement.animate = animate;
    document.startViewTransition = vi.fn((update) => {
      if (typeof update === "function") update();
      return {
        ready: new Promise<void>((resolve) => {
          resolveReady = resolve;
        }),
      } as ViewTransition;
    }) as typeof document.startViewTransition;
  });

  afterEach(() => {
    // @ts-expect-error -- jsdom does not implement view transitions
    delete document.startViewTransition;
  });

  it("animates from the button after the transition is ready", async () => {
    const user = userEvent.setup();
    render(<AnimatedThemeToggler />);

    await user.click(screen.getByRole("button", { name: "Toggle theme" }));
    await act(async () => resolveReady());

    expect(document.documentElement).toHaveClass("dark");
    expect(animate).toHaveBeenCalledOnce();
  });

  it("skips the animation when the button unmounts during the transition", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<AnimatedThemeToggler />);

    await user.click(screen.getByRole("button", { name: "Toggle theme" }));
    unmount();
    await act(async () => resolveReady());

    expect(document.documentElement).toHaveClass("dark");
    expect(animate).not.toHaveBeenCalled();
  });
});
