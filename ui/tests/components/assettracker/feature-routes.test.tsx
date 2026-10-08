import { fireEvent, render, screen } from "@testing-library/react";
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
import {
  AssetTrackerDataSchema,
  getHouseholdTaxEstimate,
} from "@/lib/domain/assettracker";

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

vi.mock("@/components/assettracker/salary-calculation-history", () => ({
  SalaryCalculationHistory: () => <p>Salary calculation history</p>,
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

vi.mock("@/components/assettracker/real-gross-salary-history", () => ({
  RealGrossSalaryHistory: () => <p>Real gross salary history</p>,
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
      netWorthDataByCurrency: {
        GBP: [{ date: "2026-01-01", total: 1 }],
        USD: [{ date: "2026-01-01", total: null }],
        EUR: [],
      },
      contributionData: [],
      assetAllocationHistory: [],
      baseCurrency: "GBP",
      setBaseCurrency: vi.fn(),
      flowSankeyData: { nodes: [], links: [] },
      incomeHistory: [],
      salaryHistory: [],
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
    expect(screen.getByText("Real gross salary history")).toBeVisible();
    expect(screen.getByText("Allocation history")).toBeVisible();
    const currencySelect = screen.getByRole("combobox", {
      name: "Historical target currency",
    });
    expect(currencySelect).toBeVisible();
    expect(currencySelect).toHaveTextContent("GBP");
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
    expect(screen.getAllByRole("heading", { name: "To date" })).toHaveLength(2);
    expect(screen.getAllByText("Year-end projection to 5 April")).toHaveLength(
      2,
    );
    expect(screen.getAllByText("Annual allowance usage")).toHaveLength(2);
    expect(screen.getAllByText("Pension annual allowance")).toHaveLength(2);
    expect(screen.getAllByText("ISA annual allowance")).toHaveLength(2);
    expect(
      screen.getAllByText(/effective 60% Income Tax/).length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryByText(/Applied the Personal Allowance/),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Allowances use income before these bands/),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show explanations" }));

    expect(screen.getAllByText(/Applied the Personal Allowance/)).toHaveLength(
      2,
    );
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
      screen.queryByText(/Allowances use income before these bands/),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Export calculation" }),
    ).toBeVisible();
    expect(screen.queryByText("No total shown")).not.toBeInTheDocument();
  });

  it("offers demo-backed defaults when tax setup is missing", () => {
    const current = mockUseAssetTracker();
    const data = AssetTrackerDataSchema.parse({ accounts: [], snapshots: [] });
    const saveTaxSetup = vi.fn().mockResolvedValue(undefined);
    mockUseAssetTracker.mockReturnValue({
      ...current,
      household: data.household,
      taxEstimate: getHouseholdTaxEstimate(data),
      taxPosition: undefined,
      currentSalaryHistory: [
        {
          id: "historical-salary",
          person: "Me",
          employer: "Old employer",
          employmentId: "old-employer",
          currency: "GBP",
          jurisdiction: "England",
          effectiveStart: "2015-07-01",
          effectiveEnd: "2016-06-30",
          payFrequency: "annual",
          amountKind: "annualSalary",
          grossPay: 19_000,
          source: { kind: "manual" },
          acceptedAt: "2026-10-08T12:00:00.000Z",
        },
      ],
      taxSetupIncomeSuggestions: { primary: 9_600_000 },
      saveTaxSetup,
    } as ReturnType<typeof useAssetTracker>);

    render(<TaxPositionRoute />);

    expect(screen.getByText("Review tax assumptions")).toBeVisible();
    expect(screen.getByDisplayValue("A")).toBeVisible();
    expect(
      screen.getByDisplayValue("England or Northern Ireland"),
    ).toBeVisible();
    expect(
      screen.getByLabelText("Projected taxable employment income (£)"),
    ).toHaveValue(96_000);
    expect(screen.queryByText("No total shown")).not.toBeInTheDocument();
  });
});
