import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccountTrajectoryChart } from "@/app/_projects/personal-finance-app/components/account-trajectory-chart";
import { useAssetTracker } from "@/app/_projects/personal-finance-app/components/asset-tracker-provider";
import type { AccountDetailView } from "@/app/_projects/personal-finance-app/domain";

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  LineChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Line: ({ dataKey }: { dataKey: string }) => <div data-series={dataKey} />,
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Legend: () => null,
  Tooltip: () => null,
}));

vi.mock(
  "@/app/_projects/personal-finance-app/components/asset-tracker-provider",
  () => ({
    useAssetTracker: vi.fn(),
  }),
);

const mockUseAssetTracker = vi.mocked(useAssetTracker);

const account: AccountDetailView = {
  id: "stocks-isa",
  name: "Stocks ISA",
  provider: "Vanguard",
  currency: "GBP",
  assetType: "stocks",
  expectedAnnualReturn: 0.07,
  isOpen: true,
  latestBalance: 13_000,
  latestSnapshotDate: "2025-01-01",
  cagr: 0.08,
  createdAt: "2024-01-01",
  snapshots: [
    { date: "2024-01-01", balance: 10_000 },
    { date: "2025-01-01", balance: 13_000 },
  ],
  capitalFlows: [
    { date: "2024-01-01", amount: 8_000 },
    { date: "2024-07-01", amount: 1_000 },
  ],
  netContributed: 9_000,
  gainLoss: 4_000,
};

describe("AccountTrajectoryChart", () => {
  beforeEach(() => {
    mockUseAssetTracker.mockReturnValue({
      transfers: [],
    } as unknown as ReturnType<typeof useAssetTracker>);
  });

  it("lets market value and contributed capital be viewed independently", async () => {
    const user = userEvent.setup();
    const { container } = render(<AccountTrajectoryChart account={account} />);

    expect(
      screen.getByText("Market value, estimate, and contributed capital"),
    ).toBeVisible();
    expect(container.querySelector('[data-series="actual"]')).toBeVisible();
    expect(
      container.querySelector('[data-series="contributed"]'),
    ).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Contributed" }));
    expect(screen.getByText("Contributed capital history")).toBeVisible();
    expect(container.querySelector('[data-series="actual"]')).toBeNull();
    expect(container.querySelector('[data-series="expected"]')).toBeNull();
    expect(
      container.querySelector('[data-series="contributed"]'),
    ).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Market value" }));
    expect(screen.getByText("Market value and estimate")).toBeVisible();
    expect(container.querySelector('[data-series="actual"]')).toBeVisible();
    expect(container.querySelector('[data-series="expected"]')).toBeVisible();
    expect(container.querySelector('[data-series="contributed"]')).toBeNull();
  });

  it("keeps contribution-only histories useful before the first valuation", () => {
    const contributionOnly: AccountDetailView = {
      ...account,
      latestBalance: null,
      latestSnapshotDate: null,
      snapshots: [],
      capitalFlows: [
        { date: "2024-01-01", amount: 8_000 },
        { date: "2024-07-01", amount: 1_000 },
      ],
    };

    const { container } = render(
      <AccountTrajectoryChart account={contributionOnly} />,
    );

    expect(screen.getByText("Contributed capital history")).toBeVisible();
    expect(container.querySelector('[data-series="actual"]')).toBeNull();
    expect(
      container.querySelector('[data-series="contributed"]'),
    ).toBeVisible();
  });
});
