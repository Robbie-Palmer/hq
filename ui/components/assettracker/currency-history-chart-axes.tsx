import { format, parseISO } from "date-fns";
import type { ReactElement } from "react";
import { CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { formatCurrency, formatCurrencyAxisTick } from "@/lib/assettracker";
import type { Currency } from "@/lib/domain/assettracker";

export function CurrencyHistoryChartAxes({
  currency,
  dateDomain,
  dateKey = "date",
  dateTicks,
  tooltipContent,
}: Readonly<{
  currency: Currency;
  dateDomain?: readonly [number, number];
  dateKey?: string;
  dateTicks?: readonly number[];
  tooltipContent?: ReactElement;
}>) {
  const isTimeAxis = dateDomain != null;

  return (
    <>
      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
      <XAxis
        dataKey={dateKey}
        type={isTimeAxis ? "number" : "category"}
        scale={isTimeAxis ? "time" : "auto"}
        domain={dateDomain}
        ticks={dateTicks}
        allowDataOverflow={isTimeAxis}
        className="text-xs"
        minTickGap={24}
        tickFormatter={(date: string | number) =>
          format(
            typeof date === "number" ? new Date(date) : parseISO(date),
            "MMM yy",
          )
        }
      />
      <YAxis
        className="text-xs"
        width={48}
        tickFormatter={(value: number) =>
          formatCurrencyAxisTick(value, currency)
        }
      />
      <ChartTooltip
        content={tooltipContent ?? <ChartTooltipContent />}
        formatter={(value) => formatCurrency(value as number, currency)}
        labelFormatter={
          isTimeAxis
            ? (value) => format(new Date(Number(value)), "MMMM yyyy")
            : undefined
        }
      />
    </>
  );
}
