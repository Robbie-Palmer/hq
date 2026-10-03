import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { AccountBalanceChart } from "@/components/assettracker/account-balance-chart";
import { AssetAllocationChart } from "@/components/assettracker/asset-allocation-chart";
import type { AccountDetailView } from "@/lib/domain/assettracker";

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  BarChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Bar: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Cell: () => null,
  LineChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Line: () => null,
  CartesianGrid: () => null,
  ReferenceLine: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  Legend: () => null,
}));

describe("overview charts", () => {
  it("gives the allocation chart an accessible data equivalent", () => {
    render(
      <AssetAllocationChart
        currency="GBP"
        data={[
          { assetType: "cash", total: 12_500 },
          { assetType: "debt", total: -2_000 },
        ]}
      />,
    );

    expect(
      screen.getByRole("img", { name: "Net worth composition by asset type" }),
    ).toBeVisible();
    const table = screen.getByRole("table", {
      name: "Net worth composition by asset type",
    });
    expect(table).toHaveTextContent("Cash");
    expect(table).toHaveTextContent("£12,500");
    expect(table).toHaveTextContent("Debt");
  });

  it("gives account history an accessible data equivalent and empty state", () => {
    const account = {
      id: "cash",
      name: "Current account",
      currency: "GBP",
      snapshots: [{ date: "2026-01-31", balance: 1_250 }],
    } as AccountDetailView;
    const { rerender } = render(<AccountBalanceChart accounts={[account]} />);

    expect(
      screen.getByRole("img", { name: "Account balances over time" }),
    ).toBeVisible();
    expect(
      screen.getByRole("table", { name: "Account balances over time" }),
    ).toHaveTextContent("£1,250.00");

    rerender(<AccountBalanceChart accounts={[]} />);
    expect(
      screen.getByText("Record an account balance to start its history."),
    ).toBeVisible();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("explains when the allocation chart has no data", () => {
    render(<AssetAllocationChart currency="GBP" data={[]} />);

    expect(
      screen.getByText(/record a balance to see how net worth is split/),
    ).toBeVisible();
    expect(screen.queryByRole("img")).toBeNull();
  });
});
