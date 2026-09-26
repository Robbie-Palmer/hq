import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { addDays, format, parseISO } from "date-fns";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountsTable } from "@/components/assettracker/accounts-table";
import { AssetAllocationHistoryChart } from "@/components/assettracker/asset-allocation-history-chart";
import { useAssetTracker } from "@/components/assettracker/asset-tracker-provider";
import { FlowSankeyChart } from "@/components/assettracker/flow-sankey-chart";
import { PortfolioContributionChart } from "@/components/assettracker/portfolio-contribution-chart";
import { PortfolioGoal } from "@/components/assettracker/portfolio-goal";
import {
  formatRunwayDuration,
  plannedExpenditureSourceId,
  RunwayChartTooltip,
  RunwayForecast,
} from "@/components/assettracker/runway-forecast";
import { UpcomingFlows } from "@/components/assettracker/upcoming-flows";
import {
  buildFlowSankeyData,
  type PortfolioFinancialIndependence,
  todayIsoDate,
} from "@/lib/domain/assettracker";

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  LineChart: ({ children, data }: { children: ReactNode; data: unknown[] }) => (
    <div data-chart-data={JSON.stringify(data)} data-testid="line-chart">
      {children}
    </div>
  ),
  Line: ({ dataKey, dot }: { dataKey: string; dot?: boolean }) => (
    <div
      data-dots={dot === false ? "hidden" : "visible"}
      data-series={dataKey}
    />
  ),
  CartesianGrid: () => null,
  ReferenceLine: ({ label, x }: { label?: { value?: string }; x?: number }) => (
    <div
      data-marker-x={x}
      data-testid={x == null ? undefined : "planned-spending-marker"}
    >
      {label?.value}
    </div>
  ),
  XAxis: () => null,
  YAxis: () => null,
  Legend: () => null,
  Sankey: ({
    align,
    data,
    link,
    node,
    onMouseEnter,
    onMouseLeave,
    sort,
  }: {
    align?: string;
    data: {
      links: Array<Record<string, unknown>>;
      nodes: Array<Record<string, unknown>>;
    };
    link?: (props: Record<string, unknown>) => ReactNode;
    node?: (props: Record<string, unknown>) => ReactNode;
    onMouseEnter?: (
      item: { index: number; payload: Record<string, unknown> },
      type: "link" | "node",
    ) => void;
    onMouseLeave?: () => void;
    sort?: boolean;
  }) => (
    <div data-align={align} data-sort={sort} data-testid="flow-sankey">
      {data.nodes.map((payload, index) => (
        <button
          aria-label={`Hover ${String(payload.id)}`}
          data-testid={`sankey-node-${String(payload.id)}`}
          key={String(payload.id)}
          onMouseEnter={() => onMouseEnter?.({ index, payload }, "node")}
          onMouseLeave={onMouseLeave}
          type="button"
        >
          <svg aria-hidden="true">
            {node?.({
              height: 20,
              index,
              payload: { ...payload, depth: index === 0 ? 0 : 1 },
              width: 12,
              x: 120,
              y: index * 24,
            })}
          </svg>
        </button>
      ))}
      {data.links.map((payload, index) => (
        <button
          aria-label={`Hover link ${index}`}
          data-testid={`sankey-link-${index}`}
          key={`${String(payload.flowKey)}:${index}`}
          onMouseEnter={() => onMouseEnter?.({ index, payload }, "link")}
          onMouseLeave={onMouseLeave}
          type="button"
        >
          <svg aria-hidden="true">
            {link?.({
              index,
              linkWidth: 10,
              payload,
              sourceControlX: 160,
              sourceX: 132,
              sourceY: index * 12 + 5,
              targetControlX: 200,
              targetX: 228,
              targetY: index * 12 + 5,
            })}
          </svg>
        </button>
      ))}
    </div>
  ),
  Tooltip: () => null,
}));

vi.mock("@/components/assettracker/asset-tracker-provider", () => ({
  useAssetTracker: vi.fn(),
}));

const mockUseAssetTracker = vi.mocked(useAssetTracker);
const FIXED_NOW = new Date("2026-07-03T12:00:00+01:00");
const EMPTY_FI: PortfolioFinancialIndependence = {
  periods: [],
  representativeAnnualExpenditure: null,
  representativeAnnualCurrentExpenditure: null,
  representativeAnnualSavings: null,
  savingsRate: null,
  takeHomeSavingsRate: null,
  currentCompensation: null,
  emergencyFund: 0,
  emergencyFundMonths: null,
  runway: {
    cash: { balance: 0, months: null },
    liquid: { balance: 0, months: null },
    total: { balance: 0, months: null },
  },
  runwayForecast: [],
  target: null,
  progress: null,
  expectedRealReturn: null,
  projection: [],
  projectedFiDate: null,
  yearsToFi: null,
};

function mockAssetTracker(
  overrides: Partial<ReturnType<typeof useAssetTracker>> = {},
) {
  const value = {
    accounts: [],
    accountDetails: [],
    netWorthData: [],
    contributionData: [],
    assetAllocation: [],
    assetAllocationHistory: [],
    transfers: [],
    recurringFlows: [],
    plannedExpenditures: [],
    incomeHistory: [],
    financialIndependence: EMPTY_FI,
    portfolioReturn: null,
    inflation: 0.025,
    netWorthTarget: null,
    netWorthTargetIsReal: false,
    withdrawalRate: 0.04,
    hasLocalChanges: false,
    createAccount: vi.fn(),
    recordBalance: vi.fn(),
    recordTransfer: vi.fn(),
    closeAccount: vi.fn(),
    deleteSnapshot: vi.fn(),
    addRecurringFlow: vi.fn(),
    addPlannedExpenditure: vi.fn(),
    deleteRecurringFlow: vi.fn(),
    deletePlannedExpenditure: vi.fn(),
    materializeFlow: vi.fn(),
    setExpectedReturn: vi.fn(),
    setInflation: vi.fn(),
    setWithdrawalRate: vi.fn(),
    setNetWorthTarget: vi.fn(),
    importIncomeHistory: vi.fn(),
    clearIncomeHistory: vi.fn(),
    resetData: vi.fn(),
    exportData: vi.fn(),
    exportCsv: vi.fn(),
    importData: vi.fn(),
    ...overrides,
  } as ReturnType<typeof useAssetTracker>;
  mockUseAssetTracker.mockReturnValue(value);
  return value;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("PortfolioGoal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates the withdrawal rate used to derive the FI target", async () => {
    const setWithdrawalRate = vi.fn().mockResolvedValue(undefined);
    mockAssetTracker({ setWithdrawalRate });

    render(<PortfolioGoal />);

    const input = screen.getByLabelText("Withdrawal rate");
    await userEvent.clear(input);
    await userEvent.type(input, "3.5");
    await userEvent.tab();

    expect(setWithdrawalRate).toHaveBeenCalledWith(0.035);
  });

  it("preserves a stored withdrawal rate without persisting on an unchanged blur", async () => {
    const setWithdrawalRate = vi.fn().mockResolvedValue(undefined);
    mockAssetTracker({ withdrawalRate: 0.0355, setWithdrawalRate });

    render(<PortfolioGoal />);

    const input = screen.getByLabelText("Withdrawal rate");
    expect(input).toHaveValue(3.55);
    await userEvent.click(input);
    await userEvent.tab();

    expect(setWithdrawalRate).not.toHaveBeenCalled();
  });

  it("rejects an out-of-range withdrawal rate before saving", async () => {
    const setWithdrawalRate = vi.fn().mockResolvedValue(undefined);
    mockAssetTracker({ setWithdrawalRate });

    render(<PortfolioGoal />);

    const input = screen.getByLabelText("Withdrawal rate");
    await userEvent.clear(input);
    await userEvent.type(input, "0");
    await userEvent.tab();

    expect(setWithdrawalRate).not.toHaveBeenCalled();
    expect(
      screen.getByText("Withdrawal rate must be between 0.1% and 100%"),
    ).toBeVisible();
  });

  it("uses constrained mobile layout classes", () => {
    mockAssetTracker();

    const { container } = render(<PortfolioGoal />);

    expect(container.querySelector('[data-slot="card"]')).toHaveClass(
      "min-w-0",
    );
    expect(
      screen.getByRole("button", { name: "Add income history" }),
    ).toBeVisible();
  });

  it("uses a native progress element for an active goal", () => {
    mockAssetTracker({
      financialIndependence: {
        ...EMPTY_FI,
        periods: [],
        representativeAnnualExpenditure: 20_000,
        target: 500_000,
        progress: 0.25,
      },
    });

    render(<PortfolioGoal />);

    const progress = screen.getByRole("progressbar", {
      name: "Financial independence progress",
    });
    expect(progress.tagName).toBe("PROGRESS");
    expect(progress).toHaveAttribute("max", "1");
    expect(progress).toHaveAttribute("value", "0.25");
  });

  it("excludes closed accounts from the current FI net worth", () => {
    mockAssetTracker({
      accounts: [
        {
          id: "open-isa",
          name: "Open ISA",
          provider: "Broker",
          currency: "GBP",
          assetType: "stocks",
          expectedAnnualReturn: 0.07,
          isOpen: true,
          latestBalance: 10_000,
          latestSnapshotDate: "2026-07-03",
          cagr: null,
        },
        {
          id: "closed-isa",
          name: "Closed ISA",
          provider: "Broker",
          currency: "GBP",
          assetType: "stocks",
          expectedAnnualReturn: 0.07,
          isOpen: false,
          latestBalance: 5_000,
          latestSnapshotDate: "2026-07-03",
          cagr: null,
        },
      ],
      financialIndependence: {
        ...EMPTY_FI,
        target: 100_000,
        progress: 0.1,
      },
    });

    render(<PortfolioGoal />);

    expect(
      screen.getByText(
        "£10,000 total net worth, including all pension assets and home equity",
      ),
    ).toBeVisible();
  });

  it("plots current and long-term spending and switches to retained income", async () => {
    mockAssetTracker({
      incomeHistory: [
        { date: "2026-01-31", amount: 4_000, currency: "GBP" },
        { date: "2026-02-28", amount: 4_200, currency: "GBP" },
      ],
      financialIndependence: {
        ...EMPTY_FI,
        periods: [
          {
            startDate: "2025-12-31",
            endDate: "2026-01-31",
            openingNetWorth: 100_000,
            closingNetWorth: 101_500,
            income: 4_000,
            netCapitalFlow: 1_500,
            personalCapitalFlow: 1_500,
            debtPrincipalFlow: 500,
            externalCapitalFlow: 0,
            retainedIncomeSource: "balance-change",
            valuationGain: 0,
            expenditure: 2_500,
            currentExpenditure: 3_000,
            days: 31,
            annualizedExpenditure: 29_455.04,
            annualizedCurrentExpenditure: 35_346.05,
          },
        ],
        representativeAnnualExpenditure: 29_455.04,
        representativeAnnualCurrentExpenditure: 35_346.05,
        target: 736_376,
        progress: 0.14,
      },
    });

    render(<PortfolioGoal />);

    expect(
      screen.getByRole("img", { name: "Income and spending by period" }),
    ).toBeVisible();
    expect(screen.getByTestId("line-chart")).toHaveAttribute(
      "data-chart-data",
      JSON.stringify([
        {
          date: "2026-01-31",
          income: 4_000,
          expenditure: 2_500,
          currentExpenditure: 3_000,
          difference: 1_500,
        },
        { date: "2026-02-28", income: 4_200 },
      ]),
    );
    expect(document.querySelector('[data-series="income"]')).toBeVisible();
    expect(
      document.querySelector('[data-series="expenditure"]'),
    ).toHaveAttribute("data-dots", "visible");
    expect(
      document.querySelector('[data-series="currentExpenditure"]'),
    ).toHaveAttribute("data-dots", "visible");
    expect(
      screen.getByRole("table", { name: "Income and spending by period" }),
    ).toHaveTextContent(
      "2026-01-31£4,000£2,500£3,000£1,5002026-02-28£4,200Awaiting reconciliationAwaiting reconciliationAwaiting reconciliation",
    );
    expect(screen.getByText("Estimated from balances")).toBeVisible();
    expect(
      screen.getByText("£35,346/yr current spending, including debt principal"),
    ).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "Retained" }));

    expect(
      screen.getByRole("img", { name: "Income retained by period" }),
    ).toBeVisible();
    expect(document.querySelector('[data-series="income"]')).toBeNull();
    expect(document.querySelector('[data-series="expenditure"]')).toBeNull();
    expect(
      document.querySelector('[data-series="difference"]'),
    ).toHaveAttribute("data-dots", "visible");
  });

  it("shows emergency runway, savings rate, and a portfolio years-to-FI projection", () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    mockAssetTracker({
      plannedExpenditures: [
        {
          id: "holiday",
          name: "Holiday",
          amount: 7_200,
          date: "2027-01-15",
          fromAccountId: "current",
        },
      ],
      financialIndependence: {
        ...EMPTY_FI,
        representativeAnnualExpenditure: 24_000,
        representativeAnnualSavings: 12_000,
        savingsRate: 0.333,
        takeHomeSavingsRate: 0.25,
        currentCompensation: {
          annualTakeHomeIncome: 32_000,
          annualTakeHomeSavings: 8_000,
          annualEmployeePensionContribution: 3_000,
          annualEmployerPensionContribution: 1_000,
        },
        emergencyFund: 9_000,
        emergencyFundMonths: 4.5,
        runway: {
          cash: { balance: 9_000, months: 4.5 },
          liquid: { balance: 84_000, months: 42 },
          total: { balance: 150_000, months: 75 },
        },
        runwayForecast: [
          {
            date: "2026-07-03",
            cashBalance: 9_000,
            liquidBalance: 84_000,
            totalBalance: 150_000,
            cashMonths: 4.5,
            liquidMonths: 42,
            totalMonths: 75,
            baselineCashMonths: 4.5,
            baselineLiquidMonths: 42,
            baselineTotalMonths: 75,
          },
          {
            date: "2027-07-03",
            cashBalance: 12_000,
            liquidBalance: 96_000,
            totalBalance: 172_800,
            cashMonths: 6,
            liquidMonths: 48,
            totalMonths: 86.4,
            baselineCashMonths: 7,
            baselineLiquidMonths: 50,
            baselineTotalMonths: 90,
          },
        ],
        target: 600_000,
        progress: 0.25,
        expectedRealReturn: 0.04,
        projection: [
          { date: "2026-07-03", projected: 150_000 },
          { date: "2038-07-03", projected: 600_100 },
        ],
        projectedFiDate: "2038-07-03",
        yearsToFi: 12,
      },
    });

    render(<PortfolioGoal />);

    expect(screen.getByText("33.3%")).toBeVisible();
    expect(screen.getByText("All-in savings rate")).toBeVisible();
    expect(screen.getByText(/25.0% from take-home pay/)).toBeVisible();
    expect(screen.getByText(/£3,000 employee pension/)).toBeVisible();
    expect(screen.getAllByText("£9,000")[0]).toBeVisible();
    expect(screen.getByText("4.5 months without income")).toBeVisible();
    expect(
      screen.getByRole("img", {
        name: "Financial runway from cash, liquid assets, and total net worth",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("table", { name: "Financial runway data" }),
    ).toHaveTextContent(
      "Cash£9,0004.5 monthsLiquid assets£84,0003.5 yearsTotal net worth£150,0006.3 years",
    );
    expect(
      screen.getByRole("img", {
        name: "Expected cash, liquid asset, and total net worth runway over time",
      }),
    ).toBeVisible();
    expect(screen.getByTestId("planned-spending-marker")).toHaveTextContent(
      "£7,200",
    );
    expect(screen.getByText(/marked on its purchase date/)).toBeVisible();
    expect(
      screen.getByText("3.6 months less after planned spending"),
    ).toBeVisible();
    expect(screen.getByText("12.0 years")).toBeVisible();
    expect(screen.getByText("Around Jul 2038")).toBeVisible();
    expect(
      screen.getByRole("img", {
        name: "Projected portfolio net worth against the financial independence target",
      }),
    ).toBeVisible();
  });
});

describe("RunwayForecast", () => {
  it("formats chart values as years, months, and days", () => {
    expect(formatRunwayDuration(188)).toBe("15 years, 8 months, 0 days");
    expect(formatRunwayDuration(18.5)).toBe("1 year, 6 months, 15 days");
  });

  it("shows readable runway values and planned spending in the tooltip", () => {
    const holiday = {
      id: "holiday",
      name: "Japan holiday",
      amount: 7_200,
      date: "2027-01-15",
      fromAccountId: "current",
    };
    const point = {
      date: "2027-02-03",
      timestamp: parseISO("2027-02-03").getTime(),
      cashBalance: 9_000,
      liquidBalance: 84_000,
      totalBalance: 150_000,
      cashMonths: 4.5,
      liquidMonths: 42,
      totalMonths: 188,
      baselineCashMonths: 5,
      baselineLiquidMonths: 45,
      baselineTotalMonths: 192,
      plannedExpenditures: [holiday],
    };

    render(
      <RunwayChartTooltip
        active
        payload={[
          {
            color: "purple",
            dataKey: "totalMonths",
            payload: point,
            value: 188,
          },
        ]}
      />,
    );

    expect(screen.getByText("3 Feb 2027")).toBeVisible();
    expect(screen.getByText("Total net worth")).toBeVisible();
    expect(screen.getByText("15 years, 8 months, 0 days")).toBeVisible();
    expect(screen.getByText("Planned spending applied")).toBeVisible();
    expect(screen.getByText("Japan holiday · 15 Jan")).toBeVisible();
    expect(screen.getByText("£7,200")).toBeVisible();
  });

  it("adds a dated planned expenditure from the selected account", async () => {
    const addPlannedExpenditure = vi.fn().mockResolvedValue(undefined);
    mockAssetTracker({
      accounts: [
        {
          id: "current",
          name: "Current account",
          provider: "Bank",
          currency: "GBP",
          assetType: "cash",
          liquidity: "cash",
          expectedAnnualReturn: 0,
          isOpen: true,
          latestBalance: 10_000,
          latestSnapshotDate: "2026-07-01",
          cagr: null,
        },
      ],
      addPlannedExpenditure,
    });

    render(<RunwayForecast />);

    await userEvent.type(screen.getByLabelText("Name"), "New car");
    await userEvent.type(screen.getByLabelText("Amount"), "12000");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(addPlannedExpenditure).toHaveBeenCalledWith({
      name: "New car",
      amount: 12_000,
      date: format(addDays(parseISO(todayIsoDate()), 1), "yyyy-MM-dd"),
      fromAccountId: "current",
    });
  });

  it("falls back when the selected payment account is no longer eligible", () => {
    const currentAccount = {
      id: "current",
      name: "Current account",
      provider: "Bank",
      currency: "GBP" as const,
      assetType: "cash" as const,
      liquidity: "cash" as const,
      expectedAnnualReturn: 0,
      isOpen: true,
      latestBalance: 10_000,
      latestSnapshotDate: "2026-07-01",
      cagr: null,
    };
    const stocksIsa = {
      ...currentAccount,
      id: "stocks-isa",
      name: "Stocks ISA",
      assetType: "stocks" as const,
      liquidity: "liquid" as const,
    };
    expect(
      plannedExpenditureSourceId([currentAccount, stocksIsa], "stocks-isa"),
    ).toBe("stocks-isa");
    expect(plannedExpenditureSourceId([currentAccount], "stocks-isa")).toBe(
      "current",
    );
  });
});

describe("AssetAllocationHistoryChart", () => {
  it("plots percentage series and exposes an accessible data table", () => {
    render(
      <AssetAllocationHistoryChart
        data={[
          { date: "2025-01-01", totalAssets: 100_000, cash: 0.2, stocks: 0.8 },
          { date: "2026-01-01", totalAssets: 120_000, cash: 0.1, stocks: 0.9 },
        ]}
      />,
    );

    expect(
      screen.getByRole("img", {
        name: "Percentage of assets by asset type over time",
      }),
    ).toBeVisible();
    expect(document.querySelector('[data-series="cash"]')).toBeVisible();
    expect(document.querySelector('[data-series="stocks"]')).toBeVisible();
    expect(
      screen.getByRole("table", {
        name: "Percentage of assets by asset type over time",
      }),
    ).toHaveTextContent("2025-01-0120.0%80.0%2026-01-0110.0%90.0%");
  });
});

describe("PortfolioContributionChart", () => {
  it("plots contributed capital independently of worth and exposes its data", () => {
    render(
      <PortfolioContributionChart
        data={[
          { date: "2025-01-01", contributedCapital: 80_000 },
          { date: "2026-01-01", contributedCapital: 92_500 },
        ]}
      />,
    );

    expect(
      screen.getByRole("img", {
        name: "Cumulative contributed capital over time",
      }),
    ).toBeVisible();
    expect(
      document.querySelector('[data-series="contributedCapital"]'),
    ).toBeVisible();
    expect(
      screen.getByRole("table", {
        name: "Cumulative contributed capital over time",
      }),
    ).toHaveTextContent("2025-01-01£80,0002026-01-01£92,500");
  });

  it("explains how to populate an empty contribution history", () => {
    render(<PortfolioContributionChart data={[]} />);

    expect(
      screen.getByText(/Import an account's “Total contributed to date”/),
    ).toBeVisible();
  });
});

describe("UpcomingFlows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps upcoming rows narrow-first on mobile", () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);

    const today = todayIsoDate();
    mockAssetTracker({
      accounts: [
        {
          id: "cash",
          name: "Current account",
          provider: "Bank",
          currency: "GBP",
          assetType: "cash",
          expectedAnnualReturn: 0,
          isOpen: true,
          latestBalance: 1000,
          latestSnapshotDate: today,
          cagr: null,
        },
      ],
      accountDetails: [
        {
          id: "cash",
          name: "Current account",
          provider: "Bank",
          currency: "GBP",
          assetType: "cash",
          expectedAnnualReturn: 0,
          isOpen: true,
          latestBalance: 1000,
          latestSnapshotDate: today,
          cagr: null,
          createdAt: today,
          snapshots: [{ date: today, balance: 1000 }],
          capitalFlows: [],
          netContributed: null,
          gainLoss: null,
        },
      ],
      recurringFlows: [
        {
          id: "salary",
          name: "Salary",
          toAccountId: "cash",
          amount: 2500,
          currency: "GBP",
          frequency: "monthly",
          startDate: today,
        },
      ],
    });

    const { container } = render(<UpcomingFlows />);

    expect(container.querySelector('[data-slot="card"]')).toHaveClass(
      "min-w-0",
    );
    const row = screen.getByText("Salary").closest("li");
    expect(row).toHaveClass("grid", "min-w-0", "sm:flex");
    expect(row?.querySelector("span")).toHaveClass("shrink-0", "sm:w-24");
  });
});

describe("AccountsTable", () => {
  it("hides closed accounts until requested", async () => {
    const user = userEvent.setup();
    render(
      <AccountsTable
        accounts={[
          {
            id: "current",
            name: "Current account",
            provider: "Bank",
            currency: "GBP",
            assetType: "cash",
            expectedAnnualReturn: 0.01,
            isOpen: true,
            latestBalance: 2_000,
            latestSnapshotDate: "2026-01-01",
            cagr: null,
            createdAt: "2024-01-01",
            snapshots: [{ date: "2026-01-01", balance: 2_000 }],
            capitalFlows: [],
            netContributed: null,
            gainLoss: null,
          },
          {
            id: "old-fund",
            name: "Old fund",
            provider: "Broker",
            currency: "GBP",
            assetType: "stocks",
            expectedAnnualReturn: 0.05,
            isOpen: false,
            latestBalance: 0,
            latestSnapshotDate: "2025-01-01",
            cagr: null,
            createdAt: "2023-01-01",
            closedAt: "2025-01-01",
            snapshots: [{ date: "2025-01-01", balance: 0 }],
            capitalFlows: [],
            netContributed: null,
            gainLoss: null,
          },
        ]}
      />,
    );

    expect(screen.getByText("Current account")).toBeVisible();
    expect(screen.queryByText("Old fund")).toBeNull();

    await user.click(
      screen.getByRole("button", { name: "Show closed accounts (1)" }),
    );

    expect(screen.getByText("Old fund")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Hide closed accounts" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Open-account net worth")).toBeVisible();
  });
});

describe("FlowSankeyChart", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("preserves the calculated node order in the Sankey layout", async () => {
    const today = todayIsoDate();
    const tracker = mockAssetTracker({
      accountDetails: [
        {
          id: "current",
          name: "Current",
          provider: "Bank",
          currency: "GBP",
          assetType: "cash",
          expectedAnnualReturn: 0,
          isOpen: true,
          latestBalance: 1000,
          latestSnapshotDate: today,
          cagr: null,
          createdAt: today,
          snapshots: [{ date: today, balance: 1000 }],
          capitalFlows: [],
          netContributed: null,
          gainLoss: null,
        },
        {
          id: "isa",
          name: "ISA",
          provider: "Broker",
          currency: "GBP",
          assetType: "stocks",
          expectedAnnualReturn: 0,
          isOpen: true,
          latestBalance: 5000,
          latestSnapshotDate: today,
          cagr: null,
          createdAt: today,
          snapshots: [{ date: today, balance: 5000 }],
          capitalFlows: [],
          netContributed: null,
          gainLoss: null,
        },
      ],
      recurringFlows: [
        {
          id: "isa",
          name: "ISA contribution",
          fromAccountId: "current",
          toAccountId: "isa",
          amount: 500,
          currency: "GBP",
          frequency: "monthly",
          startDate: today,
        },
      ],
    });

    render(
      <FlowSankeyChart
        data={buildFlowSankeyData(
          tracker.accountDetails,
          tracker.recurringFlows,
          Object.fromEntries(
            tracker.accountDetails.map((account) => [
              account.id,
              account.latestBalance ?? 0,
            ]),
          ),
          today,
        )}
        currency="GBP"
      />,
    );

    expect(await screen.findByTestId("flow-sankey")).toHaveAttribute(
      "data-align",
      "left",
    );
    expect(screen.getByTestId("flow-sankey")).toHaveAttribute(
      "data-sort",
      "false",
    );
  });

  it("highlights every flow connected to a hovered account", async () => {
    const user = userEvent.setup();
    const today = todayIsoDate();
    const tracker = mockAssetTracker({
      accountDetails: [
        {
          id: "current",
          name: "Current",
          provider: "Bank",
          currency: "GBP",
          assetType: "cash",
          expectedAnnualReturn: 0,
          isOpen: true,
          latestBalance: 1000,
          latestSnapshotDate: today,
          cagr: null,
          createdAt: today,
          snapshots: [{ date: today, balance: 1000 }],
          capitalFlows: [],
          netContributed: null,
          gainLoss: null,
        },
        {
          id: "isa",
          name: "ISA",
          provider: "Broker",
          currency: "GBP",
          assetType: "stocks",
          expectedAnnualReturn: 0.05,
          isOpen: true,
          latestBalance: 5000,
          latestSnapshotDate: today,
          cagr: null,
          createdAt: today,
          snapshots: [{ date: today, balance: 5000 }],
          capitalFlows: [],
          netContributed: null,
          gainLoss: null,
        },
      ],
      recurringFlows: [
        {
          id: "salary",
          name: "Salary",
          toAccountId: "current",
          amount: 2000,
          currency: "GBP",
          frequency: "monthly",
          startDate: today,
        },
        {
          id: "isa",
          name: "ISA contribution",
          fromAccountId: "current",
          toAccountId: "isa",
          amount: 500,
          currency: "GBP",
          frequency: "monthly",
          startDate: today,
        },
      ],
    });

    render(
      <FlowSankeyChart
        data={buildFlowSankeyData(
          tracker.accountDetails,
          tracker.recurringFlows,
          Object.fromEntries(
            tracker.accountDetails.map((account) => [
              account.id,
              account.latestBalance ?? 0,
            ]),
          ),
          today,
        )}
        currency="GBP"
      />,
    );

    const current = await screen.findByTestId("sankey-node-current");
    const incoming = screen.getByLabelText("External income to Current");
    const outgoing = screen.getByLabelText("Current to ISA");
    const unrelated = screen.getAllByLabelText("Expected returns to ISA")[0];
    if (!unrelated) throw new Error("Expected the return flow to be rendered");
    await user.hover(current);

    expect(current.querySelector("rect")).toHaveAttribute("fill-opacity", "1");
    expect(incoming).toHaveAttribute("stroke-opacity", "0.65");
    expect(outgoing).toHaveAttribute("stroke-opacity", "0.65");
    expect(unrelated).toHaveAttribute("stroke-opacity", "0.25");

    await user.unhover(current);
    expect(incoming).toHaveAttribute("stroke-opacity", "0.25");

    await user.hover(unrelated);
    const flowKey = unrelated.getAttribute("data-flow-key");
    expect(flowKey).not.toBeNull();
    for (const segment of document.querySelectorAll(
      `[data-flow-key="${flowKey}"]`,
    )) {
      const opacityAttribute =
        segment.tagName === "path" ? "stroke-opacity" : "fill-opacity";
      expect(segment).toHaveAttribute(opacityAttribute, "0.65");
    }
    expect(
      screen
        .getByTestId("sankey-node-__expected_returns")
        .querySelector("rect"),
    ).toHaveAttribute("fill-opacity", "1");
    expect(
      screen.getByTestId("sankey-node-isa").querySelector("rect"),
    ).toHaveAttribute("fill-opacity", "1");
  });
});

describe("buildFlowSankeyData", () => {
  it("omits closed accounts and recurring flows attached to them", () => {
    const data = buildFlowSankeyData(
      [
        {
          id: "closed-isa",
          name: "Closed ISA",
          provider: "Broker",
          currency: "GBP",
          assetType: "stocks",
          expectedAnnualReturn: 0.07,
          isOpen: false,
          latestBalance: 10_000,
          latestSnapshotDate: "2026-07-03",
          cagr: null,
        },
      ],
      [
        {
          id: "closed-contribution",
          name: "Closed contribution",
          toAccountId: "closed-isa",
          amount: 500,
          currency: "GBP",
          frequency: "monthly",
          startDate: "2026-07-01",
        },
      ],
      {},
    );

    expect(data).toEqual({ nodes: [], links: [] });
  });

  it("splits gross salary into take-home pay, pension, and tax", () => {
    const data = buildFlowSankeyData(
      [
        {
          id: "current",
          name: "Instant access",
          provider: "Bank",
          currency: "GBP",
          assetType: "cash",
          expectedAnnualReturn: 0,
          isOpen: true,
          latestBalance: 1_000,
          latestSnapshotDate: "2026-07-03",
          cagr: null,
        },
        {
          id: "pension",
          name: "Pension",
          provider: "Provider",
          currency: "GBP",
          assetType: "stocks",
          expectedAnnualReturn: 0,
          isOpen: true,
          latestBalance: 10_000,
          latestSnapshotDate: "2026-07-03",
          cagr: null,
        },
      ],
      [
        {
          id: "salary",
          name: "Take-home salary",
          toAccountId: "current",
          amount: 4_100,
          grossAmount: 6_400,
          currency: "GBP",
          compensationKind: "takeHomeIncome",
          frequency: "monthly",
          startDate: "2026-07-01",
        },
        {
          id: "employee-pension",
          name: "Employee pension",
          toAccountId: "pension",
          amount: 900,
          currency: "GBP",
          compensationKind: "employeePension",
          frequency: "monthly",
          startDate: "2026-07-01",
        },
        {
          id: "employer-pension",
          name: "Employer pension",
          toAccountId: "pension",
          amount: 350,
          currency: "GBP",
          compensationKind: "employerPension",
          frequency: "monthly",
          startDate: "2026-07-01",
        },
      ],
      {},
    );

    expect(data.nodes.map((node) => node.name)).toEqual([
      "External income",
      "Gross pay",
      "Instant access",
      "Pension",
      "Tax and deductions",
    ]);
    expect(data.links).toEqual([
      {
        source: 0,
        target: 1,
        value: 6_400,
        label: "Gross salary",
        sourceName: "External income",
        targetName: "Gross pay",
      },
      {
        source: 1,
        target: 2,
        value: 4_100,
        label: "Take-home salary",
        sourceName: "Gross pay",
        targetName: "Instant access",
      },
      {
        source: 1,
        target: 3,
        value: 900,
        label: "Employee pension",
        sourceName: "Gross pay",
        targetName: "Pension",
      },
      {
        source: 0,
        target: 3,
        value: 350,
        label: "Employer pension",
        sourceName: "External income",
        targetName: "Pension",
      },
      {
        source: 1,
        target: 4,
        value: 1_400,
        label: "Tax and deductions",
        sourceName: "Gross pay",
        targetName: "Tax and deductions",
      },
    ]);
  });

  it("keeps pension external when it would over-allocate gross pay", () => {
    const data = buildFlowSankeyData(
      [
        {
          id: "current",
          name: "Current",
          provider: "Bank",
          currency: "GBP",
          assetType: "cash",
          expectedAnnualReturn: 0,
          isOpen: true,
          latestBalance: 1_000,
          latestSnapshotDate: "2026-07-03",
          cagr: null,
        },
        {
          id: "pension",
          name: "Pension",
          provider: "Provider",
          currency: "GBP",
          assetType: "stocks",
          expectedAnnualReturn: 0,
          isOpen: true,
          latestBalance: 10_000,
          latestSnapshotDate: "2026-07-03",
          cagr: null,
        },
      ],
      [
        {
          id: "salary",
          name: "Take-home salary",
          toAccountId: "current",
          amount: 90,
          grossAmount: 100,
          currency: "GBP",
          compensationKind: "takeHomeIncome",
          frequency: "monthly",
          startDate: "2026-07-01",
        },
        {
          id: "employee-pension",
          name: "Employee pension",
          toAccountId: "pension",
          amount: 20,
          currency: "GBP",
          compensationKind: "employeePension",
          frequency: "monthly",
          startDate: "2026-07-01",
        },
      ],
      {},
    );

    expect(
      data.links.map(({ sourceName, targetName, value }) => ({
        sourceName,
        targetName,
        value,
      })),
    ).toEqual([
      { sourceName: "External income", targetName: "Gross pay", value: 100 },
      { sourceName: "Gross pay", targetName: "Current", value: 90 },
      { sourceName: "External income", targetName: "Pension", value: 20 },
      {
        sourceName: "Gross pay",
        targetName: "Tax and deductions",
        value: 10,
      },
    ]);
  });

  it("tolerates floating-point noise in an exactly allocated gross pay", () => {
    const data = buildFlowSankeyData(
      [
        {
          id: "current",
          name: "Current",
          provider: "Bank",
          currency: "GBP",
          assetType: "cash",
          expectedAnnualReturn: 0,
          isOpen: true,
          latestBalance: 0,
          latestSnapshotDate: "2026-07-03",
          cagr: null,
        },
        {
          id: "pension",
          name: "Pension",
          provider: "Provider",
          currency: "GBP",
          assetType: "stocks",
          expectedAnnualReturn: 0,
          isOpen: true,
          latestBalance: 0,
          latestSnapshotDate: "2026-07-03",
          cagr: null,
        },
      ],
      [
        {
          id: "salary",
          name: "Take-home salary",
          toAccountId: "current",
          amount: 0.1,
          grossAmount: 0.3,
          currency: "GBP",
          compensationKind: "takeHomeIncome",
          frequency: "monthly",
          startDate: "2026-07-01",
        },
        {
          id: "employee-pension",
          name: "Employee pension",
          toAccountId: "pension",
          amount: 0.2,
          currency: "GBP",
          compensationKind: "employeePension",
          frequency: "monthly",
          startDate: "2026-07-01",
        },
      ],
      {},
    );

    expect(
      data.links.map(({ sourceName, targetName, value }) => ({
        sourceName,
        targetName,
        value,
      })),
    ).toEqual([
      { sourceName: "External income", targetName: "Gross pay", value: 0.3 },
      { sourceName: "Gross pay", targetName: "Current", value: 0.1 },
      { sourceName: "Gross pay", targetName: "Pension", value: 0.2 },
    ]);
  });

  it("converts regular flows into monthly Sankey links", () => {
    const data = buildFlowSankeyData(
      [
        {
          id: "current",
          name: "Current",
          provider: "Bank",
          currency: "GBP",
          assetType: "cash",
          expectedAnnualReturn: 0,
          isOpen: true,
          latestBalance: 1000,
          latestSnapshotDate: "2026-07-03",
          cagr: null,
        },
        {
          id: "isa",
          name: "ISA",
          provider: "Broker",
          currency: "GBP",
          assetType: "stocks",
          expectedAnnualReturn: 0.07,
          isOpen: true,
          latestBalance: 5000,
          latestSnapshotDate: "2026-07-03",
          cagr: null,
        },
        {
          id: "card",
          name: "Credit Card",
          provider: "Card",
          currency: "GBP",
          assetType: "debt",
          expectedAnnualReturn: 0.2,
          isOpen: true,
          latestBalance: -2000,
          latestSnapshotDate: "2026-07-03",
          cagr: null,
        },
      ],
      [
        {
          id: "salary",
          name: "Salary",
          toAccountId: "current",
          amount: 3200,
          currency: "GBP",
          frequency: "monthly",
          startDate: "2026-07-01",
        },
        {
          id: "isa",
          name: "ISA",
          fromAccountId: "current",
          toAccountId: "isa",
          amount: 6000,
          currency: "GBP",
          frequency: "yearly",
          startDate: "2026-07-01",
        },
        {
          id: "card",
          name: "Card minimum",
          fromAccountId: "current",
          toAccountId: "card",
          formula: {
            kind: "minimumPayment",
            percentOfBalance: 0.025,
            floor: 25,
          },
          currency: "GBP",
          frequency: "monthly",
          startDate: "2026-07-01",
        },
      ],
      { card: -2000 },
    );

    expect(data.nodes.map((node) => node.name)).toEqual([
      "External income",
      "Current",
      "ISA",
      "Credit Card",
      "Expected returns",
      "Interest charged",
    ]);
    expect(data.links).toEqual([
      {
        source: 0,
        target: 1,
        value: 3200,
        label: "Salary",
        sourceName: "External income",
        targetName: "Current",
      },
      {
        source: 1,
        target: 2,
        value: 500,
        label: "ISA",
        sourceName: "Current",
        targetName: "ISA",
      },
      {
        source: 1,
        target: 3,
        value: 50,
        label: "Card minimum",
        sourceName: "Current",
        targetName: "Credit Card",
      },
      {
        source: 4,
        target: 2,
        value: 28.27,
        label: "Expected return",
        sourceName: "Expected returns",
        targetName: "ISA",
      },
      {
        source: 3,
        target: 5,
        value: 30.62,
        label: "Interest charged",
        sourceName: "Credit Card",
        targetName: "Interest charged",
      },
    ]);
  });

  it("splits linked liability repayments into interest and principal flows", () => {
    const data = buildFlowSankeyData(
      [
        {
          id: "current",
          name: "Current",
          provider: "Bank",
          currency: "GBP",
          assetType: "cash",
          expectedAnnualReturn: 0,
          isOpen: true,
          latestBalance: 1000,
          latestSnapshotDate: "2026-07-03",
          cagr: null,
        },
        {
          id: "home",
          name: "Home",
          provider: "Property",
          currency: "GBP",
          assetType: "property",
          expectedAnnualReturn: 0.03,
          isOpen: true,
          latestBalance: 298000,
          latestSnapshotDate: "2026-07-03",
          cagr: null,
        },
        {
          id: "mortgage",
          name: "Home Mortgage",
          provider: "Lender",
          currency: "GBP",
          assetType: "debt",
          expectedAnnualReturn: 0.0425,
          linkedAccountId: "home",
          isOpen: true,
          latestBalance: -212800,
          latestSnapshotDate: "2026-07-03",
          cagr: null,
        },
      ],
      [
        {
          id: "mortgage-payment",
          name: "Mortgage payment",
          fromAccountId: "current",
          toAccountId: "mortgage",
          amount: 1150,
          currency: "GBP",
          frequency: "monthly",
          startDate: "2026-07-01",
        },
      ],
      { mortgage: -212800 },
    );

    expect(data.nodes.map((node) => node.name)).toEqual([
      "Current",
      "Home Mortgage",
      "Expected returns",
      "Home",
      "Interest charged",
    ]);
    expect(data.links).toEqual([
      {
        source: 0,
        target: 1,
        value: 1150,
        label: "Mortgage payment",
        sourceName: "Current",
        targetName: "Home Mortgage",
      },
      {
        source: 2,
        target: 3,
        value: 734.95,
        label: "Expected return",
        sourceName: "Expected returns",
        targetName: "Home",
      },
      {
        source: 1,
        target: 4,
        value: 739.37,
        label: "Interest charged",
        sourceName: "Home Mortgage",
        targetName: "Interest charged",
      },
      {
        source: 1,
        target: 3,
        value: 410.63,
        label: "Principal repayment",
        sourceName: "Home Mortgage",
        targetName: "Home",
      },
    ]);
  });

  it("shows expected losses for depreciating assets", () => {
    const data = buildFlowSankeyData(
      [
        {
          id: "car",
          name: "Car",
          provider: "Owned",
          currency: "GBP",
          assetType: "property",
          expectedAnnualReturn: -0.12,
          isOpen: true,
          latestBalance: 10000,
          latestSnapshotDate: "2026-07-03",
          cagr: null,
        },
      ],
      [],
      {},
    );

    expect(data.nodes.map((node) => node.name)).toEqual([
      "Car",
      "Expected losses",
    ]);
    expect(data.links).toEqual([
      {
        source: 0,
        target: 1,
        value: 105.96,
        label: "Expected loss",
        sourceName: "Car",
        targetName: "Expected losses",
      },
    ]);
  });

  it("skips invalid expected return calculations", () => {
    const data = buildFlowSankeyData(
      [
        {
          id: "asset",
          name: "Invalid return asset",
          provider: "Provider",
          currency: "GBP",
          assetType: "stocks",
          expectedAnnualReturn: -1,
          isOpen: true,
          latestBalance: 10000,
          latestSnapshotDate: "2026-07-03",
          cagr: null,
        },
      ],
      [],
      {},
    );

    expect(data).toEqual({ nodes: [], links: [] });
  });

  it("does not create zero-value links after rounding", () => {
    const data = buildFlowSankeyData(
      [
        {
          id: "current",
          name: "Current",
          provider: "Bank",
          currency: "GBP",
          assetType: "cash",
          expectedAnnualReturn: 0,
          isOpen: true,
          latestBalance: 1000,
          latestSnapshotDate: "2026-07-03",
          cagr: null,
        },
        {
          id: "savings",
          name: "Savings",
          provider: "Bank",
          currency: "GBP",
          assetType: "cash",
          expectedAnnualReturn: 0,
          isOpen: true,
          latestBalance: 1000,
          latestSnapshotDate: "2026-07-03",
          cagr: null,
        },
      ],
      [
        {
          id: "dust",
          name: "Dust",
          fromAccountId: "current",
          toAccountId: "savings",
          amount: 0.004,
          currency: "GBP",
          frequency: "monthly",
          startDate: "2026-07-01",
        },
      ],
      {},
    );

    expect(data).toEqual({ nodes: [], links: [] });
  });

  it("deduplicates labels when merging equivalent links", () => {
    const data = buildFlowSankeyData(
      [
        {
          id: "current",
          name: "Current",
          provider: "Bank",
          currency: "GBP",
          assetType: "cash",
          expectedAnnualReturn: 0,
          isOpen: true,
          latestBalance: 1000,
          latestSnapshotDate: "2026-07-03",
          cagr: null,
        },
        {
          id: "savings",
          name: "Savings",
          provider: "Bank",
          currency: "GBP",
          assetType: "cash",
          expectedAnnualReturn: 0,
          isOpen: true,
          latestBalance: 1000,
          latestSnapshotDate: "2026-07-03",
          cagr: null,
        },
      ],
      [
        {
          id: "first",
          name: "Transfer",
          fromAccountId: "current",
          toAccountId: "savings",
          amount: 10,
          currency: "GBP",
          frequency: "monthly",
          startDate: "2026-07-01",
        },
        {
          id: "second",
          name: "Transfer",
          fromAccountId: "current",
          toAccountId: "savings",
          amount: 5,
          currency: "GBP",
          frequency: "monthly",
          startDate: "2026-07-01",
        },
      ],
      {},
    );

    expect(data.links).toEqual([
      {
        source: 0,
        target: 1,
        value: 15,
        label: "Transfer",
        sourceName: "Current",
        targetName: "Savings",
      },
    ]);
  });
});
