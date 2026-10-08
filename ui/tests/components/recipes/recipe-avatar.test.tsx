import { fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RecipeAvatar } from "@/components/recipes/recipe-avatar";
import { render, screen } from "@/tests/test-utils";

describe("RecipeAvatar", () => {
  it("shows the profile image when it loads", () => {
    const { container } = render(
      <RecipeAvatar name="Robbie Palmer" image="https://example.test/me.jpg" />,
    );

    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "https://example.test/me.jpg",
    );
    expect(screen.queryByText("R")).not.toBeInTheDocument();
  });

  it("falls back to the user's initial when the profile image fails", () => {
    const { container } = render(
      <RecipeAvatar name="Robbie Palmer" image="https://example.test/me.jpg" />,
    );

    const image = container.querySelector("img");
    expect(image).not.toBeNull();
    fireEvent.error(image as HTMLImageElement);

    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(screen.getByText("R")).toBeInTheDocument();
  });
});
