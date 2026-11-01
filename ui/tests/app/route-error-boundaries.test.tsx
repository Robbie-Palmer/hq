import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentType, ReactNode } from "react";
import { Component } from "react";
import { describe, expect, it, vi } from "vitest";
import DeckError from "@/app/(deck)/error";
import SiteError from "@/app/(site)/error";
import RecipesError from "@/app/recipes/error";

interface ErrorViewProps {
  error: Error & { digest?: string };
  reset(): void;
}

interface BoundaryHarnessProps {
  children: ReactNode;
  errorView: ComponentType<ErrorViewProps>;
}

interface BoundaryHarnessState {
  error: Error | null;
  resetCount: number;
}

class BoundaryHarness extends Component<
  BoundaryHarnessProps,
  BoundaryHarnessState
> {
  state: BoundaryHarnessState = { error: null, resetCount: 0 };

  static getDerivedStateFromError(error: Error): BoundaryHarnessState {
    return { error, resetCount: 0 };
  }

  reset = () => {
    this.setState(({ resetCount }) => ({
      error: null,
      resetCount: resetCount + 1,
    }));
  };

  render() {
    const { children, errorView: ErrorView } = this.props;
    const { error, resetCount } = this.state;

    if (error) return <ErrorView error={error} reset={this.reset} />;
    if (resetCount > 0) return <p>Route recovered</p>;
    return children;
  }
}

function ThrowRouteError({ message }: Readonly<{ message: string }>): never {
  throw new Error(message);
}

describe("route error boundaries", () => {
  it.each([
    {
      ErrorView: SiteError,
      failure: "project repository failed",
      heading: "This page could not be loaded",
      retry: "Try again",
      escapeAction: { name: "Return home", href: "/" },
    },
    {
      ErrorView: DeckError,
      failure: "deck renderer failed",
      heading: "The presentation stopped",
      retry: "Retry deck",
      escapeAction: { name: "View projects", href: "/projects" },
    },
    {
      ErrorView: RecipesError,
      failure: "recipe provider failed",
      heading: "This recipe page could not be opened",
      retry: "Try again",
      escapeAction: { name: "Back to recipes", href: "/recipes" },
    },
  ])(
    "recovers from $failure with its route-specific actions",
    async ({ ErrorView, escapeAction, failure, heading, retry }) => {
      const user = userEvent.setup();
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);

      render(
        <BoundaryHarness errorView={ErrorView}>
          <ThrowRouteError message={failure} />
        </BoundaryHarness>,
      );

      expect(screen.getByRole("heading", { name: heading })).toBeVisible();
      expect(
        screen.getByRole("link", { name: escapeAction.name }),
      ).toHaveAttribute("href", escapeAction.href);

      await user.click(screen.getByRole("button", { name: retry }));

      expect(screen.getByText("Route recovered")).toBeVisible();
      consoleError.mockRestore();
    },
  );
});
