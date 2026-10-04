import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAssetTracker } from "@/components/assettracker/asset-tracker-provider";
import { CashFlowRoute } from "@/components/assettracker/cash-flow-route";
import { HistoryRoute } from "@/components/assettracker/history-route";
import { ImportsRoute } from "@/components/assettracker/imports-route";
import { MortgageRoute } from "@/components/assettracker/mortgage-route";
import { PlanningRoute } from "@/components/assettracker/planning-route";
import { SettingsRoute } from "@/components/assettracker/settings-route";
import { TaxPositionRoute } from "@/components/assettracker/tax-position-route";
import { getDemoAssetTrackerData } from "@/lib/assettracker/demoData";
import { getHouseholdTaxEstimate } from "@/lib/domain/assettracker";

vi.mock("@/components/assettracker/asset-tracker-provider", () => ({
  useAssetTracker: vi.fn(),
}));

vi.mock("@/components/assettracker/account-history-import-drawer", () => ({
  AccountHistoryImportDrawer: () => <p>Account history import</p>,
}));

vi.mock("@/components/assettracker/income-history-import-drawer", () => ({
  IncomeHistoryImportDrawer: () => <p>Income history import</p>,
}));

vi.mock("@/components/assettracker/spreadsheet-import-drawer", () => ({
  SpreadsheetImportDrawer: () => <p>Spreadsheet import</p>,
}));

vi.mock("@/components/assettracker/salary-history-manager", () => ({
  SalaryHistoryManager: () => <p>Salary history management</p>,
}));

vi.mock("@/components/assettracker/net-worth-chart", () => ({
  NetWorthChart: () => <p>Net worth history</p>,
}));

vi.mock("@/components/assettracker/portfolio-contribution-chart", () => ({
  PortfolioContributionChart: () => <p>Contribution history</p>,
}));

vi.mock("@/components/assettracker/asset-allocation-history-chart", () => ({
  AssetAllocationHistoryChart: () => <p>Allocation history</p>,
}));

vi.mock("@/components/assettracker/real-income-history-chart", () => ({
  RealIncomeHistoryChart: () => <p>Real income history</p>,
}));

vi.mock("@/components/assettracker/upcoming-flows", () => ({
  UpcomingFlows: () => <p>Upcoming flows</p>,
}));

vi.mock("@/components/assettracker/recurring-flows-manager", () => ({
  RecurringFlowsManager: () => <p>Recurring flow management</p>,
}));

vi.mock("@/components/assettracker/record-transfer-drawer", () => ({
  RecordTransferDrawer: () => <p>Record transfer</p>,
}));

vi.mock("@/components/assettracker/flow-sankey-chart", () => ({
  FlowSankeyChart: () => <p>Flow map</p>,
}));

vi.mock("@/components/assettracker/income-expenditure-chart", () => ({
  IncomeExpenditureChart: () => <p>Income and spending</p>,
}));

vi.mock("@/components/assettracker/portfolio-goal", () => ({
  PortfolioGoal: ({ showIncomeTools }: { showIncomeTools?: boolean }) => (
    <p>Planning tools without income: {String(showIncomeTools === false)}</p>
  ),
}));

vi.mock("@/components/assettracker/mortgage-calculator", () => ({
  MortgageCalculator: () => <p>Mortgage calculator</p>,
}));

vi.mock("@/components/assettracker/mortgage-investment-comparison", () => ({
  MortgageInvestmentComparison: () => <p>Mortgage versus investing</p>,
}));

vi.mock("@/components/assettracker/housing-strategy-planner", () => ({
  HousingStrategyPlanner: () => <p>Housing strategy</p>,
}));

vi.mock("@/components/assettracker/data-controls", () => ({
  DataControls: ({ mode }: { mode?: string }) => <p>Data controls: {mode}</p>,
}));

const mockUseAssetTracker = vi.mocked(useAssetTracker);

describe("Asset Tracker feature routes", () => {
  beforeEach(() => {
    mockUseAssetTracker.mockReturnValue({
      netWorthData: [],
      netWorthDataByCurrency: { GBP: [], USD: [], EUR: [] },
      contributionData: [],
      assetAllocationHistory: [],
      baseCurrency: "GBP",
      setBaseCurrency: vi.fn(),
      flowSankeyData: { nodes: [], links: [] },
      incomeHistory: [],
      financialIndependence: { periods: [] },
      household: {
        members: [
          { id: "alex", displayName: "Alex" },
          { id: "sam", displayName: "Sam" },
        ],
        activeScope: { kind: "household" },
      },
      taxEstimate: getHouseholdTaxEstimate(getDemoAssetTrackerData()),
      exportTaxEstimate: vi.fn(),
    } as unknown as ReturnType<typeof useAssetTracker>);
  });

  it("composes the history route", () => {
    render(<HistoryRoute />);

    expect(screen.getByText("Account history import")).toBeVisible();
    expect(screen.getByText("Net worth history")).toBeVisible();
    expect(screen.getByText("Contribution history")).toBeVisible();
    expect(screen.getByText("Real income history")).toBeVisible();
    expect(screen.getByText("Allocation history")).toBeVisible();
    expect(
      screen.getByRole("combobox", { name: "Historical target currency" }),
    ).toBeVisible();
  });

  it("composes the cash-flow route", () => {
    render(<CashFlowRoute />);

    for (const label of [
      "Income history import",
      "Record transfer",
      "Upcoming flows",
      "Recurring flow management",
      "Flow map",
      "Income and spending",
    ]) {
      expect(screen.getByText(label)).toBeVisible();
    }
  });

  it("keeps planning focused on FI, runway, spending, and projections", () => {
    render(<PlanningRoute />);

    expect(
      screen.getByText("Planning tools without income: true"),
    ).toBeVisible();
    expect(screen.queryByText("Mortgage calculator")).not.toBeInTheDocument();
  });

  it("composes mortgage planning separately from FI planning", () => {
    render(<MortgageRoute />);

    expect(screen.getByText("Mortgage calculator")).toBeVisible();
    expect(screen.getByText("Mortgage versus investing")).toBeVisible();
    expect(screen.getByText("Housing strategy")).toBeVisible();
    expect(
      screen.queryByText("Planning tools without income: true"),
    ).not.toBeInTheDocument();
  });

  it("separates imports from household settings", () => {
    const { unmount } = render(<ImportsRoute />);
    expect(screen.getByText("Account history import")).toBeVisible();
    expect(screen.getByText("Income history import")).toBeVisible();
    expect(screen.getByText("Spreadsheet import")).toBeVisible();
    expect(screen.getByText("Salary history management")).toBeVisible();
    expect(screen.getByText("Data controls: data")).toBeVisible();

    unmount();
    render(<SettingsRoute />);
    expect(screen.getByText("Data controls: settings")).toBeVisible();
  });

  it("shows the household tax estimate and its lineage", () => {
    render(<TaxPositionRoute />);

    expect(
      screen.getByRole("heading", { name: "UK tax position" }),
    ).toBeVisible();
    expect(screen.getByText("Calculation lineage")).toBeVisible();
    expect(screen.getAllByText("Savings interest tax")).toHaveLength(2);
    expect(screen.getAllByText("Personal Savings Allowance")).toHaveLength(2);
    expect(screen.getAllByText("Tax bands consumed")).toHaveLength(2);
    expect(screen.getAllByText("Recorded to date")).toHaveLength(4);
    expect(screen.getAllByText("Year-end projection")).toHaveLength(4);
    expect(screen.getAllByText("Annual allowance usage")).toHaveLength(2);
    expect(screen.getAllByText("Pension annual allowance")).toHaveLength(4);
    expect(screen.getAllByText("ISA annual allowance")).toHaveLength(4);
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === "P" &&
          element.textContent
            .replaceAll(/\s+/g, " ")
            .includes("The forecast adds £10,000.00 of taxable income"),
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Export calculation" }),
    ).toBeVisible();
    expect(screen.queryByText("No total shown")).not.toBeInTheDocument();
  });
});
