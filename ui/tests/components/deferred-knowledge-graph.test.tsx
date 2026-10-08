import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeferredKnowledgeGraph } from "@/components/deferred-knowledge-graph";
import type { GraphData } from "@/lib/api/graph-data";

const graphData: GraphData = {
  nodes: [
    {
      id: "project:site",
      name: "Personal Knowledge Graph",
      type: "project",
      href: "/projects/site",
      connections: 0,
    },
  ],
  edges: [],
};

let intersectionCallback: IntersectionObserverCallback;
const disconnect = vi.fn();
const observe = vi.fn();

vi.mock("@/components/technology/lazy-knowledge-graph", () => ({
  LazyKnowledgeGraph: ({ data }: { data: GraphData }) => (
    <div data-testid="loaded-graph">{data.nodes[0]?.name}</div>
  ),
}));

describe("DeferredKnowledgeGraph", () => {
  beforeEach(() => {
    disconnect.mockClear();
    observe.mockClear();
    class MockIntersectionObserver {
      constructor(callback: IntersectionObserverCallback) {
        intersectionCallback = callback;
      }

      disconnect() {
        disconnect();
      }

      observe(target: Element) {
        observe(target);
      }
    }
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads graph data when the section approaches the viewport", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(graphData),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { unmount } = render(<DeferredKnowledgeGraph />);

    expect(screen.getByText("Loading graph...")).toBeVisible();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(observe).toHaveBeenCalledOnce();

    act(() => {
      intersectionCallback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });

    expect(fetchMock).toHaveBeenCalledWith("/knowledge-graph.json");
    expect(await screen.findByTestId("loaded-graph")).toHaveTextContent(
      "Personal Knowledge Graph",
    );
    unmount();
    expect(disconnect).toHaveBeenCalled();
  });

  it("reports a failed graph request", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    render(<DeferredKnowledgeGraph />);

    act(() => {
      intersectionCallback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });

    await waitFor(() =>
      expect(screen.getByText(/graph could not be loaded/i)).toBeVisible(),
    );
  });
});
