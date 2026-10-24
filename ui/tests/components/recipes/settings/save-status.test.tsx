import { describe, expect, it } from "vitest";
import { SaveStatus } from "@/components/recipes/settings/save-status";
import { render, screen } from "@/tests/test-utils";

describe("SaveStatus", () => {
  it("announces errors and supports context-specific idle copy", () => {
    const { rerender } = render(
      <SaveStatus state="idle" error={null} idleText="ready to save" />,
    );
    expect(screen.getByText("ready to save")).toBeInTheDocument();

    rerender(<SaveStatus state="error" error="Couldn't save the profile." />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Couldn't save the profile.",
    );
  });
});
