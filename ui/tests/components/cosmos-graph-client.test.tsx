import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CosmosGraphClient } from "@/components/technology/cosmos-graph-client";
import type { GraphData } from "@/lib/api/graph-data";

type PointerEvent = { x: number; y: number };
type GraphCallbacks = {
  enableDrag: boolean;
  onBackgroundClick: () => void;
  onDrag: (event: PointerEvent) => void;
  onDragEnd: () => void;
  onDragStart: (event: PointerEvent) => void;
  onPointClick: (index: number) => void;
  onPointMouseOut: () => void;
  onPointMouseOver: (index: number) => void;
};
type MockGraph = {
  config: GraphCallbacks;
  destroy: ReturnType<typeof vi.fn>;
  fitView: ReturnType<typeof vi.fn>;
  getPointPositions: ReturnType<typeof vi.fn>;
  render: ReturnType<typeof vi.fn>;
  setConfigPartial: ReturnType<typeof vi.fn>;
  setPointPositions: ReturnType<typeof vi.fn>;
  zoomToPointByIndex: ReturnType<typeof vi.fn>;
};

const graphState = vi.hoisted(() => ({
  instances: [] as MockGraph[],
  readyQueue: [] as Promise<void>[],
  rejectReady: false,
}));
const capture = vi.hoisted(() => vi.fn());

vi.mock("posthog-js", () => ({ default: { capture } }));

vi.mock("@cosmos.gl/graph", () => ({
  Graph: class {
    config: GraphCallbacks;
    destroy = vi.fn();
    fitView = vi.fn();
    getConnectedLinkIndices = vi.fn(() => [0]);
    getNeighboringPointIndices = vi.fn((index: number) =>
      index === 0 ? [1] : [0],
    );
    getPointPositions = vi.fn(() => new Float32Array(this.positions));
    getPointRadiusByIndex = vi.fn(() => 6);
    getTrackedPointPositionsMap = vi.fn(() => {
      const tracked = new Map<number, [number, number]>();
      for (const index of this.trackedIndices) {
        const x = this.positions[index * 2];
        const y = this.positions[index * 2 + 1];
        if (Number.isFinite(x) && Number.isFinite(y)) {
          tracked.set(index, [x ?? 0, y ?? 0]);
        }
      }
      return tracked;
    });
    isReady = true;
    positions = new Float32Array();
    ready: Promise<void>;
    render = vi.fn();
    screenToSpacePosition = vi.fn(([x, y]: [number, number]) => [x, y]);
    setConfigPartial = vi.fn();
    setLinks = vi.fn();
    setPointColors = vi.fn();
    setPointPositions = vi.fn((positions: Float32Array) => {
      this.positions = new Float32Array(positions);
    });
    setPointSizes = vi.fn();
    spaceToScreenPosition = vi.fn(([x, y]: [number, number]) => [x, y]);
    spaceToScreenRadius = vi.fn((radius: number) => radius);
    trackPointPositionsByIndices = vi.fn((indices: number[]) => {
      this.trackedIndices = indices;
    });
    trackedIndices: number[] = [];
    zoomToPointByIndex = vi.fn();

    constructor(_container: HTMLDivElement, config: GraphCallbacks) {
      this.config = config;
      this.ready =
        graphState.readyQueue.shift() ??
        (graphState.rejectReady
          ? Promise.reject(new Error("WebGL unavailable"))
          : Promise.resolve());
      graphState.instances.push(this);
    }
  },
}));

const data: GraphData = {
  nodes: [
    {
      id: "project:site",
      name: "Personal Knowledge Graph",
      type: "project",
      href: "/projects/personal-knowledge-graph",
      connections: 2,
    },
    {
      id: "technology:react",
      name: "React",
      type: "technology",
      href: "/technologies/react",
      connections: 1,
    },
    {
      id: "tag:web",
      name: "#web",
      type: "tag",
      href: "#",
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
      source: "project:site",
      target: "tag:web",
      type: "HAS_TAG",
    },
  ],
};

function mockMedia({ mobile = false, reducedMotion = false } = {}) {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query): MediaQueryList =>
      ({
        matches: query.includes("max-width") ? mobile : reducedMotion,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(() => false),
      }) as MediaQueryList,
  );
}

function currentGraph(): MockGraph {
  const graph = graphState.instances.at(-1);
  if (!graph) throw new Error("Expected a graph instance");
  return graph;
}

describe("CosmosGraphClient", () => {
  beforeEach(() => {
    graphState.instances.length = 0;
    graphState.readyQueue.length = 0;
    graphState.rejectReady = false;
    capture.mockReset();
    mockMedia();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("reuses the canvas and animates to a centred layout when filters change", async () => {
    const user = userEvent.setup();
    render(<CosmosGraphClient data={data} />);

    expect(
      screen.getByRole("heading", { name: "Knowledge graph" }),
    ).toBeVisible();
    expect(screen.getByText("Accessible graph index (3)")).toBeVisible();
    expect(graphState.instances).toHaveLength(1);
    const graph = currentGraph();
    expect(graph.render).toHaveBeenLastCalledWith(0, 0);

    await user.click(screen.getByRole("button", { name: "Projects" }));

    expect(graphState.instances).toHaveLength(1);
    expect(graph.destroy).not.toHaveBeenCalled();
    expect(graph.render).toHaveBeenLastCalledWith(0, 650);
    expect(graph.fitView).toHaveBeenLastCalledWith(650, 0.16, false);
    expect(screen.getByText("Accessible graph index (2)")).toBeVisible();

    fireEvent.change(screen.getByLabelText("Min connections"), {
      target: { value: "1" },
    });
    expect(screen.getByText("1")).toBeVisible();
  });

  it("offers research papers as a visible graph type", () => {
    render(
      <CosmosGraphClient
        data={{
          nodes: [
            ...data.nodes,
            {
              id: "paper:site",
              name: "A Site Paper",
              type: "paper",
              href: "https://doi.org/10.1000/site",
              connections: 1,
            },
          ],
          edges: [
            ...data.edges,
            {
              source: "project:site",
              target: "paper:site",
              type: "HAS_RESEARCH_PAPER",
            },
          ],
        }}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Research papers" }),
    ).toBeVisible();
  });

  it("supports selection, search, direct dragging, reset, and full screen", async () => {
    const user = userEvent.setup();
    render(<CosmosGraphClient data={data} />);
    const inlineGraph = currentGraph();

    act(() => inlineGraph.config.onPointClick(0));
    expect(capture).toHaveBeenCalledWith("graph_node_clicked", {
      node_id: "project:site",
      node_label: "Personal Knowledge Graph",
      node_type: "project",
    });
    expect(screen.getByRole("link", { name: /open page/i })).toHaveAttribute(
      "href",
      "/projects/personal-knowledge-graph",
    );

    await user.click(
      screen.getByRole("button", { name: "Close node details" }),
    );
    expect(screen.queryByRole("link", { name: /open page/i })).toBeNull();

    const search = screen.getByRole("searchbox", { name: "Find a node" });
    await user.type(search, "react");
    await user.click(screen.getByRole("button", { name: "React" }));
    expect(inlineGraph.zoomToPointByIndex).toHaveBeenCalledWith(
      1,
      250,
      2.5,
      true,
      false,
    );

    act(() => {
      inlineGraph.config.onPointMouseOver(0);
      inlineGraph.config.onDragStart({ x: 0, y: 0 });
      inlineGraph.config.onDrag({ x: 20, y: 8 });
      inlineGraph.config.onDragEnd();
      inlineGraph.config.onPointMouseOut();
      inlineGraph.config.onBackgroundClick();
    });
    expect(inlineGraph.setPointPositions).toHaveBeenCalled();
    expect(inlineGraph.render).toHaveBeenLastCalledWith(0, 0);

    await user.click(screen.getByRole("button", { name: "Full screen" }));
    const dialog = screen.getByRole("dialog", {
      name: "Explore the knowledge graph",
    });
    expect(dialog).toBeVisible();
    expect(graphState.instances).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Graph filters" }));
    expect(within(dialog).getByLabelText("Min connections")).toBeVisible();
    const explorerGraph = currentGraph();
    const fitViewCallsBeforeReset = explorerGraph.fitView.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "Reset graph" }));
    await waitFor(() => {
      expect(explorerGraph.fitView.mock.calls.length).toBeGreaterThan(
        fitViewCallsBeforeReset,
      );
      expect(explorerGraph.fitView).toHaveBeenCalledWith(0, 0.16, false);
    });

    await user.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() =>
      expect(graphState.instances[1]?.destroy).toHaveBeenCalled(),
    );
  });

  it("renders a passive mobile preview and opens the touch explorer without focusing search", async () => {
    mockMedia({ mobile: true });
    const user = userEvent.setup();
    render(<CosmosGraphClient data={data} />);

    expect(currentGraph().config.enableDrag).toBe(false);
    expect(screen.queryByRole("button", { name: "Full screen" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Explore the graph" }));
    expect(graphState.instances).toHaveLength(2);
    expect(currentGraph().config.enableDrag).toBe(true);
    expect(
      screen.getByRole("searchbox", { name: "Find a node" }),
    ).not.toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Graph filters" }));
    await user.click(screen.getByRole("button", { name: "Tags" }));
    expect(screen.getByText("Accessible graph index (2)")).toBeVisible();
  });

  it("snaps filter layouts when reduced motion is requested", async () => {
    mockMedia({ reducedMotion: true });
    const user = userEvent.setup();
    render(<CosmosGraphClient data={data} />);
    const graph = currentGraph();

    await user.click(screen.getByRole("button", { name: "Technologies" }));

    expect(graph.render).toHaveBeenLastCalledWith(0, 0);
    expect(graph.fitView).toHaveBeenLastCalledWith(0, 0.16, false);
  });

  it("shows the accessible fallback when WebGL setup fails", async () => {
    graphState.rejectReady = true;
    render(<CosmosGraphClient data={data} />);

    expect(
      await screen.findByText(/interactive graphics are unavailable/i),
    ).toBeVisible();
    expect(screen.getByText("Accessible graph index (3)")).toBeVisible();
  });

  it("ignores a readiness failure from a superseded canvas", async () => {
    let rejectSuperseded!: (reason?: unknown) => void;
    graphState.readyQueue.push(
      new Promise<void>((_resolve, reject) => {
        rejectSuperseded = reject;
      }),
      Promise.resolve(),
    );
    const { rerender } = render(<CosmosGraphClient data={data} />);
    const supersededGraph = currentGraph();

    const updatedData = { ...data, nodes: [...data.nodes] };
    rerender(<CosmosGraphClient data={updatedData} />);
    expect(graphState.instances).toHaveLength(2);
    expect(supersededGraph.destroy).toHaveBeenCalled();

    await act(async () => {
      rejectSuperseded(new Error("Old WebGL context failed"));
      await Promise.resolve();
    });

    expect(
      screen.queryByText(/interactive graphics are unavailable/i),
    ).toBeNull();
    expect(currentGraph().destroy).not.toHaveBeenCalled();
  });
});
