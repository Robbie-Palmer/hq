import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TechnologyPage from "@/app/(site)/technologies/[slug]/page";

const { markdownSourceSpy } = vi.hoisted(() => ({
  markdownSourceSpy: vi.fn(),
}));

vi.mock("@/components/markdown", () => ({
  Markdown: ({ source }: { source: string }) => {
    markdownSourceSpy(source);
    return <div>{source}</div>;
  },
}));

vi.mock("@/components/technology/mermaid-demo", () => ({
  MermaidDemo: () => <div>Mermaid demo</div>,
}));

describe("technology page", () => {
  beforeEach(() => {
    markdownSourceSpy.mockClear();
  });

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

  it("sends a Cooklang example through the Markdown renderer", async () => {
    render(
      await TechnologyPage({
        params: Promise.resolve({ slug: "cooklang-rs" }),
      }),
    );

    expect(markdownSourceSpy).toHaveBeenCalledWith(
      expect.stringContaining("## Cooklang syntax"),
    );
    expect(markdownSourceSpy).toHaveBeenCalledWith(
      expect.stringMatching(
        /```cooklang[\s\S]*@water\{2%l\}[\s\S]*#large pot\{\}[\s\S]*~pasta\{10%minutes\}/,
      ),
    );
  });
});
