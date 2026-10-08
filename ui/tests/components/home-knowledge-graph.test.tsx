import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HomeKnowledgeGraph } from "@/components/home-knowledge-graph";
import type { GraphData } from "@/lib/api/graph-data";

const repository = vi.hoisted(() => ({ id: "repository" }));
const graphData = vi.hoisted<GraphData>(() => ({
  nodes: [
    {
      id: "project:site",
      name: "Personal Knowledge Graph",
      type: "project",
      href: "/projects/site",
      connections: 2,
    },
    {
      id: "blog:post",
      name: "A post",
      type: "blog",
      href: "/blog/post",
      connections: 1,
    },
    {
      id: "technology:react",
      name: "React",
      type: "technology",
      href: "/technologies/react",
      connections: 1,
    },
  ],
  edges: [
    {
      source: "project:site",
      target: "technology:react",
      type: "USES_TECHNOLOGY",
    },
    {
      source: "blog:post",
      target: "technology:react",
      type: "USES_TECHNOLOGY",
    },
  ],
}));

const extractGraphData = vi.hoisted(() => vi.fn(() => graphData));
const loadDomainRepository = vi.hoisted(() => vi.fn(() => repository));

vi.mock("@/lib/api/graph-data", () => ({ extractGraphData }));
vi.mock("@/lib/domain", () => ({ loadDomainRepository }));
vi.mock("@/components/deferred-knowledge-graph", () => ({
  DeferredKnowledgeGraph: () => (
    <div data-testid="knowledge-graph">Deferred graph</div>
  ),
}));

describe("HomeKnowledgeGraph", () => {
  it("summarizes and renders the site graph", () => {
    render(<HomeKnowledgeGraph />);

    expect(
      screen.getByRole("heading", { name: "Follow the connections" }),
    ).toBeVisible();
    expect(screen.getByText("Inside the site")).toBeVisible();
    expect(screen.getByText("items").nextElementSibling).toHaveTextContent("3");
    expect(
      screen.getByText("connections").nextElementSibling,
    ).toHaveTextContent("2");
    expect(
      screen.getByText("content types").nextElementSibling,
    ).toHaveTextContent("3");
    expect(screen.getByTestId("knowledge-graph")).toHaveTextContent(
      "Deferred graph",
    );
    expect(loadDomainRepository).toHaveBeenCalledOnce();
    expect(extractGraphData).toHaveBeenCalledWith(repository);
  });
});
