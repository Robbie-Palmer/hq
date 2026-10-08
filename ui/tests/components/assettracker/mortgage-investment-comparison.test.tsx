import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAssetTracker } from "@/components/assettracker/asset-tracker-provider";
import { MortgageInvestmentComparison } from "@/components/assettracker/mortgage-investment-comparison";
import type { AccountDetailView } from "@/lib/domain/assettracker";

vi.mock("@/components/assettracker/asset-tracker-provider", () => ({
  useAssetTracker: vi.fn(),
}));

const mockUseAssetTracker = vi.mocked(useAssetTracker);

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

function mockTracker(accountDetails: AccountDetailView[] = []): void {
  mockUseAssetTracker.mockReturnValue({
    accountDetails,
    baseCurrency: "GBP",
    housingPlanningPosition: {
      asOfDate: "2026-01-01",
      totalNetWorth: 500_000,
      withdrawalCapital: 100_000,
      homeValue: 300_000,
      mortgageBalance: 100_000,
      homeEquity: 200_000,
      annualNonHousingExpenditure: 24_000,
      annualInvestableIncome: 54_000,
      annualMortgageExpenditureRemoved: 12_000,
      expectedRealReturn: 0.04,
      withdrawalRate: 0.04,
      mortgagePayoffDate: "2036-01-01",
    },
  } as ReturnType<typeof useAssetTracker>);
}

function decisionAccounts(withAllowance = true): AccountDetailView[] {
  return [
    account({
      id: "home",
      name: "Home",
      assetType: "property",
      expectedAnnualReturn: 0.02,
      latestBalance: 300_000,
    }),
    account({
      id: "mortgage",
      name: "Mortgage",
      assetType: "mortgage",
      expectedAnnualReturn: 0.04,
      expectedReturnChanges: [{ date: "2028-01-01", rate: 0.06 }],
      latestBalance: -100_000,
      linkedAccountId: "home",
      mortgageTerms: {
        firstPaymentDate: "2026-02-01",
        remainingTermMonths: 120,
        fees: [],
        overpayments: [],
        termChanges: [],
        ...(withAllowance
          ? {
              overpaymentAllowance: {
                amount: 10_000,
                chargeRate: 0.05,
              },
            }
          : {}),
      },
    }),
  ];
}

describe("MortgageInvestmentComparison", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not render without a linked mortgage and property position", () => {
    mockTracker();

    const { container } = render(<MortgageInvestmentComparison />);

    expect(container).toBeEmptyDOMElement();
  });

  it("keeps assumptions collapsed and recalculates every editable input", async () => {
    mockTracker(decisionAccounts());
    render(<MortgageInvestmentComparison />);

    expect(
      screen.getByRole("table", { name: "Mortgage strategy summary" }),
    ).toBeVisible();
    expect(screen.getByLabelText("Capital available now")).not.toBeVisible();
    expect(
      screen.getByRole("table", {
        name: "Detailed mortgage strategy results",
      }),
    ).not.toBeVisible();

    await userEvent.click(screen.getByText("Adjust assumptions"));

    const edits: Array<[string, string]> = [
      ["Capital available now", "18000"],
      ["Monthly surplus", "750"],
      ["Comparison horizon, months", "60"],
      ["Annual return", "7"],
      ["Stress range", "12"],
      ["Stress multiple", "2"],
      ["Annual fee", "0.4"],
      ["Tax on gains", "20"],
      ["Penalty-free overpayment", "12000"],
      ["Charge above allowance", "3"],
    ];
    for (const [label, value] of edits) {
      const input = screen.getByLabelText(label);
      fireEvent.change(input, { target: { value } });
      expect(Number((input as HTMLInputElement).value)).toBeCloseTo(
        Number(value),
      );
    }

    expect(screen.getByText("At 5 years")).toBeVisible();
    expect(
      within(
        screen.getByRole("table", { name: "Mortgage strategy summary" }),
      ).getByRole("rowheader", { name: "Retain debt and invest" }),
    ).toBeVisible();

    await userEvent.click(screen.getByText("All calculated measures"));
    expect(
      screen.getByRole("columnheader", { name: "Drawdown exposure" }),
    ).toBeVisible();
  }, 15_000);

  it("derives penalty defaults when the mortgage has no allowance", async () => {
    mockTracker(decisionAccounts(false));
    render(<MortgageInvestmentComparison />);

    await userEvent.click(screen.getByText("Adjust assumptions"));

    expect(screen.getByLabelText("Penalty-free overpayment")).toHaveValue(
      10_000,
    );
    expect(screen.getByLabelText("Charge above allowance")).toHaveValue(1);
  });
});
