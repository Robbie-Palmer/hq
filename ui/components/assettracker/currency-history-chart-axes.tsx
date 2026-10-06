import { format, parseISO } from "date-fns";
import type { ReactElement } from "react";
import { CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { formatCurrency, formatCurrencyAxisTick } from "@/lib/assettracker";
import type { Currency } from "@/lib/domain/assettracker";

export function CurrencyHistoryChartAxes({
  currency,
  tooltipContent,
}: Readonly<{
  currency: Currency;
  tooltipContent?: ReactElement;
}>) {
  return (
    <>
      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
      <XAxis
        dataKey="date"
        className="text-xs"
        minTickGap={24}
        tickFormatter={(date: string) => format(parseISO(date), "MMM yy")}
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
      />
    </>
  );
}
