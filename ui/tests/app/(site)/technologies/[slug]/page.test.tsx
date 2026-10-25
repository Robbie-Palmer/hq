import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TechnologyPage from "@/app/(site)/technologies/[slug]/page";

vi.mock("@/components/markdown", () => ({
  Markdown: ({ source }: { source: string }) => <div>{source}</div>,
}));

vi.mock("@/components/technology/mermaid-demo", () => ({
  MermaidDemo: () => <div>Mermaid demo</div>,
}));

describe("technology page", () => {
  it("renders a governing architecture decision for Score", async () => {
    render(
      await TechnologyPage({ params: Promise.resolve({ slug: "score" }) }),
    );

    expect(
      screen.getByRole("heading", { name: "Architecture Decisions" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", {
        name: /ADR 043: Portable workload intent with target-specific packaging/,
      }),
    ).toHaveAttribute(
      "href",
      "/projects/personal-engineering-platform/adrs/043-portable-workload-contract",
    );
  });

  it("renders a configured technology demo", async () => {
    render(
      await TechnologyPage({ params: Promise.resolve({ slug: "mermaid" }) }),
    );

    expect(screen.getByRole("heading", { name: "Demo" })).toBeInTheDocument();
    expect(screen.getByText("Mermaid demo")).toBeInTheDocument();
  });
});
