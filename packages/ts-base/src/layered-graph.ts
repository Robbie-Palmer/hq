export type LayeredGraphEdge = Readonly<{
  source: number;
  target: number;
  /** A finite, non-negative value used to prioritise heavier edges. */
  weight: number;
}>;

export type LayeredGraphOrderOptions = Readonly<{
  maxBarycentricPasses?: number;
  maxExactCrossingEdges?: number;
}>;

const DEFAULT_MAX_BARYCENTRIC_PASSES = 8;
const DEFAULT_MAX_EXACT_CROSSING_EDGES = 96;

function assertNodeCount(nodeCount: number): void {
  if (!Number.isInteger(nodeCount) || nodeCount < 0) {
    throw new RangeError("nodeCount must be a non-negative integer");
  }
}

function validEdges(
  nodeCount: number,
  edges: readonly LayeredGraphEdge[],
): LayeredGraphEdge[] {
  return edges.filter(
    ({ source, target, weight }) =>
      Number.isInteger(source) &&
      Number.isInteger(target) &&
      source >= 0 &&
      target >= 0 &&
      source < nodeCount &&
      target < nodeCount &&
      Number.isFinite(weight) &&
      weight >= 0,
  );
}

function normaliseEdgeWeights(edges: LayeredGraphEdge[]): LayeredGraphEdge[] {
  const largestWeight = edges.reduce(
    (largest, edge) => Math.max(largest, edge.weight),
    0,
  );
  if (largestWeight <= 1) return edges;
  return edges.map((edge) => ({
    ...edge,
    weight: edge.weight / largestWeight,
  }));
}

/**
 * Assigns each node its longest-path layer. Edges with out-of-range endpoints
 * or non-finite, negative weights are ignored.
 */
export function layeredGraphNodeDepths(
  nodeCount: number,
  edges: readonly LayeredGraphEdge[],
): number[] {
  assertNodeCount(nodeCount);
  const depths = Array.from({ length: nodeCount }, () => 0);
  const graphEdges = validEdges(nodeCount, edges);

  // Layered graphs are normally acyclic. Bounding the relaxation by the node
  // count also gives a stable fallback for malformed cyclic input.
  for (let pass = 0; pass < nodeCount; pass += 1) {
    let changed = false;
    for (const edge of graphEdges) {
      const sourceDepth = depths[edge.source];
      const targetDepth = depths[edge.target];
      if (sourceDepth == null || targetDepth == null) continue;
      const nextDepth = Math.min(nodeCount - 1, sourceDepth + 1);
      if (nextDepth > targetDepth) {
        depths[edge.target] = nextDepth;
        changed = true;
      }
    }
    if (!changed) break;
  }

  return depths;
}

function cloneLayers(layers: number[][]): number[][] {
  return layers.map((layer) => [...layer]);
}

function nodePositions(layers: number[][]): Map<number, number> {
  return new Map(
    layers.flatMap((layer) =>
      layer.map((nodeIndex, position) => [nodeIndex, position] as const),
    ),
  );
}

type WeightedNeighbour = { index: number; weight: number };

function reorderLayer(
  layer: number[],
  positions: Map<number, number>,
  neighbours: Map<number, WeightedNeighbour[]>,
): boolean {
  const previousOrder = new Map(
    layer.map((nodeIndex, position) => [nodeIndex, position]),
  );
  const barycentres = new Map<number, number>();
  for (const nodeIndex of layer) {
    const adjacent = neighbours.get(nodeIndex) ?? [];
    const previousPosition = previousOrder.get(nodeIndex) ?? 0;
    if (adjacent.length === 0) {
      barycentres.set(nodeIndex, previousPosition);
      continue;
    }
    const totalWeight = adjacent.reduce((sum, edge) => sum + edge.weight, 0);
    if (totalWeight === 0) {
      barycentres.set(nodeIndex, previousPosition);
      continue;
    }
    barycentres.set(
      nodeIndex,
      adjacent.reduce(
        (sum, edge) => sum + (positions.get(edge.index) ?? 0) * edge.weight,
        0,
      ) / totalWeight,
    );
  }

  layer.sort((left, right) => {
    const leftBarycentre = barycentres.get(left) ?? 0;
    const rightBarycentre = barycentres.get(right) ?? 0;
    if (leftBarycentre < rightBarycentre) return -1;
    if (leftBarycentre > rightBarycentre) return 1;
    return (previousOrder.get(left) ?? 0) - (previousOrder.get(right) ?? 0);
  });

  let changed = false;
  for (const [position, nodeIndex] of layer.entries()) {
    if (previousOrder.get(nodeIndex) !== position) changed = true;
    positions.set(nodeIndex, position);
  }
  return changed;
}

function linkPairCrossingWeight(
  first: LayeredGraphEdge,
  second: LayeredGraphEdge,
  positions: Map<number, number>,
  depths: Map<number, number>,
): number {
  const spansDifferentLayers =
    depths.get(first.source) !== depths.get(second.source) ||
    depths.get(first.target) !== depths.get(second.target);
  const sharesNode =
    first.source === second.source || first.target === second.target;
  if (
    spansDifferentLayers ||
    sharesNode ||
    first.weight === 0 ||
    second.weight === 0
  ) {
    return 0;
  }

  const sourceOrder =
    (positions.get(first.source) ?? 0) - (positions.get(second.source) ?? 0);
  const targetOrder =
    (positions.get(first.target) ?? 0) - (positions.get(second.target) ?? 0);
  return sourceOrder * targetOrder < 0
    ? Math.sqrt(first.weight) * Math.sqrt(second.weight)
    : 0;
}

function crossingWeight(edges: LayeredGraphEdge[], layers: number[][]): number {
  const positions = nodePositions(layers);
  const depths = new Map(
    layers.flatMap((layer, depth) =>
      layer.map((nodeIndex) => [nodeIndex, depth] as const),
    ),
  );
  let weight = 0;

  for (const [left, first] of edges.entries()) {
    for (const second of edges.slice(left + 1)) {
      weight += linkPairCrossingWeight(first, second, positions, depths);
    }
  }

  return weight;
}

function incidentEdgeIndexes(
  edges: LayeredGraphEdge[],
  firstNode: number,
  secondNode: number,
): number[] {
  const indexes: number[] = [];
  for (const [index, edge] of edges.entries()) {
    if (
      edge.source === firstNode ||
      edge.target === firstNode ||
      edge.source === secondNode ||
      edge.target === secondNode
    ) {
      indexes.push(index);
    }
  }
  return indexes;
}

function incidentCrossingWeight(
  edges: LayeredGraphEdge[],
  incidentIndexes: number[],
  positions: Map<number, number>,
  depths: Map<number, number>,
): number {
  const incident = new Set(incidentIndexes);
  let weight = 0;

  for (const firstIndex of incidentIndexes) {
    const first = edges[firstIndex];
    if (!first) continue;
    for (const [secondIndex, second] of edges.entries()) {
      if (firstIndex === secondIndex) continue;
      if (incident.has(secondIndex) && secondIndex < firstIndex) continue;
      weight += linkPairCrossingWeight(first, second, positions, depths);
    }
  }

  return weight;
}

function transposePass(edges: LayeredGraphEdge[], layers: number[][]): boolean {
  const positions = nodePositions(layers);
  const depths = new Map(
    layers.flatMap((layer, depth) =>
      layer.map((nodeIndex) => [nodeIndex, depth] as const),
    ),
  );
  let changed = false;
  for (const layer of layers) {
    for (let position = 0; position < layer.length - 1; position += 1) {
      const nextPosition = position + 1;
      const current = layer[position];
      const next = layer[nextPosition];
      if (current == null || next == null) continue;
      const incidentIndexes = incidentEdgeIndexes(edges, current, next);
      const before = incidentCrossingWeight(
        edges,
        incidentIndexes,
        positions,
        depths,
      );
      layer[position] = next;
      layer[nextPosition] = current;
      positions.set(current, nextPosition);
      positions.set(next, position);
      if (
        incidentCrossingWeight(edges, incidentIndexes, positions, depths) <
        before
      ) {
        changed = true;
      } else {
        layer[position] = current;
        layer[nextPosition] = next;
        positions.set(current, position);
        positions.set(next, nextPosition);
      }
    }
  }
  return changed;
}

function transposeLayers(edges: LayeredGraphEdge[], layers: number[][]): boolean {
  let changed = false;
  while (transposePass(edges, layers)) {
    changed = true;
  }
  return changed;
}

type NeighbourMaps = {
  incoming: Map<number, WeightedNeighbour[]>;
  outgoing: Map<number, WeightedNeighbour[]>;
};

function neighbourMaps(edges: LayeredGraphEdge[]): NeighbourMaps {
  const incoming: NeighbourMaps["incoming"] = new Map();
  const outgoing: NeighbourMaps["outgoing"] = new Map();
  for (const edge of edges) {
    const incomingEdges = incoming.get(edge.target);
    const incomingEdge = { index: edge.source, weight: edge.weight };
    if (incomingEdges) incomingEdges.push(incomingEdge);
    else incoming.set(edge.target, [incomingEdge]);

    const outgoingEdges = outgoing.get(edge.source);
    const outgoingEdge = { index: edge.target, weight: edge.weight };
    if (outgoingEdges) outgoingEdges.push(outgoingEdge);
    else outgoing.set(edge.source, [outgoingEdge]);
  }
  return { incoming, outgoing };
}

function reorderLayers(
  edges: LayeredGraphEdge[],
  layers: number[][],
  { incoming, outgoing }: NeighbourMaps,
  transpose: boolean,
): boolean {
  const positions = nodePositions(layers);
  let changed = false;
  for (let depth = 1; depth < layers.length; depth += 1) {
    const layer = layers[depth];
    if (!layer) continue;
    const layerChanged = reorderLayer(layer, positions, incoming);
    changed ||= layerChanged;
  }
  for (let depth = layers.length - 2; depth >= 0; depth -= 1) {
    const layer = layers[depth];
    if (!layer) continue;
    const layerChanged = reorderLayer(layer, positions, outgoing);
    changed ||= layerChanged;
  }
  if (transpose) {
    const transposeChanged = transposeLayers(edges, layers);
    changed ||= transposeChanged;
  }
  return changed;
}

function nonNegativeInteger(value: number | undefined, fallback: number): number {
  if (value == null) return fallback;
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : fallback;
}

/**
 * Returns every node index grouped by depth and ordered to reduce weighted
 * edge crossings. Edges with invalid endpoints or weights are ignored.
 */
export function orderLayeredGraphNodes(
  nodeCount: number,
  edges: readonly LayeredGraphEdge[],
  options: LayeredGraphOrderOptions = {},
): number[] {
  assertNodeCount(nodeCount);
  const graphEdges = normaliseEdgeWeights(validEdges(nodeCount, edges));
  const depths = layeredGraphNodeDepths(nodeCount, graphEdges);
  const maxDepth = Math.max(0, ...depths);
  const layers = Array.from({ length: maxDepth + 1 }, () => [] as number[]);
  for (const [nodeIndex, depth] of depths.entries()) {
    layers[depth]?.push(nodeIndex);
  }

  const maxBarycentricPasses = nonNegativeInteger(
    options.maxBarycentricPasses,
    DEFAULT_MAX_BARYCENTRIC_PASSES,
  );
  const maxExactCrossingEdges = nonNegativeInteger(
    options.maxExactCrossingEdges,
    DEFAULT_MAX_EXACT_CROSSING_EDGES,
  );
  const neighbours = neighbourMaps(graphEdges);

  if (graphEdges.length > maxExactCrossingEdges) {
    for (let pass = 0; pass < maxBarycentricPasses; pass += 1) {
      if (!reorderLayers(graphEdges, layers, neighbours, false)) break;
    }
    return layers.flat();
  }

  transposeLayers(graphEdges, layers);
  let bestLayers = cloneLayers(layers);
  let bestWeight = crossingWeight(graphEdges, layers);

  for (
    let pass = 0;
    pass < maxBarycentricPasses && bestWeight > 0;
    pass += 1
  ) {
    const changed = reorderLayers(graphEdges, layers, neighbours, true);
    const weight = crossingWeight(graphEdges, layers);
    if (weight < bestWeight) {
      bestWeight = weight;
      bestLayers = cloneLayers(layers);
    }
    if (!changed) break;
  }

  return bestLayers.flat();
}
