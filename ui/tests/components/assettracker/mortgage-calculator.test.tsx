import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAssetTracker } from "@/components/assettracker/asset-tracker-provider";
import { MortgageCalculator } from "@/components/assettracker/mortgage-calculator";
import { buildMortgageCalculatorModel } from "@/components/assettracker/mortgage-calculator-model";
import type { AccountDetailView } from "@/lib/domain/assettracker";

vi.mock("@/components/assettracker/asset-tracker-provider", () => ({
  useAssetTracker: vi.fn(),
}));

const mockUseAssetTracker = vi.mocked(useAssetTracker);
const saveMortgageScenario = vi.fn();

function account(overrides: Partial<AccountDetailView>): AccountDetailView {
  return {
    id: "account",
    name: "Account",
    provider: "Provider",
    currency: "GBP",
    assetType: "cash",
    expectedAnnualReturn: 0,
    isOpen: true,
    latestBalance: 0,
    latestSnapshotDate: "2026-01-01",
    cagr: null,
    createdAt: "2020-01-01",
    snapshots: [],
    capitalFlows: [],
    netContributed: null,
    gainLoss: null,
    ...overrides,
  };
}

describe("MortgageCalculator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    saveMortgageScenario.mockResolvedValue(undefined);
    mockUseAssetTracker.mockReturnValue({
      baseCurrency: "GBP",
      mortgageScenarios: [],
      saveMortgageScenario,
      housingPlanningPosition: {
        asOfDate: "2026-01-01",
        totalNetWorth: 400_000,
        withdrawalCapital: 50_000,
        homeValue: 300_000,
        mortgageBalance: 100_000,
        homeEquity: 200_000,
        annualNonHousingExpenditure: 24_000,
        annualInvestableIncome: 50_000,
        annualMortgageExpenditureRemoved: 10_000,
        expectedRealReturn: 0.04,
        withdrawalRate: 0.04,
        mortgagePayoffDate: "2036-01-01",
      },
      accountDetails: [
        account({
          id: "home",
          name: "Home",
          assetType: "property",
          latestBalance: 300_000,
        }),
        account({
          id: "mortgage",
          name: "Mortgage",
          assetType: "mortgage",
          latestBalance: -100_000,
          linkedAccountId: "home",
          expectedAnnualReturn: 0.04,
          expectedReturnChanges: [{ date: "2028-01-01", rate: 0.06 }],
          mortgageTerms: {
            firstPaymentDate: "2026-02-01",
            remainingTermMonths: 120,
            overpaymentAllowance: { amount: 10_000, chargeRate: 0.05 },
            fees: [{ date: "2028-01-01", amount: 999 }],
            overpayments: [],
            termChanges: [],
          },
        }),
      ],
    } as unknown as ReturnType<typeof useAssetTracker>);
  });

  it("uses household mortgage facts and recalculates deposit comparisons", async () => {
    render(<MortgageCalculator />);

    expect(
      screen.getByRole("table", { name: "Mortgage deposit comparison" }),
    ).toBeVisible();
    expect(screen.getByText("Mortgage and Home at 2026-01-01")).toBeVisible();
    expect(screen.getByText("60.0%")).toBeVisible();
    expect(screen.getAllByText("Investments retained").length).toBeGreaterThan(
      0,
    );
    expect(screen.getByLabelText("Property price")).not.toBeVisible();

    await userEvent.click(screen.getByText("Adjust mortgage assumptions"));
    fireEvent.change(screen.getByLabelText("Deposit or equity"), {
      target: { value: "150000" },
    });

    expect(screen.getAllByText("£150,000").length).toBeGreaterThan(0);
  });

  it("saves a scenario with source facts and a linked decision", async () => {
    render(<MortgageCalculator />);

    fireEvent.change(screen.getByLabelText("Scenario name"), {
      target: { value: "Five-year fix" },
    });
    await userEvent.click(
      screen.getByRole("button", { name: "Record decision" }),
    );

    expect(saveMortgageScenario).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Five-year fix",
        recordDecision: true,
        source: {
          mortgageAccountId: "mortgage",
          propertyAccountId: "home",
          snapshotDate: "2026-01-01",
        },
      }),
    );
  });

  it("shows the source facts from a loaded scenario", async () => {
    const context = mockUseAssetTracker();
    mockUseAssetTracker.mockReturnValue({
      ...context,
      accountDetails: [
        ...context.accountDetails,
        account({ id: "old-home", name: "Previous home" }),
        account({ id: "old-mortgage", name: "Previous mortgage" }),
      ],
      mortgageScenarios: [
        {
          id: "previous-home-fix",
          name: "Previous home fix",
          createdAt: "2025-06-01",
          source: {
            mortgageAccountId: "old-mortgage",
            propertyAccountId: "old-home",
            snapshotDate: "2025-06-01",
          },
          assumptions: {
            purchasePrice: 250_000,
            availableFunds: 75_000,
            depositAmount: 50_000,
            initialAnnualRate: 0.04,
            termMonths: 240,
            repaymentType: "repayment",
            firstPaymentDate: "2025-07-01",
            followOnAnnualRate: 0.06,
            refinanceFee: 999,
            purchaseFees: 0,
            taxes: 0,
            transactionCosts: 0,
            monthlyOverpayment: 0,
            overpaymentAllowance: 20_000,
            overpaymentChargeRate: 0.05,
          },
        },
      ],
    } as ReturnType<typeof useAssetTracker>);
    render(<MortgageCalculator />);

    await userEvent.click(
      screen.getByRole("button", { name: "Previous home fix" }),
    );

    expect(
      screen.getByText("Previous mortgage and Previous home at 2025-06-01"),
    ).toBeVisible();
  });

  it("uses labelled hypothetical assumptions without complete housing facts", () => {
    const model = buildMortgageCalculatorModel({
      asOfDate: "2026-06-15",
      mortgage: undefined,
      property: undefined,
      position: null,
    });

    expect(model.sourceLabel).toBe("Hypothetical mortgage");
    expect(model.source).toEqual({});
    expect(model.assumptions).toEqual(
      expect.objectContaining({
        purchasePrice: 300_000,
        accrualStartDate: "2026-06-15",
        firstPaymentDate: "2026-07-15",
        fixedPeriodEnd: "2031-07-15",
      }),
    );
  });

  it("uses the rate in force for the first modelled payment", () => {
    const model = buildMortgageCalculatorModel({
      asOfDate: "2026-01-01",
      mortgage: account({
        id: "mortgage",
        assetType: "mortgage",
        latestBalance: -100_000,
        expectedAnnualReturn: 0,
        expectedReturnChanges: [{ date: "2026-01-15", rate: 0.0512 }],
        mortgageTerms: {
          firstPaymentDate: "2026-02-01",
          remainingTermMonths: 240,
          fees: [],
          overpayments: [],
          termChanges: [],
        },
      }),
      property: account({
        id: "home",
        assetType: "property",
        latestBalance: 200_000,
      }),
      position: null,
    });

    expect(model.assumptions.initialAnnualRate).toBe(0.0512);
    expect(model.assumptions.fixedPeriodEnd).toBeUndefined();
  });

  it("points an imported mortgage at the missing account terms", () => {
    const context = mockUseAssetTracker();
    mockUseAssetTracker.mockReturnValue({
      ...context,
      accountDetails: context.accountDetails.map((item) =>
        item.id === "mortgage" ? { ...item, mortgageTerms: undefined } : item,
      ),
    } as ReturnType<typeof useAssetTracker>);

    render(<MortgageCalculator />);

    expect(screen.getByText("Finish setting up Mortgage")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Enter mortgage terms" }),
    ).toHaveAttribute("href", "/assettracker/accounts?account=mortgage");
  });

  it("does not present a zero-rate repayment as a real payment", () => {
    const context = mockUseAssetTracker();
    mockUseAssetTracker.mockReturnValue({
      ...context,
      accountDetails: context.accountDetails.map((item) =>
        item.id === "mortgage"
          ? { ...item, expectedAnnualReturn: 0, expectedReturnChanges: [] }
          : item,
      ),
    } as ReturnType<typeof useAssetTracker>);

    render(<MortgageCalculator />);

    expect(
      screen.getByText("Add Mortgage's current interest rate"),
    ).toBeVisible();
    expect(screen.getAllByText("Rate needed").length).toBeGreaterThan(0);
    expect(screen.queryByText("Rate stress")).not.toBeInTheDocument();
  });

  it("keeps required assumptions valid while inputs are cleared", async () => {
    render(<MortgageCalculator />);
    await userEvent.click(screen.getByText("Adjust mortgage assumptions"));

    fireEvent.change(screen.getByLabelText("Property price"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText("First payment"), {
      target: { value: "" },
    });

    expect(
      screen.getByRole("table", { name: "Mortgage deposit comparison" }),
    ).toBeVisible();
  });
});
