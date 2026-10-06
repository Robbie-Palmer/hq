"use client";

import * as React from "react";
import * as RechartsPrimitive from "recharts";

import { cn } from "@/lib/generic/styles";

// Context for chart configuration
const ChartContext = React.createContext<{
  config: ChartConfig;
} | null>(null);

function useChart() {
  const context = React.useContext(ChartContext);
  if (!context) {
    throw new Error("useChart must be used within a <ChartContainer />");
  }
  return context;
}

type ChartConfig = {
  [key: string]: {
    label?: string;
    color?: string;
  };
};

const ChartContainer = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div"> & {
    config: ChartConfig;
    children: React.ReactElement;
  }
>(({ config, children, className, ...props }, ref) => {
  // Create CSS variables from chartConfig
  const style = React.useMemo(() => {
    const cssVars: Record<string, string> = {};
    for (const [key, value] of Object.entries(config)) {
      if (value.color) {
        cssVars[`--color-${key}`] = value.color;
      }
    }
    return cssVars as React.CSSProperties;
  }, [config]);

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        ref={ref}
        className={cn("flex aspect-video justify-center text-xs", className)}
        style={style}
        {...props}
      >
        {children}
      </div>
    </ChartContext.Provider>
  );
});
ChartContainer.displayName = "ChartContainer";

const ChartTooltip = RechartsPrimitive.Tooltip;

const ChartTooltipContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<typeof RechartsPrimitive.Tooltip> & {
    heading?: React.ReactNode;
    hideLabel?: boolean;
    hideIndicator?: boolean;
    active?: boolean;
    label?: number | string;
    payload?: Array<{
      dataKey: string;
      value: number | string;
      color: string;
    }>;
  }
>(({ active, payload, hideIndicator, heading }, ref) => {
  const { config } = useChart();

  if (!active || !payload?.length) {
    return null;
  }

  return (
    <div
      ref={ref}
      className="grid min-w-[8rem] gap-1.5 rounded-lg border bg-background px-2.5 py-1.5 text-xs shadow-xl"
    >
      {heading != null && (
        <p className="font-medium text-muted-foreground">{heading}</p>
      )}
      {payload.map((item) => {
        const key = item.dataKey as string;
        const itemConfig = config[key];

        return (
          <div key={key} className="flex w-full items-center gap-2">
            {!hideIndicator && (
              <div
                className="h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{
                  backgroundColor: item.color,
                }}
              />
            )}
            <div className="flex flex-1 justify-between gap-2">
              <span className="font-medium">{itemConfig?.label || key}</span>
              <span className="font-mono font-medium tabular-nums">
                {typeof item.value === "number"
                  ? item.value.toLocaleString()
                  : item.value}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
});
ChartTooltipContent.displayName = "ChartTooltipContent";

const ChartLegend = RechartsPrimitive.Legend;

const ChartLegendContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div"> & {
    payload?: Array<{ value: string; color: string }>;
  }
>(({ payload, className }, ref) => {
  const { config } = useChart();

  if (!payload?.length) {
    return null;
  }

  return (
    <div
      ref={ref}
      className={cn(
        "flex flex-wrap items-center justify-center gap-x-4 gap-y-2",
        className,
      )}
    >
      {payload.map((item) => {
        const key = item.value as string;
        const itemConfig = config[key];

        return (
          <div key={key} className="flex items-center gap-1.5">
            <div
              className="h-2 w-2 shrink-0 rounded-sm"
              style={{ backgroundColor: item.color }}
            />
            <span className="text-xs text-muted-foreground">
              {itemConfig?.label || key}
            </span>
          </div>
        );
      })}
    </div>
  );
});
ChartLegendContent.displayName = "ChartLegendContent";

export {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
};
