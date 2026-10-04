import {
  type LayeredGraphEdge,
  layeredGraphNodeDepths,
  orderLayeredGraphNodes,
} from "ts-base/layered-graph";
import type { FlowSankeyData, FlowSankeyNode } from "@/lib/assettracker";

export const FLOW_SANKEY_NODE_WIDTH = 12;
export const FLOW_SANKEY_LINK_COLOR = "hsl(220, 70%, 50%)";

const COMPACT_NODE_PADDING = 14;
const LABELED_NODE_PADDING = 18;
const COMPACT_BASE_HEIGHT = 280;
const LABELED_BASE_HEIGHT = 320;
const MIN_NODE_HEIGHT = 2;
const LABEL_GAP = 8;
const MIN_LABEL_WIDTH = 48;
const MAX_LABEL_WIDTH = 136;
const MIN_LABELED_WIDTH = 640;
const MAX_CHART_HEIGHT = 720;

const COMPACT_MARGIN = { top: 8, right: 12, bottom: 8, left: 12 };
const LABELED_MARGIN = { top: 8, right: 140, bottom: 8, left: 120 };

export type FlowSankeyLayout = {
  chartHeight: number;
  labelWidths: {
    left: number;
    middle: number;
    right: number;
  };
  margin: typeof COMPACT_MARGIN;
  maxDepth: number;
  nodePadding: number;
  showLabels: boolean;
};

export type FlowSankeyRenderNode = FlowSankeyNode & {
  flowKey?: string;
  isWaypoint?: boolean;
};

export type FlowSankeyRenderLink = FlowSankeyData["links"][number] & {
  flowKey: string;
};

export type FlowSankeyRenderData = Omit<FlowSankeyData, "links" | "nodes"> & {
  nodes: FlowSankeyRenderNode[];
  links: FlowSankeyRenderLink[];
};

function graphEdges(data: FlowSankeyData): LayeredGraphEdge[] {
  return data.links.flatMap(({ source, target, value }) =>
    Number.isFinite(value) && value >= 0
      ? [{ source, target, weight: value }]
      : [],
  );
}

function nodeDepths(data: FlowSankeyData): number[] {
  return layeredGraphNodeDepths(data.nodes.length, graphEdges(data));
}

export function addFlowSankeyWaypoints(
  data: FlowSankeyData,
): FlowSankeyRenderData {
  const depths = nodeDepths(data);
  const nodes: FlowSankeyRenderNode[] = [...data.nodes];
  const nodeIds = new Set(nodes.map((node) => node.id));
  const links = data.links.flatMap((link, linkIndex) => {
    if (
      !Number.isInteger(link.source) ||
      !Number.isInteger(link.target) ||
      link.source < 0 ||
      link.target < 0 ||
      link.source >= data.nodes.length ||
      link.target >= data.nodes.length ||
      !Number.isFinite(link.value) ||
      link.value < 0
    ) {
      return [];
    }
    const flowKey = `flow:${linkIndex}`;
    const sourceDepth = depths[link.source] ?? 0;
    const targetDepth = depths[link.target] ?? sourceDepth + 1;
    const segments = [];
    let source = link.source;

    for (let depth = sourceDepth + 1; depth < targetDepth; depth += 1) {
      const target = nodes.length;
      const idPrefix = `__flow_waypoint:${linkIndex}:${depth}`;
      let id = idPrefix;
      let suffix = 1;
      while (nodeIds.has(id)) {
        id = `${idPrefix}:${suffix}`;
        suffix += 1;
      }
      nodeIds.add(id);
      nodes.push({
        id,
        name: "",
        color: FLOW_SANKEY_LINK_COLOR,
        flowKey,
        isWaypoint: true,
      });
      segments.push({ ...link, flowKey, source, target });
      source = target;
    }

    segments.push({ ...link, flowKey, source, target: link.target });
    return segments;
  });

  return { ...data, nodes, links };
}

function remapFlowSankeyData(
  data: FlowSankeyRenderData,
  orderedNodeIndexes: number[],
): FlowSankeyRenderData {
  const remappedIndexes = new Map(
    orderedNodeIndexes.map((nodeIndex, nextIndex) => [nodeIndex, nextIndex]),
  );
  const remappedIndex = (nodeIndex: number): number => {
    const index = remappedIndexes.get(nodeIndex);
    if (index == null) {
      throw new RangeError(`Missing remapped Sankey node ${nodeIndex}`);
    }
    return index;
  };
  return {
    ...data,
    nodes: orderedNodeIndexes.flatMap((nodeIndex) => {
      const node = data.nodes[nodeIndex];
      return node ? [node] : [];
    }),
    links: data.links.map((link) => ({
      ...link,
      source: remappedIndex(link.source),
      target: remappedIndex(link.target),
    })),
  };
}

function orderFlowSankeyData(data: FlowSankeyRenderData): FlowSankeyRenderData {
  const orderedNodeIndexes = orderLayeredGraphNodes(
    data.nodes.length,
    graphEdges(data),
  );
  return remapFlowSankeyData(data, orderedNodeIndexes);
}

export function prepareFlowSankeyData(
  data: FlowSankeyData,
): FlowSankeyRenderData {
  return orderFlowSankeyData(addFlowSankeyWaypoints(data));
}

export function flowKeysForNode(
  data: FlowSankeyRenderData,
  nodeId: string,
): Set<string> {
  const nodeIndex = data.nodes.findIndex((node) => node.id === nodeId);
  if (nodeIndex < 0) return new Set();
  return new Set(
    data.links.flatMap((link) =>
      link.source === nodeIndex || link.target === nodeIndex
        ? [link.flowKey]
        : [],
    ),
  );
}

export function nodeIdsForFlow(
  data: FlowSankeyRenderData,
  flowKey: string,
): Set<string> {
  const nodeIds = new Set<string>();
  for (const link of data.links) {
    if (link.flowKey !== flowKey) continue;
    for (const nodeIndex of [link.source, link.target]) {
      const node = data.nodes[nodeIndex];
      if (node && !node.isWaypoint) nodeIds.add(node.id);
    }
  }
  return nodeIds;
}

export function getFlowSankeyLayout(
  data: FlowSankeyData,
  containerWidth: number,
): FlowSankeyLayout {
  const depths = nodeDepths(data);
  const maxDepth = Math.max(0, ...depths);
  const labeledPlotWidth =
    containerWidth - LABELED_MARGIN.left - LABELED_MARGIN.right;
  const columnGap =
    maxDepth === 0
      ? labeledPlotWidth
      : (labeledPlotWidth - FLOW_SANKEY_NODE_WIDTH) / maxDepth;
  const middleLabelWidth = Math.min(
    MAX_LABEL_WIDTH,
    Math.max(0, columnGap - FLOW_SANKEY_NODE_WIDTH - LABEL_GAP * 2),
  );
  const showLabels =
    containerWidth >= MIN_LABELED_WIDTH &&
    (maxDepth <= 1 || middleLabelWidth >= MIN_LABEL_WIDTH);
  const margin = showLabels ? LABELED_MARGIN : COMPACT_MARGIN;
  const preferredNodePadding = showLabels
    ? LABELED_NODE_PADDING
    : COMPACT_NODE_PADDING;
  const nodesPerDepth = new Map<number, number>();
  for (const depth of depths) {
    nodesPerDepth.set(depth, (nodesPerDepth.get(depth) ?? 0) + 1);
  }
  const busiestDepth = Math.max(1, ...nodesPerDepth.values());
  const maximumInnerHeight = MAX_CHART_HEIGHT - margin.top - margin.bottom;
  const availableNodePadding =
    busiestDepth <= 1
      ? preferredNodePadding
      : Math.floor(
          (maximumInnerHeight - busiestDepth * MIN_NODE_HEIGHT) /
            (busiestDepth - 1),
        );
  const nodePadding = Math.max(
    0,
    Math.min(preferredNodePadding, availableNodePadding),
  );
  const minimumInnerHeight =
    (busiestDepth - 1) * nodePadding + busiestDepth * MIN_NODE_HEIGHT;
  const baseHeight = showLabels ? LABELED_BASE_HEIGHT : COMPACT_BASE_HEIGHT;

  return {
    chartHeight: Math.min(
      MAX_CHART_HEIGHT,
      Math.max(baseHeight, minimumInnerHeight + margin.top + margin.bottom),
    ),
    labelWidths: {
      left: LABELED_MARGIN.left - LABEL_GAP * 2,
      middle: middleLabelWidth,
      right: LABELED_MARGIN.right - LABEL_GAP * 2,
    },
    margin,
    maxDepth,
    nodePadding,
    showLabels,
  };
}
