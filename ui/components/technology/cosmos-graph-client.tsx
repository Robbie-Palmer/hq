"use client";

import { Graph } from "@cosmos.gl/graph";
import {
  ExternalLink,
  Filter,
  Maximize2,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import Link from "next/link";
import posthog from "posthog-js";
import {
  type CSSProperties,
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  type GraphData,
  type GraphEdge,
  type GraphNode,
  NON_NAVIGABLE_HREF,
} from "@/lib/api/graph-data";
import {
  applyDragDisplacement,
  buildDragPropagationWeights,
  getCollisionDisplacement,
} from "@/lib/domain/technology/graphDrag";
import { filterGraphData } from "@/lib/domain/technology/graphFilter";
import { calculateGraphLayout } from "@/lib/domain/technology/graphLayout";

const NODE_COLORS: Record<string, string> = {
  initiative: "#ec4899",
  idea: "#06b6d4",
  project: "#3b82f6",
  blog: "#f97316",
  role: "#a855f7",
  paper: "#ef4444",
  adr: "#64748b",
  "platform-layer": "#0f766e",
  "platform-policy": "#7c3aed",
  technology: "#22c55e",
  tag: "#eab308",
};

const NODE_TYPE_LABELS: Record<string, string> = {
  initiative: "Initiatives",
  idea: "Ideas",
  project: "Projects",
  blog: "Blog posts",
  role: "Roles",
  paper: "Research papers",
  adr: "ADRs",
  "platform-layer": "Platform layers",
  "platform-policy": "Platform policies",
  technology: "Technologies",
  tag: "Tags",
};

const TOP_LABEL_LIMIT = 14;
const COLLISION_PADDING = 5;
const FILTER_LAYOUT_DURATION = 650;
const IGNORE_SELECTION = () => undefined;
const DEFAULT_HIDDEN_TYPES = new Set<string>();

type SelectedNode = GraphNode & { totalConnections?: number };
type LabelPosition = { index: number; x: number; y: number };
type DragState = {
  rootIndex: number;
  startPositions: Float32Array;
  startPointer: [number, number];
  weights: Float32Array;
};
type GraphControls = {
  fitView: () => void;
  focus: (id: string) => void;
};

function repelNodesFromDraggedPoint(
  graph: Graph,
  positions: Float32Array,
  draggedIndex: number,
): Float32Array {
  const draggedX = positions[draggedIndex * 2];
  const draggedY = positions[draggedIndex * 2 + 1];
  if (
    typeof draggedX !== "number" ||
    typeof draggedY !== "number" ||
    !Number.isFinite(draggedX) ||
    !Number.isFinite(draggedY)
  ) {
    return positions;
  }

  const next = new Float32Array(positions);
  const draggedScreen = graph.spaceToScreenPosition([draggedX, draggedY]);
  const draggedRadius = graph.spaceToScreenRadius(
    graph.getPointRadiusByIndex(draggedIndex) ?? 0,
  );

  for (let index = 0; index < positions.length / 2; index += 1) {
    if (index === draggedIndex) continue;
    const x = positions[index * 2];
    const y = positions[index * 2 + 1];
    if (
      typeof x !== "number" ||
      typeof y !== "number" ||
      !Number.isFinite(x) ||
      !Number.isFinite(y)
    )
      continue;

    const obstacleScreen = graph.spaceToScreenPosition([x, y]);
    const obstacleRadius = graph.spaceToScreenRadius(
      graph.getPointRadiusByIndex(index) ?? 0,
    );
    const [pushX, pushY] = getCollisionDisplacement(
      draggedScreen,
      obstacleScreen,
      draggedRadius + obstacleRadius + COLLISION_PADDING,
      index,
    );
    if (pushX === 0 && pushY === 0) continue;

    const pushedPosition = graph.screenToSpacePosition([
      obstacleScreen[0] + pushX,
      obstacleScreen[1] + pushY,
    ]);
    next[index * 2] = pushedPosition[0];
    next[index * 2 + 1] = pushedPosition[1];
  }

  return next;
}

function hexToRgba(hex: string, alpha = 1): [number, number, number, number] {
  const value = hex.replace("#", "");
  return [
    Number.parseInt(value.slice(0, 2), 16) / 255,
    Number.parseInt(value.slice(2, 4), 16) / 255,
    Number.parseInt(value.slice(4, 6), 16) / 255,
    alpha,
  ];
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia(query).matches,
  );
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return matches;
}

interface CosmosCanvasProps {
  data: GraphData;
  visibleNodeIds: ReadonlySet<string>;
  visibleEdges: readonly GraphEdge[];
  interactive: boolean;
  selectedNodeId: string | null;
  onSelect: (node: SelectedNode | null) => void;
  onReady?: (controls: GraphControls | null) => void;
}

const CosmosCanvas = memo(function CosmosCanvas({
  data,
  visibleNodeIds,
  visibleEdges,
  interactive,
  selectedNodeId,
  onSelect,
  onReady,
}: CosmosCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<Graph | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const hasRenderedRef = useRef(false);
  const hoveredPointIndexRef = useRef<number | null>(null);
  const [labels, setLabels] = useState<LabelPosition[]>([]);
  const [failed, setFailed] = useState(false);
  const nodeIndex = useMemo(
    () => new Map(data.nodes.map((node, index) => [node.id, index])),
    [data.nodes],
  );

  const visibleIndices = useMemo(
    () =>
      data.nodes
        .map((node, index) => (visibleNodeIds.has(node.id) ? index : -1))
        .filter((index) => index >= 0),
    [data.nodes, visibleNodeIds],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    hasRenderedRef.current = false;
    const graph = new Graph(container, {
      backgroundColor: [0, 0, 0, 0],
      enableSimulation: false,
      enableDrag: interactive,
      enableZoom: interactive,
      fitViewOnInit: true,
      fitViewDelay: 0,
      fitViewDuration: 0,
      fitViewPadding: 0.16,
      hoveredPointCursor: interactive ? "pointer" : "default",
      linkColorInterpolateFromEndpoints: true,
      linkDefaultWidth: 1.75,
      linkGreyoutOpacity: 0.035,
      linkOpacity: 0.55,
      pixelRatio: Math.min(window.devicePixelRatio, 2),
      pointGreyoutOpacity: 0.12,
      randomSeed: 38,
      renderHoveredPointRing: interactive,
      rescalePositions: true,
      transitionDuration: 0,
      onPointMouseOver: (index) => {
        hoveredPointIndexRef.current = index;
      },
      onPointMouseOut: () => {
        if (!dragStateRef.current) hoveredPointIndexRef.current = null;
      },
      onDragStart: (event) => {
        const activeGraph = graphRef.current;
        const rootIndex = hoveredPointIndexRef.current;
        if (!activeGraph || rootIndex === null) return;
        dragStateRef.current = {
          rootIndex,
          startPositions: new Float32Array(activeGraph.getPointPositions()),
          startPointer: activeGraph.screenToSpacePosition([event.x, event.y]),
          weights: buildDragPropagationWeights(
            data.nodes.length,
            rootIndex,
            (index) => activeGraph.getNeighboringPointIndices(index),
          ),
        };
      },
      onDrag: (event) => {
        const activeGraph = graphRef.current;
        const dragState = dragStateRef.current;
        if (!activeGraph || !dragState) return;
        const pointer = activeGraph.screenToSpacePosition([event.x, event.y]);
        const positions = repelNodesFromDraggedPoint(
          activeGraph,
          applyDragDisplacement(
            dragState.startPositions,
            dragState.weights,
            pointer[0] - dragState.startPointer[0],
            pointer[1] - dragState.startPointer[1],
          ),
          dragState.rootIndex,
        );
        activeGraph.setPointPositions(positions, true);
        activeGraph.render(0, 0);
      },
      onDragEnd: () => {
        dragStateRef.current = null;
      },
      onPointClick: (index) => {
        if (!interactive) return;
        const node = data.nodes[index];
        if (!node) return;
        posthog.capture("graph_node_clicked", {
          node_id: node.id,
          node_type: node.type,
          node_label: node.name,
        });
        onSelect(node);
      },
      onBackgroundClick: () => interactive && onSelect(null),
    });
    graphRef.current = graph;

    const colors = new Float32Array(data.nodes.length * 4);
    const sizes = new Float32Array(data.nodes.length);
    for (const [index, node] of data.nodes.entries()) {
      colors.set(hexToRgba(NODE_COLORS[node.type] ?? "#94a3b8"), index * 4);
      sizes[index] = Math.min(
        18,
        4.5 + Math.sqrt(Math.max(node.connections, 1)) * 2.2,
      );
    }
    graph.setPointColors(colors);
    graph.setPointSizes(sizes);

    graph.ready
      .then(() => {
        if (graphRef.current !== graph) return;
        onReady?.({
          fitView: () => graph.fitView(0, 0.16, false),
          focus: (id) => {
            const index = nodeIndex.get(id);
            if (index !== undefined)
              graph.zoomToPointByIndex(index, 250, 2.5, true, false);
          },
        });
      })
      .catch(() => {
        if (graphRef.current === graph) setFailed(true);
      });

    return () => {
      dragStateRef.current = null;
      graphRef.current = null;
      onReady?.(null);
      graph.destroy();
    };
  }, [data, interactive, nodeIndex, onReady, onSelect]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;

    dragStateRef.current = null;
    const nextPositions = calculateGraphLayout(data.nodes, visibleNodeIds);
    const links = new Float32Array(visibleEdges.length * 2);
    for (const [index, edge] of visibleEdges.entries()) {
      links[index * 2] = nodeIndex.get(edge.source) ?? 0;
      links[index * 2 + 1] = nodeIndex.get(edge.target) ?? 0;
    }
    const shouldAnimate =
      hasRenderedRef.current &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const transitionDuration = shouldAnimate ? FILTER_LAYOUT_DURATION : 0;
    graph.setPointPositions(nextPositions);
    graph.setLinks(links);
    graph.render(0, transitionDuration);
    if (hasRenderedRef.current && visibleIndices.length > 0) {
      graph.fitView(transitionDuration, 0.16, false);
    }
    hasRenderedRef.current = true;

    const topIndices = [...visibleIndices]
      .sort(
        (a, b) =>
          (data.nodes[b]?.connections ?? 0) - (data.nodes[a]?.connections ?? 0),
      )
      .slice(0, TOP_LABEL_LIMIT);
    graph.trackPointPositionsByIndices(topIndices);
    const updateLabels = () => {
      if (!graph.isReady) return;
      const tracked = graph.getTrackedPointPositionsMap();
      const nextLabels = topIndices.flatMap((index) => {
        const position = tracked.get(index);
        if (!position) return [];
        const [x, y] = graph.spaceToScreenPosition(position);
        return Number.isFinite(x) && Number.isFinite(y)
          ? [{ index, x, y }]
          : [];
      });
      setLabels((currentLabels) =>
        currentLabels.length === nextLabels.length &&
        currentLabels.every(
          (label, position) =>
            label.index === nextLabels[position]?.index &&
            label.x === nextLabels[position]?.x &&
            label.y === nextLabels[position]?.y,
        )
          ? currentLabels
          : nextLabels,
      );
    };
    const interval = window.setInterval(updateLabels, 120);
    return () => window.clearInterval(interval);
  }, [data.nodes, nodeIndex, visibleEdges, visibleIndices, visibleNodeIds]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    if (!selectedNodeId) {
      graph.setConfigPartial({
        focusedPointIndex: undefined,
        highlightedLinkIndices: undefined,
        highlightedPointIndices: undefined,
      });
      return;
    }
    const selectedIndex = nodeIndex.get(selectedNodeId);
    if (selectedIndex === undefined) return;
    const highlightedPoints = [
      selectedIndex,
      ...graph.getNeighboringPointIndices(selectedIndex),
    ];
    graph.setConfigPartial({
      focusedPointIndex: selectedIndex,
      highlightedPointIndices: highlightedPoints,
      highlightedLinkIndices: graph.getConnectedLinkIndices(highlightedPoints),
    });
  }, [nodeIndex, selectedNodeId]);

  if (failed) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        Interactive graphics are unavailable on this device. Use the accessible
        graph index below.
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div
        ref={containerRef}
        className="absolute inset-0"
        style={{ pointerEvents: interactive ? "auto" : "none" }}
        aria-hidden="true"
      />
      {labels.map(({ index, x, y }) => {
        const node = data.nodes[index];
        if (!node) return null;
        return (
          <span
            key={node.id}
            aria-hidden="true"
            className="pointer-events-none absolute max-w-32 -translate-y-1/2 truncate rounded-full border border-background/30 bg-background/75 px-1.5 py-0.5 text-[10px] font-medium leading-none shadow-sm backdrop-blur-sm"
            style={{ left: x + 7, top: y } as CSSProperties}
          >
            {node.name}
          </span>
        );
      })}
    </div>
  );
});

function FilterControls({
  data,
  hiddenTypes,
  minConnections,
  onToggleType,
  onMinConnections,
}: Readonly<{
  data: GraphData;
  hiddenTypes: ReadonlySet<string>;
  minConnections: number;
  onToggleType: (type: string) => void;
  onMinConnections: (value: number) => void;
}>) {
  const minConnectionsId = useId();
  const nodeTypes = useMemo(
    () =>
      [...new Set(data.nodes.map((node) => node.type))].sort((left, right) =>
        left.localeCompare(right),
      ),
    [data.nodes],
  );
  const maxConnections = Math.max(
    ...data.nodes.map((node) => node.connections),
    1,
  );
  return (
    <div className="space-y-3">
      <div className="flex gap-2 overflow-x-auto pb-1 sm:flex-wrap">
        {nodeTypes.map((type) => {
          const hidden = hiddenTypes.has(type);
          return (
            <button
              key={type}
              type="button"
              aria-pressed={!hidden}
              onClick={() => onToggleType(type)}
              className={`flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                hidden
                  ? "border-border/50 bg-muted/20 text-muted-foreground/50 line-through"
                  : "border-border bg-muted/60 text-foreground hover:bg-muted"
              }`}
            >
              <span
                className="size-2.5 rounded-full"
                style={{
                  backgroundColor: hidden ? "#94a3b8" : NODE_COLORS[type],
                }}
              />
              {NODE_TYPE_LABELS[type] ?? type}
            </button>
          );
        })}
      </div>
      <div className="flex min-h-9 items-center gap-3">
        <label
          htmlFor={minConnectionsId}
          className="shrink-0 text-xs text-muted-foreground"
        >
          Min connections
        </label>
        <input
          id={minConnectionsId}
          type="range"
          min={0}
          max={maxConnections}
          value={Math.min(minConnections, maxConnections)}
          onChange={(event) => onMinConnections(Number(event.target.value))}
          className="h-6 min-w-28 flex-1 accent-primary"
        />
        <span className="w-7 text-right text-xs font-medium tabular-nums">
          {minConnections}
        </span>
      </div>
    </div>
  );
}

function NodeDetails({
  node,
  onClose,
}: Readonly<{
  node: SelectedNode;
  onClose: () => void;
}>) {
  return (
    <Card className="gap-3 border-primary/20 bg-background/95 p-4 shadow-xl backdrop-blur">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <span
              className="size-2.5 rounded-full"
              style={{ backgroundColor: NODE_COLORS[node.type] }}
            />
            {NODE_TYPE_LABELS[node.type] ?? node.type}
          </div>
          <h4 className="text-base font-semibold leading-tight">{node.name}</h4>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label="Close node details"
        >
          <X className="size-4" />
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        {node.connections} visible connection{node.connections === 1 ? "" : "s"}
        {node.totalConnections !== undefined &&
        node.totalConnections !== node.connections
          ? `, ${node.totalConnections} total`
          : ""}
      </p>
      {node.href !== NON_NAVIGABLE_HREF && (
        <Button asChild size="sm" className="w-full gap-2">
          <Link href={node.href}>
            Open page <ExternalLink className="size-3.5" />
          </Link>
        </Button>
      )}
    </Card>
  );
}

function AccessibleGraphIndex({
  nodes,
}: Readonly<{ nodes: readonly SelectedNode[] }>) {
  return (
    <details className="border-t px-4 py-3 text-sm">
      <summary className="cursor-pointer font-medium">
        Accessible graph index ({nodes.length})
      </summary>
      <ul className="mt-3 grid max-h-72 gap-1 overflow-y-auto sm:grid-cols-2">
        {[...nodes]
          .sort(
            (a, b) =>
              b.connections - a.connections || a.name.localeCompare(b.name),
          )
          .map((node) => (
            <li key={node.id}>
              {node.href === NON_NAVIGABLE_HREF ? (
                <span className="block rounded px-2 py-1.5 text-muted-foreground">
                  {node.name} · {node.connections}
                </span>
              ) : (
                <Link
                  className="block rounded px-2 py-1.5 hover:bg-muted"
                  href={node.href}
                >
                  {node.name} · {node.connections}
                </Link>
              )}
            </li>
          ))}
      </ul>
    </details>
  );
}

export function CosmosGraphClient({ data }: Readonly<{ data: GraphData }>) {
  const isMobile = useMediaQuery("(max-width: 639px)");
  const [explorerOpen, setExplorerOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(
    () => new Set(DEFAULT_HIDDEN_TYPES),
  );
  const [minConnections, setMinConnections] = useState(0);
  const [selectedNode, setSelectedNode] = useState<SelectedNode | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const inlineControlsRef = useRef<GraphControls | null>(null);
  const explorerControlsRef = useRef<GraphControls | null>(null);
  const explorerTitleRef = useRef<HTMLHeadingElement>(null);

  const filtered = useMemo(
    () => filterGraphData(data, hiddenTypes, minConnections),
    [data, hiddenTypes, minConnections],
  );
  const filteredNodesRef = useRef(filtered.nodes);
  filteredNodesRef.current = filtered.nodes;
  const visibleNodeIds = useMemo(
    () => new Set(filtered.nodes.map((node) => node.id)),
    [filtered.nodes],
  );
  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    if (!query) return [];
    return filtered.nodes
      .filter((node) => node.name.toLocaleLowerCase().includes(query))
      .slice(0, 6);
  }, [filtered.nodes, searchQuery]);

  const toggleType = useCallback((type: string) => {
    setHiddenTypes((current) => {
      const next = new Set(current);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
    setSelectedNode(null);
  }, []);

  const selectNode = useCallback((node: SelectedNode | null) => {
    if (!node) {
      setSelectedNode(null);
      return;
    }
    const filteredNode = filteredNodesRef.current.find(
      (candidate) => candidate.id === node.id,
    );
    setSelectedNode(filteredNode ?? node);
  }, []);
  const storeInlineControls = useCallback((controls: GraphControls | null) => {
    inlineControlsRef.current = controls;
  }, []);
  const storeExplorerControls = useCallback(
    (controls: GraphControls | null) => {
      explorerControlsRef.current = controls;
    },
    [],
  );
  const activeControls = () =>
    explorerOpen ? explorerControlsRef.current : inlineControlsRef.current;

  const reset = () => {
    setHiddenTypes(new Set(DEFAULT_HIDDEN_TYPES));
    setMinConnections(0);
    setSelectedNode(null);
    setSearchQuery("");
    window.setTimeout(() => activeControls()?.fitView(), 80);
  };

  const inlineGraph = (
    <CosmosCanvas
      data={data}
      visibleNodeIds={visibleNodeIds}
      visibleEdges={filtered.edges}
      interactive
      selectedNodeId={selectedNode?.id ?? null}
      onSelect={selectNode}
      onReady={storeInlineControls}
    />
  );
  const explorerGraph = (
    <CosmosCanvas
      data={data}
      visibleNodeIds={visibleNodeIds}
      visibleEdges={filtered.edges}
      interactive
      selectedNodeId={selectedNode?.id ?? null}
      onSelect={selectNode}
      onReady={storeExplorerControls}
    />
  );

  return (
    <Card className="overflow-hidden p-0 gap-0">
      <div className="space-y-3 p-4 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="mt-0 text-lg font-semibold">Knowledge graph</h3>
            <p className="text-sm text-muted-foreground">
              Explore projects, research papers, decisions, writing, roles, and
              the technology connecting them.
            </p>
          </div>
          {!isMobile && (
            <div className="flex shrink-0 gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setExplorerOpen(true)}
                className="gap-2"
              >
                <Maximize2 className="size-3.5" /> Full screen
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={reset}
                className="gap-2"
              >
                <RotateCcw className="size-3.5" /> Reset
              </Button>
            </div>
          )}
        </div>
        {!isMobile && (
          <FilterControls
            data={data}
            hiddenTypes={hiddenTypes}
            minConnections={minConnections}
            onToggleType={toggleType}
            onMinConnections={(value) => {
              setMinConnections(value);
              setSelectedNode(null);
            }}
          />
        )}
      </div>

      {isMobile ? (
        <div className="relative h-[22rem] border-y bg-muted/10">
          <div className="h-full -translate-y-3">
            <CosmosCanvas
              data={data}
              visibleNodeIds={visibleNodeIds}
              visibleEdges={filtered.edges}
              interactive={false}
              selectedNodeId={null}
              onSelect={IGNORE_SELECTION}
            />
          </div>
          <div className="absolute inset-x-0 bottom-2 flex justify-center">
            <Button
              onClick={() => setExplorerOpen(true)}
              className="gap-2 shadow-lg"
            >
              <Maximize2 className="size-4" /> Explore the graph
            </Button>
          </div>
        </div>
      ) : (
        <div className="relative h-[min(68vh,680px)] min-h-[520px] border-y bg-muted/10">
          {inlineGraph}
          <div className="absolute left-4 top-4 w-72">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Find a node"
                aria-label="Find a node"
                className="h-9 w-full rounded-md border bg-background/90 pl-9 pr-3 text-sm shadow-sm backdrop-blur"
              />
              {searchResults.length > 0 && (
                <div className="mt-1 overflow-hidden rounded-md border bg-background shadow-lg">
                  {searchResults.map((node) => (
                    <button
                      key={node.id}
                      type="button"
                      onClick={() => {
                        selectNode(node);
                        inlineControlsRef.current?.focus(node.id);
                        setSearchQuery("");
                      }}
                      className="block w-full truncate px-3 py-2 text-left text-sm hover:bg-muted"
                    >
                      {node.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          {selectedNode && (
            <div className="absolute bottom-4 left-4 w-80">
              <NodeDetails
                node={selectedNode}
                onClose={() => setSelectedNode(null)}
              />
            </div>
          )}
        </div>
      )}

      <AccessibleGraphIndex nodes={filtered.nodes} />

      <Sheet
        open={explorerOpen}
        onOpenChange={(open) => {
          setExplorerOpen(open);
          if (!open) setFiltersOpen(false);
        }}
      >
        <SheetContent
          className="inset-0 h-dvh w-screen max-w-none !translate-x-0 gap-0 border-0 p-0 sm:max-w-none"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            explorerTitleRef.current?.focus();
          }}
        >
          <SheetHeader className="border-b pr-14">
            <SheetTitle
              ref={explorerTitleRef}
              tabIndex={-1}
              className="outline-none"
            >
              Explore the knowledge graph
            </SheetTitle>
            <SheetDescription>
              Drag nodes, pan the canvas, and scroll or pinch to zoom.
            </SheetDescription>
          </SheetHeader>
          <div className="relative min-h-0 flex-1 bg-muted/10">
            {explorerGraph}
            <div className="absolute left-3 right-3 top-3 flex gap-2">
              <div className="relative min-w-0 flex-1">
                <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Find a node"
                  aria-label="Find a node"
                  className="h-10 w-full rounded-md border bg-background/90 pl-9 pr-3 text-sm shadow-sm"
                />
                {searchResults.length > 0 && (
                  <div className="mt-1 overflow-hidden rounded-md border bg-background shadow-lg">
                    {searchResults.map((node) => (
                      <button
                        key={node.id}
                        type="button"
                        onClick={() => {
                          selectNode(node);
                          explorerControlsRef.current?.focus(node.id);
                          setSearchQuery("");
                        }}
                        className="block w-full truncate px-3 py-2 text-left text-sm"
                      >
                        {node.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <Button
                size="icon"
                variant="secondary"
                onClick={() => setFiltersOpen((value) => !value)}
                aria-label="Graph filters"
              >
                <Filter className="size-4" />
              </Button>
              <Button
                size="icon"
                variant="secondary"
                onClick={reset}
                aria-label="Reset graph"
              >
                <RotateCcw className="size-4" />
              </Button>
            </div>
            {filtersOpen && (
              <div className="absolute left-3 right-3 top-16 rounded-lg border bg-background/95 p-3 shadow-xl backdrop-blur">
                <FilterControls
                  data={data}
                  hiddenTypes={hiddenTypes}
                  minConnections={minConnections}
                  onToggleType={toggleType}
                  onMinConnections={(value) => {
                    setMinConnections(value);
                    setSelectedNode(null);
                  }}
                />
              </div>
            )}
            {selectedNode && (
              <div className="absolute inset-x-3 bottom-3">
                <NodeDetails
                  node={selectedNode}
                  onClose={() => setSelectedNode(null)}
                />
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </Card>
  );
}
