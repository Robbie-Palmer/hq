import { describe, expect, it } from "vitest";
import {
  addFlowSankeyWaypoints,
  flowKeysForNode,
  getFlowSankeyLayout,
  nodeIdsForFlow,
  prepareFlowSankeyData,
} from "@/components/assettracker/flow-sankey-layout";
import type { FlowSankeyData } from "@/lib/assettracker";

function flowFixture(columns: number[], longNames = false): FlowSankeyData {
  const nodes = columns.flatMap((count, depth) =>
    Array.from({ length: count }, (_, index) => ({
      id: `${depth}-${index}`,
      name: longNames
        ? `A deliberately long account name at ${depth}-${index}`
        : `Account ${depth}-${index}`,
      color: "hsl(220, 70%, 50%)",
    })),
  );
  const offsets = columns.map((_, depth) =>
    columns.slice(0, depth).reduce((sum, count) => sum + count, 0),
  );
  const links = columns.slice(1).flatMap((count, depth) =>
    Array.from({ length: count }, (_, index) => ({
      source: offsets[depth] ?? 0,
      target: (offsets[depth + 1] ?? 0) + index,
      value: 100,
      label: "Fixture flow",
      sourceName: nodes[offsets[depth] ?? 0]?.name ?? "Source",
      targetName: nodes[(offsets[depth + 1] ?? 0) + index]?.name ?? "Target",
    })),
  );

  return { nodes, links };
}

describe("getFlowSankeyLayout", () => {
  it("lays out a single standalone account without dividing by a column gap", () => {
    const data: FlowSankeyData = {
      nodes: [{ id: "cash", name: "Cash", color: "blue" }],
      links: [],
    };

    const layout = getFlowSankeyLayout(data, 800);

    expect(layout.maxDepth).toBe(0);
    expect(layout.showLabels).toBe(true);
    expect(layout.labelWidths.middle).toBe(136);
  });

  it("keeps isolated nodes and zero-value links stable", () => {
    const data: FlowSankeyData = {
      taxYear: "2026-27",
      nodes: [
        { id: "source", name: "Source", color: "blue" },
        { id: "isolated", name: "Isolated", color: "blue" },
        { id: "target", name: "Target", color: "blue" },
      ],
      links: [
        {
          source: 0,
          target: 2,
          value: 0,
          label: "Zero transfer",
          sourceName: "Source",
          targetName: "Target",
        },
      ],
    };

    const prepared = prepareFlowSankeyData(data);

    expect(prepared.nodes.map((node) => node.id).sort()).toEqual([
      "isolated",
      "source",
      "target",
    ]);
    expect(prepared.links).toEqual([
      expect.objectContaining({ flowKey: "flow:0", value: 0 }),
    ]);
    expect(prepared.taxYear).toBe("2026-27");
  });

  it("filters imported links that reference missing nodes", () => {
    const data: FlowSankeyData = {
      nodes: [{ id: "source", name: "Source", color: "blue" }],
      links: [
        {
          source: 0,
          target: 9,
          value: 10,
          label: "Missing target",
          sourceName: "Source",
          targetName: "Missing",
        },
        {
          source: 8,
          target: 0,
          value: 5,
          label: "Missing source",
          sourceName: "Missing",
          targetName: "Source",
        },
      ],
    };

    const routed = addFlowSankeyWaypoints(data);

    expect(routed.nodes).toEqual(data.nodes);
    expect(routed.links).toEqual([]);
  });

  it("filters imported links with invalid Sankey values", () => {
    const data: FlowSankeyData = {
      nodes: [
        { id: "source", name: "Source", color: "blue" },
        { id: "target", name: "Target", color: "blue" },
      ],
      links: [
        {
          source: 0,
          target: 1,
          value: -10,
          label: "Negative transfer",
          sourceName: "Source",
          targetName: "Target",
        },
        {
          source: 0,
          target: 1,
          value: Number.NaN,
          label: "Non-finite transfer",
          sourceName: "Source",
          targetName: "Target",
        },
      ],
    };

    expect(addFlowSankeyWaypoints(data).links).toEqual([]);
  });

  it("reserves a lane when a flow skips intermediate columns", () => {
    const data = flowFixture([1, 2, 1, 1]);
    const source = data.nodes[0];
    const middleTarget = data.nodes[3];
    const finalTarget = data.nodes[4];
    if (!source || !middleTarget || !finalTarget) {
      throw new Error("Expected the routing fixture to contain four columns");
    }
    data.links.push(
      {
        source: 0,
        target: 3,
        value: 25,
        label: "Short skipped flow",
        sourceName: source.name,
        targetName: middleTarget.name,
      },
      {
        source: 0,
        target: 4,
        value: 50,
        label: "Long skipped flow",
        sourceName: source.name,
        targetName: finalTarget.name,
      },
    );
    const routed = addFlowSankeyWaypoints(data);
    const longFlowSegments = routed.links.filter(
      (link) => link.label === "Long skipped flow",
    );

    expect(routed.nodes.filter((node) => node.isWaypoint)).toHaveLength(3);
    expect(routed.links).toHaveLength(data.links.length + 3);
    expect(longFlowSegments).toHaveLength(3);
    expect(new Set(longFlowSegments.map((link) => link.flowKey)).size).toBe(1);
    const connectedFlowKeys = flowKeysForNode(routed, finalTarget.id);
    expect(connectedFlowKeys).toContain(longFlowSegments[0]?.flowKey);
    expect(connectedFlowKeys.size).toBe(2);
    expect(flowKeysForNode(routed, "missing-node")).toEqual(new Set());
    expect(
      nodeIdsForFlow(routed, longFlowSegments[0]?.flowKey ?? "missing-flow"),
    ).toEqual(new Set([source.id, finalTarget.id]));
    expect(nodeIdsForFlow(routed, "missing-flow")).toEqual(new Set());

    const depths = routed.nodes.map(() => 0);
    for (const link of routed.links) {
      depths[link.target] = Math.max(
        depths[link.target] ?? 0,
        (depths[link.source] ?? 0) + 1,
      );
    }
    expect(
      routed.links.every(
        (link) => (depths[link.target] ?? 0) - (depths[link.source] ?? 0) === 1,
      ),
    ).toBe(true);
  });

  it("keeps generated waypoint IDs distinct from imported node IDs", () => {
    const data: FlowSankeyData = {
      nodes: [
        { id: "source", name: "Source", color: "blue" },
        { id: "middle", name: "Middle", color: "blue" },
        { id: "target", name: "Target", color: "blue" },
        {
          id: "__flow_waypoint:0:1",
          name: "Imported",
          color: "blue",
        },
      ],
      links: [
        {
          source: 0,
          target: 2,
          value: 10,
          label: "Long flow",
          sourceName: "Source",
          targetName: "Target",
        },
        {
          source: 0,
          target: 1,
          value: 5,
          label: "First hop",
          sourceName: "Source",
          targetName: "Middle",
        },
        {
          source: 1,
          target: 2,
          value: 5,
          label: "Second hop",
          sourceName: "Middle",
          targetName: "Target",
        },
      ],
    };

    const routed = addFlowSankeyWaypoints(data);
    const nodeIds = routed.nodes.map((node) => node.id);

    expect(new Set(nodeIds).size).toBe(nodeIds.length);
    expect(nodeIds).toContain("__flow_waypoint:0:1:1");
  });

  it("gives long labels a bounded slot between Sankey columns", () => {
    const layout = getFlowSankeyLayout(flowFixture([2, 3, 3, 2, 2], true), 688);

    expect(layout.showLabels).toBe(true);
    expect(layout.maxDepth).toBe(4);
    expect(layout.labelWidths.middle).toBe(76);
  });

  it("uses a legend when a narrow plot cannot fit readable labels", () => {
    const layout = getFlowSankeyLayout(flowFixture([2, 3, 3, 2, 2], true), 520);

    expect(layout.showLabels).toBe(false);
    expect(layout.margin).toEqual({ top: 8, right: 12, bottom: 8, left: 12 });
  });

  it("grows to keep a crowded column inside the plot", () => {
    const layout = getFlowSankeyLayout(flowFixture([1, 24]), 520);

    expect(layout.chartHeight).toBeGreaterThan(320);
    const innerHeight =
      layout.chartHeight - layout.margin.top - layout.margin.bottom;
    expect(innerHeight).toBeGreaterThanOrEqual(24 * 2 + 23 * 14);
  });

  it("caps height and compresses padding for exceptionally dense columns", () => {
    const layout = getFlowSankeyLayout(flowFixture([1, 500]), 520);

    expect(layout.chartHeight).toBe(720);
    expect(layout.nodePadding).toBe(0);
  });
});
