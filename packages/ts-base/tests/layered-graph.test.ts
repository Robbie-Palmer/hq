import { describe, expect, it } from "vitest";
import {
  layeredGraphNodeDepths,
  orderLayeredGraphNodes,
  type LayeredGraphEdge,
} from "../src/layered-graph";

function edge(
  source: number,
  target: number,
  weight = 1,
): LayeredGraphEdge {
  return { source, target, weight };
}

describe("layeredGraphNodeDepths", () => {
  it("assigns the longest-path depth while preserving isolated nodes", () => {
    expect(
      layeredGraphNodeDepths(5, [edge(0, 1), edge(1, 3), edge(0, 2)]),
    ).toEqual([0, 1, 1, 2, 0]);
  });

  it("ignores invalid endpoints and weights", () => {
    expect(
      layeredGraphNodeDepths(2, [
        edge(-1, 1),
        edge(0, 2),
        edge(0, 1, -1),
        edge(0, 1, Number.NaN),
      ]),
    ).toEqual([0, 0]);
  });

  it("bounds cyclic input by the node count", () => {
    const depths = layeredGraphNodeDepths(2, [edge(0, 1), edge(1, 0)]);

    expect(depths).toEqual([1, 1]);
  });

  it("rejects invalid node counts", () => {
    expect(() => layeredGraphNodeDepths(-1, [])).toThrow(RangeError);
    expect(() => layeredGraphNodeDepths(1.5, [])).toThrow(RangeError);
  });
});

describe("orderLayeredGraphNodes", () => {
  it("orders adjacent layers to remove avoidable crossings", () => {
    const ordered = orderLayeredGraphNodes(4, [edge(0, 3), edge(1, 2)]);
    const sourceOrder = ordered.indexOf(0) - ordered.indexOf(1);
    const targetOrder = ordered.indexOf(3) - ordered.indexOf(2);

    expect(Math.sign(sourceOrder)).toBe(Math.sign(targetOrder));
  });

  it("orders edges with weights near the numeric limit", () => {
    const ordered = orderLayeredGraphNodes(4, [
      edge(0, 3, Number.MAX_VALUE),
      edge(1, 2, Number.MAX_VALUE),
    ]);
    const sourceOrder = ordered.indexOf(0) - ordered.indexOf(1);
    const targetOrder = ordered.indexOf(3) - ordered.indexOf(2);

    expect(Math.sign(sourceOrder)).toBe(Math.sign(targetOrder));
  });

  it("keeps every node when neighbours are isolated or zero-weighted", () => {
    const ordered = orderLayeredGraphNodes(7, [
      edge(0, 4),
      edge(0, 5),
      edge(1, 4),
      edge(1, 5),
      edge(2, 6, 0),
    ]);

    expect([...ordered].sort((left, right) => left - right)).toEqual([
      0, 1, 2, 3, 4, 5, 6,
    ]);
  });

  it("uses bounded barycentric ordering above the exact crossing limit", () => {
    const ordered = orderLayeredGraphNodes(
      4,
      [edge(0, 3), edge(1, 2)],
      { maxExactCrossingEdges: 1 },
    );

    expect([...ordered].sort((left, right) => left - right)).toEqual([
      0, 1, 2, 3,
    ]);
  });

  it("supports empty graphs and zero optimization passes", () => {
    expect(orderLayeredGraphNodes(0, [])).toEqual([]);
    expect(
      orderLayeredGraphNodes(3, [edge(0, 2)], {
        maxBarycentricPasses: 0,
        maxExactCrossingEdges: 0,
      }),
    ).toEqual([0, 1, 2]);
  });
});
