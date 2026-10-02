import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NetWorthChart } from "@/components/assettracker/net-worth-chart";
import type { NetWorthDataPoint } from "@/lib/domain/assettracker";

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  ComposedChart: ({
    children,
    data,
  }: {
    children: ReactNode;
    data: unknown[];
  }) => (
    <div data-chart-data={JSON.stringify(data)} data-testid="net-worth-chart">
      {children}
    </div>
  ),
  Area: ({ dataKey }: { dataKey: string }) => <div data-series={dataKey} />,
  Line: ({ dataKey }: { dataKey: string }) => <div data-series={dataKey} />,
  CartesianGrid: () => null,
  ReferenceLine: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  Legend: () => null,
}));

const data: NetWorthDataPoint[] = [
  point("2024-01-01", 180, 100, 80),
  point("2024-02-01", 170, 100, 70),
];

describe("NetWorthChart", () => {
  afterEach(() => vi.useRealTimers());

  it("compares actual portfolio value with the same portfolio at fixed rates", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <NetWorthChart
        data={data}
        currency="GBP"
        baseCurrencyData={data}
        householdBaseCurrency="GBP"
      />,
    );

    expect(screen.getByRole("button", { name: "FX impact" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "FX impact" }));

    expect(screen.getByText("Currency impact on net worth")).toBeVisible();
    expect(
      screen.getByText(
        /removed from household net worth by currency movements/,
      ),
    ).toBeVisible();
    expect(container.querySelector('[data-series="impact"]')).toBeVisible();
    expect(container.querySelector('[data-series="actualTotal"]')).toBeNull();
    expect(
      container.querySelector('[data-series="fixedRateTotal"]'),
    ).toBeNull();
    expect(container.querySelector('[data-series="total"]')).toBeNull();

    const chartData = JSON.parse(
      screen.getByTestId("net-worth-chart").dataset.chartData ?? "[]",
    ) as Array<Record<string, number>>;
    expect(chartData.at(-1)).toEqual(
      expect.objectContaining({
        actualTotal: 170,
        fixedRateTotal: 180,
        impact: -10,
      }),
    );
  });

  it("keeps account filtering and period windows in the value view", async () => {
    const user = userEvent.setup();
    const { container } = render(<NetWorthChart data={data} currency="GBP" />);

    expect(container.querySelector('[data-series="total"]')).toBeVisible();
    expect(
      container.querySelector('[data-series="estimatedTotal"]'),
    ).toBeVisible();
    expect(container.querySelector('[data-series="Cash"]')).toBeVisible();
    expect(container.querySelector('[data-series="US shares"]')).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Cash" }));
    expect(container.querySelector('[data-series="Cash"]')).toBeVisible();
    expect(container.querySelector('[data-series="US shares"]')).toBeNull();
    expect(screen.getByRole("button", { name: "Show all" })).toBeVisible();
    expect(screen.getByText(/for the selected accounts/)).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Cash" }));
    expect(container.querySelector('[data-series="US shares"]')).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "US shares" }), {
      ctrlKey: true,
    });
    expect(container.querySelector('[data-series="US shares"]')).toBeNull();
    await user.click(screen.getByRole("button", { name: "Show all" }));

    await user.click(screen.getByRole("button", { name: "1Y" }));
    expect(screen.getByText(/over the past year/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "5Y" }));
    expect(screen.getByText(/over the past 5 years/)).toBeVisible();
  });

  it("supports long-press account toggling without also focusing it", () => {
    vi.useFakeTimers();
    const { container } = render(<NetWorthChart data={data} currency="GBP" />);
    const cash = screen.getByRole("button", { name: "Cash" });

    fireEvent.pointerDown(cash);
    act(() => vi.advanceTimersByTime(450));
    fireEvent.pointerUp(cash);
    fireEvent.click(cash);
    fireEvent.contextMenu(cash);

    expect(container.querySelector('[data-series="Cash"]')).toBeNull();
    expect(container.querySelector('[data-series="US shares"]')).toBeVisible();
  });

  it("reports when currency movements add value", async () => {
    const user = userEvent.setup();
    render(
      <NetWorthChart
        data={[
          point("2024-01-01", 180, 100, 80),
          point("2024-02-01", 190, 100, 90),
        ]}
        currency="GBP"
      />,
    );

    await user.click(screen.getByRole("button", { name: "FX impact" }));
    expect(
      screen.getByText(/added to household net worth by currency movements/),
    ).toBeVisible();
  });

  it("omits FX controls when every holding uses the household currency", () => {
    const gbpOnly: NetWorthDataPoint[] = [
      {
        date: "2024-01-01",
        total: 100,
        Cash: 100,
        conversion: {
          targetCurrency: "GBP",
          status: "complete",
          partialTotal: 100,
          accounts: [
            {
              accountId: "cash",
              accountName: "Cash",
              nativeValue: 100,
              nativeCurrency: "GBP",
              convertedValue: 100,
              rates: [],
              issues: [],
            },
          ],
        },
      },
    ];

    render(<NetWorthChart data={gbpOnly} currency="GBP" />);

    expect(screen.queryByRole("button", { name: "FX impact" })).toBeNull();
    expect(screen.getByText("Market net worth over time")).toBeVisible();
  });

  it("renders an empty value chart without a change summary", () => {
    render(<NetWorthChart data={[]} currency="GBP" />);

    expect(screen.getByText("Market net worth over time")).toBeVisible();
    expect(screen.queryByText(/over all time/)).toBeNull();
  });
});

function point(
  date: string,
  total: number,
  gbpValue: number,
  usdValueInGbp: number,
): NetWorthDataPoint {
  return {
    date,
    total,
    estimatedTotal: total + 5,
    Cash: gbpValue,
    "US shares": usdValueInGbp,
    conversion: {
      targetCurrency: "GBP",
      status: "complete",
      partialTotal: total,
      accounts: [
        {
          accountId: "cash",
          accountName: "Cash",
          nativeValue: gbpValue,
          nativeCurrency: "GBP",
          convertedValue: gbpValue,
          rates: [],
          issues: [],
        },
        {
          accountId: "us-shares",
          accountName: "US shares",
          nativeValue: 100,
          nativeCurrency: "USD",
          convertedValue: usdValueInGbp,
          rates: [],
          issues: [],
        },
      ],
    },
  };
}
