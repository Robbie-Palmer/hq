"use client";

import { ReferenceLine } from "recharts";
import { formatCurrency } from "@/lib/assettracker";
import type { Currency } from "@/lib/domain/assettracker";

export function highestFiniteValue(
  values: readonly (number | null | undefined)[],
): number | undefined {
  const finiteValues = values.filter(
    (value): value is number => value != null && Number.isFinite(value),
  );
  return finiteValues.length === 0 ? undefined : Math.max(...finiteValues);
}

export function ChartPeakReferenceLine({
  color,
  currency,
  label,
  position,
  value,
}: Readonly<{
  color: string;
  currency: Currency;
  label: string;
  position: "insideBottomRight" | "insideTopRight";
  value?: number;
}>) {
  if (value == null || !Number.isFinite(value)) return null;

  return (
    <ReferenceLine
      y={value}
      stroke={color}
      strokeDasharray="4 4"
      strokeOpacity={0.8}
      label={{
        value: `${label}: ${formatCurrency(Math.round(value), currency)}`,
        position,
        fill: color,
        fontSize: 11,
      }}
    />
  );
}
