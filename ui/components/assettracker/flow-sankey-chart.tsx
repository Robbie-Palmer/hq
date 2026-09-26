"use client";

import {
  type ReactElement,
  type SVGProps,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ResponsiveContainer,
  Sankey,
  type SankeyLinkProps,
  type SankeyNodeProps,
  Tooltip,
} from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  buildFlowSankeyData,
  type FlowSankeyLink,
  type FlowSankeyNode,
  formatCurrency,
} from "@/lib/domain/assettracker";
import { useAssetTracker } from "./asset-tracker-provider";
import {
  FLOW_SANKEY_LINK_COLOR,
  FLOW_SANKEY_NODE_WIDTH,
  type FlowSankeyLayout,
  type FlowSankeyRenderLink,
  type FlowSankeyRenderNode,
  flowKeysForNode,
  getFlowSankeyLayout,
  nodeIdsForFlow,
  prepareFlowSankeyData,
} from "./flow-sankey-layout";

type FlowSankeyNodeShapeOptions = {
  activeFlowKeys: ReadonlySet<string>;
  activeNodeIds: ReadonlySet<string>;
  layout?: FlowSankeyLayout;
  showLabel: boolean;
};

function nodeLabelWidth(
  depth: number,
  labelOnLeft: boolean,
  layout?: FlowSankeyLayout,
) {
  if (labelOnLeft) return layout?.labelWidths.left;
  if (depth === layout?.maxDepth) return layout.labelWidths.right;
  return layout?.labelWidths.middle;
}

function FlowSankeyNodeShape({
  x,
  y,
  width,
  height,
  payload,
  showLabel,
  layout,
  activeFlowKeys,
  activeNodeIds,
}: SankeyNodeProps & FlowSankeyNodeShapeOptions): ReactElement<
  SVGProps<SVGGElement>
> {
  const node = payload as unknown as FlowSankeyRenderNode & { value?: number };
  if (node.isWaypoint) {
    return (
      <g pointerEvents="none">
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          data-flow-key={node.flowKey}
          fill={FLOW_SANKEY_LINK_COLOR}
          fillOpacity={
            node.flowKey && activeFlowKeys.has(node.flowKey) ? 0.65 : 0.25
          }
          className="transition-[fill-opacity] duration-150"
        />
      </g>
    );
  }
  const rawDepth = "depth" in payload ? payload.depth : 0;
  const depth =
    typeof rawDepth === "number" && Number.isFinite(rawDepth) ? rawDepth : 0;
  const labelOnLeft = depth === 0;
  const labelWidth = nodeLabelWidth(depth, labelOnLeft, layout);
  const labelX = labelOnLeft ? x - (labelWidth ?? 0) - 8 : x + width + 8;
  const labelY = y + height / 2 - 8;
  return (
    <g>
      <title>{node.name}</title>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={4}
        fill={node.color}
        fillOpacity={activeNodeIds.has(node.id) ? 1 : 0.85}
        className="transition-[fill-opacity] duration-150"
      />
      {showLabel && labelWidth != null && labelWidth > 0 && (
        <foreignObject x={labelX} y={labelY} width={labelWidth} height={16}>
          <div
            className={`truncate text-[11px] leading-4 ${labelOnLeft ? "text-right" : "text-left"}`}
          >
            {node.name}
          </div>
        </foreignObject>
      )}
    </g>
  );
}

function createFlowSankeyNodeRenderer(options: FlowSankeyNodeShapeOptions) {
  return function FlowSankeyNodeRenderer(props: SankeyNodeProps) {
    return <FlowSankeyNodeShape {...props} {...options} />;
  };
}

function FlowSankeyLinkShape({
  sourceX,
  sourceY,
  sourceControlX,
  targetX,
  targetY,
  targetControlX,
  linkWidth,
  payload,
  activeFlowKeys,
}: SankeyLinkProps & {
  activeFlowKeys: ReadonlySet<string>;
}): ReactElement<SVGProps<SVGPathElement>> {
  const link = payload as unknown as FlowSankeyRenderLink;
  return (
    <path
      aria-label={`${link.sourceName} to ${link.targetName}`}
      className="cursor-pointer transition-[stroke-opacity] duration-150"
      d={`M${sourceX},${sourceY} C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`}
      data-flow-key={link.flowKey}
      fill="none"
      stroke={FLOW_SANKEY_LINK_COLOR}
      strokeOpacity={activeFlowKeys.has(link.flowKey) ? 0.65 : 0.25}
      strokeWidth={linkWidth}
    />
  );
}

function createFlowSankeyLinkRenderer(activeFlowKeys: ReadonlySet<string>) {
  return function FlowSankeyLinkRenderer(props: SankeyLinkProps) {
    return <FlowSankeyLinkShape {...props} activeFlowKeys={activeFlowKeys} />;
  };
}

type SankeyTooltipItem = Partial<FlowSankeyLink & FlowSankeyNode> & {
  value?: number;
  source?: Readonly<{ name?: string }>;
  target?: Readonly<{ name?: string }>;
};

function SankeyTooltip({
  active,
  payload,
}: Readonly<{
  active?: boolean;
  payload?: ReadonlyArray<Readonly<{ payload?: SankeyTooltipItem }>>;
}>) {
  const item = payload?.[0]?.payload;
  if (!active || item?.value == null) return null;

  const sourceName = item.sourceName ?? item.source?.name;
  const targetName = item.targetName ?? item.target?.name;
  return (
    <div className="rounded-lg border bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <p className="font-medium">{item.label ?? item.name}</p>
      {sourceName && targetName && (
        <p className="text-muted-foreground">
          {sourceName}
          {" -> "}
          {targetName}
        </p>
      )}
      <p className="font-mono">{formatCurrency(item.value)}/mo</p>
    </div>
  );
}

export function FlowSankeyChart() {
  const { accountDetails, recurringFlows } = useAssetTracker();
  const [mounted, setMounted] = useState(false);
  const [containerWidth, setContainerWidth] = useState(0);
  const [activeFlowKeys, setActiveFlowKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [activeNodeIds, setActiveNodeIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const chartRef = useRef<HTMLDivElement>(null);
  const liabilityBalances = useMemo(
    () =>
      Object.fromEntries(
        accountDetails.map((detail) => [detail.id, detail.latestBalance ?? 0]),
      ),
    [accountDetails],
  );
  const flowData = useMemo(
    () =>
      buildFlowSankeyData(accountDetails, recurringFlows, liabilityBalances),
    [accountDetails, recurringFlows, liabilityBalances],
  );
  const data = useMemo(() => prepareFlowSankeyData(flowData), [flowData]);
  const hasFlows = flowData.links.length > 0;
  useEffect(() => {
    setMounted(true);
  }, []);
  useLayoutEffect(() => {
    if (!mounted || !hasFlows) return;
    const container = chartRef.current;
    if (!container) return;

    let frame = 0;
    let active = true;
    const commitWidth = (width: number) => {
      if (!active) return;
      const roundedWidth = Math.round(width);
      setContainerWidth((current) =>
        current === roundedWidth ? current : roundedWidth,
      );
    };
    const scheduleWidthUpdate = (width: number) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        commitWidth(width);
      });
    };
    commitWidth(container.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") {
      return () => {
        active = false;
        cancelAnimationFrame(frame);
      };
    }
    const observer = new ResizeObserver(([entry]) => {
      if (entry) scheduleWidthUpdate(entry.contentRect.width);
    });
    observer.observe(container);
    return () => {
      active = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [hasFlows, mounted]);

  const layout = useMemo(
    () => getFlowSankeyLayout(data, containerWidth),
    [containerWidth, data],
  );
  const nodeRenderer = useMemo(
    () =>
      createFlowSankeyNodeRenderer({
        activeFlowKeys,
        activeNodeIds,
        layout,
        showLabel: layout.showLabels,
      }),
    [activeFlowKeys, activeNodeIds, layout],
  );
  const linkRenderer = useMemo(
    () => createFlowSankeyLinkRenderer(activeFlowKeys),
    [activeFlowKeys],
  );

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Regular Flow Map</CardTitle>
        <CardDescription>
          Monthly-equivalent cash flows, expected returns, and interest charges.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-2 sm:px-6">
        {!hasFlows ? (
          <p className="px-2 text-sm text-muted-foreground">
            No regular flows yet. Add income, contributions, or repayments from
            an account's detail view.
          </p>
        ) : (
          <>
            {mounted ? (
              <div
                ref={chartRef}
                className="min-w-0"
                style={{ height: layout.chartHeight }}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <Sankey
                    data={data}
                    dataKey="value"
                    nameKey="name"
                    node={nodeRenderer}
                    link={linkRenderer}
                    nodePadding={layout.nodePadding}
                    nodeWidth={FLOW_SANKEY_NODE_WIDTH}
                    margin={layout.margin}
                    align="left"
                    iterations={64}
                    sort={false}
                    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing function predates the complexity limit; new violations remain prohibited.
                    onMouseEnter={(item, type) => {
                      if (type === "link") {
                        const link = item.payload as unknown as
                          | FlowSankeyRenderLink
                          | undefined;
                        setActiveFlowKeys(
                          link?.flowKey ? new Set([link.flowKey]) : new Set(),
                        );
                        setActiveNodeIds(
                          link?.flowKey
                            ? nodeIdsForFlow(data, link.flowKey)
                            : new Set(),
                        );
                        return;
                      }
                      const node = item.payload as unknown as
                        | FlowSankeyRenderNode
                        | undefined;
                      if (!node || node.isWaypoint) return;
                      setActiveFlowKeys(flowKeysForNode(data, node.id));
                      setActiveNodeIds(new Set([node.id]));
                    }}
                    onMouseLeave={() => {
                      setActiveFlowKeys(new Set());
                      setActiveNodeIds(new Set());
                    }}
                  >
                    <Tooltip content={<SankeyTooltip />} />
                  </Sankey>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-[280px] min-w-0" />
            )}
            {!layout.showLabels && (
              <ul
                aria-label="Flow map legend"
                className="mt-3 flex flex-wrap gap-2 text-xs"
              >
                {flowData.nodes.map((node) => (
                  <li
                    key={node.id}
                    className="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full border px-2 py-1"
                  >
                    <span
                      aria-hidden="true"
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: node.color }}
                    />
                    <span className="min-w-0 truncate">{node.name}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
