import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Mermaid } from "@/components/mermaid";

const mocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(),
  resolvedTheme: "light",
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: mocks.resolvedTheme }),
}));

vi.mock("mermaid", () => ({
  default: {
    initialize: mocks.initialize,
    render: mocks.render,
  },
}));

describe("Mermaid", () => {
  beforeEach(() => {
    mocks.initialize.mockReset();
    mocks.render.mockReset();
    mocks.render.mockResolvedValue({ svg: '<svg aria-label="diagram" />' });
    mocks.resolvedTheme = "light";
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "00000000-0000-4000-8000-000000000000",
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ["light", "#ffffff", "#dbeafe", "#1f2937"],
    ["dark", "#0a0a0a", "#3b82f6", "#e5e7eb"],
  ])(
    "renders a diagram with the %s theme",
    async (theme, background, primaryColor, textColor) => {
      mocks.resolvedTheme = theme;

      const { container } = render(
        <Mermaid chart="graph TD; A --&gt; B" className="custom-diagram" />,
      );

      await waitFor(() => expect(mocks.render).toHaveBeenCalledTimes(1));

      expect(mocks.initialize).toHaveBeenCalledWith(
        expect.objectContaining({
          startOnLoad: false,
          theme: "base",
          themeVariables: expect.objectContaining({
            background,
            primaryColor,
            textColor,
          }),
        }),
      );
      expect(mocks.render).toHaveBeenCalledWith(
        "mermaid-00000000-0000-4000-8000-000000000000",
        "graph TD; A --> B",
      );
      expect(container.querySelector("svg")).toHaveAttribute(
        "aria-label",
        "diagram",
      );
      expect(container.firstChild).toHaveClass("custom-diagram");
    },
  );

  it("shows a safe error when Mermaid rejects the chart", async () => {
    mocks.render.mockRejectedValue(new Error("invalid chart"));

    render(<Mermaid chart="not a chart" />);

    expect(
      await screen.findByText("Error rendering diagram: Error: invalid chart"),
    ).toHaveClass("text-red-500");
    expect(console.error).toHaveBeenCalledWith(
      "Error rendering mermaid diagram:",
      expect.any(Error),
    );
  });
});
