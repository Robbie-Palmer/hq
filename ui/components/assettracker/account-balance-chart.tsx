"use client";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  ACCOUNT_COLORS,
  type AccountDetailView,
  formatAccountCurrency,
  formatAxisTick,
} from "@/lib/domain/assettracker";

interface AccountBalanceChartProps {
  accounts: AccountDetailView[];
}

export function AccountBalanceChart({
  accounts,
}: Readonly<AccountBalanceChartProps>) {
  // Build chart data in single pass through all snapshots
  const chartDataMap = new Map<string, Record<string, string | number>>();
  for (const account of accounts) {
    for (const snapshot of account.snapshots) {
      let point = chartDataMap.get(snapshot.date);
      if (!point) {
        point = { date: snapshot.date };
        chartDataMap.set(snapshot.date, point);
      }
      point[account.name] = snapshot.balance;
    }
  }
  const chartData = Array.from(chartDataMap.values()).sort((a, b) =>
    (a.date as string).localeCompare(b.date as string),
  );
  const chartConfig: ChartConfig = {};
  for (const [i, account] of accounts.entries()) {
    chartConfig[account.name] = {
      label: account.name,
      color: ACCOUNT_COLORS[i % ACCOUNT_COLORS.length],
    };
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Account Balances</CardTitle>
        <CardDescription>
          Individual account balances in each account&apos;s native currency
        </CardDescription>
      </CardHeader>
      <CardContent className="px-2 sm:px-6">
        <ChartContainer config={chartConfig} className="aspect-auto w-full">
          <ResponsiveContainer width="100%" height={400}>
            <LineChart
              data={chartData}
              margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="date" className="text-xs" />
              <YAxis className="text-xs" tickFormatter={formatAxisTick} />
              <ChartTooltip
                content={<ChartTooltipContent />}
                formatter={(value, name) => {
                  const currency = accounts.find(
                    (account) => account.name === String(name),
                  )?.currency;
                  return currency == null
                    ? String(value)
                    : formatAccountCurrency(value as number, currency);
                }}
              />
              {accounts.map((account, i) => (
                <Line
                  key={account.id}
                  type="monotone"
                  dataKey={account.name}
                  stroke={ACCOUNT_COLORS[i % ACCOUNT_COLORS.length]}
                  strokeWidth={2}
                  // A line needs two points; show a dot so a freshly created
                  // account's single balance is still visible
                  dot={account.snapshots.length < 2}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
