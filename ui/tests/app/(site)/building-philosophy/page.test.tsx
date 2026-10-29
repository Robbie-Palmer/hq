import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import BuildingPhilosophyPage, {
  metadata,
} from "@/app/(site)/building-philosophy/page";

vi.mock("@/lib/api/projects", () => ({
  getBuildingPhilosophy: () =>
    "# Building Philosophy\n\n## Short Feedback Loops\n\nShip first.",
}));

vi.mock("@/components/markdown", () => ({
  Markdown: ({ source }: { source: string }) => <article>{source}</article>,
}));

describe("building philosophy page", () => {
  it("renders the existing philosophy content in the server page", () => {
    render(<BuildingPhilosophyPage />);

    expect(screen.getByText(/# Building Philosophy/)).toHaveTextContent(
      "## Short Feedback Loops",
    );
    expect(screen.getByRole("link", { name: "Projects" })).toHaveAttribute(
      "href",
      "/projects",
    );
  });

  it("publishes title, description, canonical, and Markdown metadata", () => {
    expect(metadata).toMatchObject({
      title: "Building Philosophy",
      description:
        "Engineering principles that guide architectural decisions and technology choices",
      alternates: {
        canonical: "/building-philosophy",
        types: { "text/markdown": "/building-philosophy.md" },
      },
      openGraph: { url: "/building-philosophy" },
    });
  });
});
