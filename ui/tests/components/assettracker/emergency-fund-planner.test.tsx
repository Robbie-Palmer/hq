import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAssetTracker } from "@/components/assettracker/asset-tracker-provider";
import { EmergencyFundPlanner } from "@/components/assettracker/emergency-fund-planner";
import type { EmergencyFundAnalysis } from "@/lib/domain/assettracker";

vi.mock("@/components/assettracker/asset-tracker-provider", () => ({
  useAssetTracker: vi.fn(),
}));

const mockUseAssetTracker = vi.mocked(useAssetTracker);
const saveEmergencyFundPlan = vi.fn();

const cashAccount = {
  id: "cash",
  name: "Current account",
  provider: "Example Bank",
  currency: "GBP",
  assetType: "cash",
  liquidity: "cash",
  expectedAnnualReturn: 0,
  isOpen: true,
  latestBalance: 12_000,
};

const cashPolicy = {
  accountId: "cash",
  included: true,
  kind: "cash" as const,
  accessDelayDays: 0,
  capitalRiskRate: 0,
  withdrawalFee: 0,
  protectionGroup: "Example Bank",
};

const savingsAccount = {
  ...cashAccount,
  id: "new-savings",
  name: "New savings account",
};

const emergencyFundFacts = {
  essentialMonthlyExpenditure: 1_000,
  monthlyDebtPayments: 175,
  employmentMonthlyIncome: 4_200,
  monthlySideIncome: 500,
  annualInflationRate: 0.025,
};

const analysis: EmergencyFundAnalysis = {
  monthlyEssentialNeed: 1_000,
  accessibleFunds: 12_000,
  accessibleCoverageMonths: 12,
  sources: [
    {
      accountId: "cash",
      accountName: "Current account",
      included: true,
      exclusionReason: null,
      balance: 12_000,
      effectiveBalance: 12_000,
      protectedBalance: null,
      policy: cashPolicy,
    },
  ],
  selectedDecisionCosts: 45_000,
  unconvertedDecisionCostIds: [],
  policyTargets: [
    {
      months: 6,
      target: 6_000,
      fundingGap: 0,
      availableAboveTarget: 6_000,
    },
    {
      months: 18,
      target: 18_000,
      fundingGap: 6_000,
      availableAboveTarget: 0,
    },
    {
      months: 12,
      target: 12_000,
      fundingGap: 0,
      availableAboveTarget: 0,
    },
  ],
  currentResults: [
    {
      scenarioId: "job-loss",
      scenarioName: "Job loss",
      policyMonths: null,
      startingReserve: 12_000,
      endingReserve: 1_000,
      firstShortfallMonth: null,
      shortfallMonths: 0,
      totalShortfall: 0,
      maximumMonthlyShortfall: 0,
      decisionCostsComplete: true,
      unconvertedDecisionCostIds: [],
      path: Array.from({ length: 12 }, (_, index) => ({
        month: index + 1,
        date: `2027-${String(index + 1).padStart(2, "0")}-01`,
        reserveBalance: 11_000 - index * 1_000,
        monthlyNeed: 1_000,
        availableIncome: 0,
        decisionCosts: 0,
        uncoveredShortfall: 0,
      })),
    },
  ],
  policyResults: [
    {
      scenarioId: "job-loss",
      scenarioName: "Job loss",
      policyMonths: 6,
      startingReserve: 6_000,
      endingReserve: 0,
      firstShortfallMonth: 7,
      shortfallMonths: 6,
      totalShortfall: 6_000,
      maximumMonthlyShortfall: 1_000,
      decisionCostsComplete: true,
      unconvertedDecisionCostIds: [],
      path: Array.from({ length: 12 }, (_, index) => ({
        month: index + 1,
        date: `2027-${String(index + 1).padStart(2, "0")}-01`,
        reserveBalance: 0,
        monthlyNeed: 1_000,
        availableIncome: 0,
        decisionCosts: 0,
        uncoveredShortfall: index >= 6 ? 1_000 : 0,
      })),
    },
    {
      scenarioId: "job-loss",
      scenarioName: "Job loss",
      policyMonths: 18,
      startingReserve: 18_000,
      endingReserve: 6_000,
      firstShortfallMonth: null,
      shortfallMonths: 0,
      totalShortfall: 0,
      maximumMonthlyShortfall: 0,
      decisionCostsComplete: true,
      unconvertedDecisionCostIds: [],
      path: Array.from({ length: 12 }, (_, index) => ({
        month: index + 1,
        date: `2027-${String(index + 1).padStart(2, "0")}-01`,
        reserveBalance: 17_000 - index * 1_000,
        monthlyNeed: 1_000,
        availableIncome: 0,
        decisionCosts: 0,
        uncoveredShortfall: 0,
      })),
    },
  ],
};

function trackerContext(update: Record<string, unknown> = {}) {
  return {
    accountDetails: [cashAccount],
    analyseEmergencyFundDraft: () => analysis,
    baseCurrency: "GBP",
    emergencyFundFacts,
    emergencyFundPlans: [],
    financialIndependence: {
      representativeAnnualCurrentExpenditure: 12_000,
    },
    inflation: 0.025,
    saveEmergencyFundPlan,
    ...update,
  } as never;
}

beforeEach(() => {
  saveEmergencyFundPlan.mockReset().mockResolvedValue(undefined);
  mockUseAssetTracker.mockReturnValue(trackerContext());
});

describe("EmergencyFundPlanner", () => {
  it("shows money both below and above the household's selected policies", () => {
    render(<EmergencyFundPlanner />);

    expect(screen.getByText(/£6,000 above target/)).toBeInTheDocument();
    expect(screen.getByText(/£6,000 short/)).toBeInTheDocument();
    expect(
      screen.getByText(
        /spent now, invested for the future, or kept as extra margin/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/£45,000 of selected decision costs/),
    ).toBeVisible();
    expect(screen.getByText("On target")).toBeVisible();
    expect(screen.getByText("No stress result")).toBeVisible();
    expect(
      screen.getAllByText(/No uncovered shortfall over 12 months/),
    ).toHaveLength(2);
    expect(screen.queryByText(/income reliability/i)).not.toBeInTheDocument();
    expect(screen.getByText("£4,200/month")).toBeVisible();
    expect(screen.getByText("Active take-home income flows")).toBeVisible();
  });

  it("edits each assumption and persists a reviewed plan", async () => {
    render(<EmergencyFundPlanner />);
    const changes: Array<[string, string]> = [
      ["Irregular essentials per year", "2400"],
      ["Funds needed within", "5"],
      ["Policies to compare, in months", "6, 18"],
      ["Missing or uncertain facts", "Childcare, contract renewal"],
      ["Access delay for Current account", "2"],
      ["Potential loss percentage for Current account", "5"],
      ["Withdrawal fee for Current account", "10"],
      ["Duration", "18"],
      ["Employment income lost", "80"],
      ["Side-income delay", "4"],
      ["Unexpected cost", "3000"],
    ];
    for (const [label, value] of changes) {
      fireEvent.change(screen.getByLabelText(label), {
        target: { value },
      });
    }
    fireEvent.click(
      screen.getByLabelText("Use Current account as an emergency reserve"),
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Save reserve plan" }),
    );

    expect(saveEmergencyFundPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        essentialMonthlyExpenditure: 1_000,
        annualIrregularEssentialCosts: 2_400,
        monthlyDebtPayments: 175,
        employmentMonthlyIncome: 4_200,
        monthlySideIncome: 500,
        accessNeedDays: 5,
        coverageMonths: [6, 18],
        missingData: ["Childcare", "contract renewal"],
        accountPolicies: [
          expect.objectContaining({
            accountId: "cash",
            included: false,
            accessDelayDays: 2,
            capitalRiskRate: 0.05,
            withdrawalFee: 10,
          }),
        ],
        stressScenarios: [
          expect.objectContaining({
            durationMonths: 18,
            employmentIncomeLossRate: 0.8,
            sideIncomeDelayMonths: 4,
            unexpectedCost: 3_000,
            annualInflationRate: 0.025,
          }),
        ],
      }),
    );
  });

  it("reports persistence errors without asking for regulatory sources", async () => {
    saveEmergencyFundPlan.mockRejectedValueOnce(
      new Error("Storage unavailable"),
    );
    render(<EmergencyFundPlanner />);

    expect(screen.queryByText("Protection limit")).not.toBeInTheDocument();
    expect(screen.queryByText("Source URL")).not.toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "Save reserve plan" }),
    );

    expect(await screen.findByText("Something went wrong")).toBeVisible();
  });

  it("preserves unsaved edits and adds policies when tracker data changes", () => {
    const { rerender } = render(<EmergencyFundPlanner />);
    fireEvent.change(screen.getByLabelText("Irregular essentials per year"), {
      target: { value: "2400" },
    });
    mockUseAssetTracker.mockReturnValue(
      trackerContext({
        accountDetails: [cashAccount, savingsAccount],
        emergencyFundFacts: { ...emergencyFundFacts, monthlySideIncome: 750 },
      }),
    );

    rerender(<EmergencyFundPlanner />);

    expect(screen.getByLabelText("Irregular essentials per year")).toHaveValue(
      2400,
    );
    expect(
      screen.getByLabelText("Use New savings account as an emergency reserve"),
    ).toBeChecked();
  });

  it("warns when a selected decision cost cannot be converted", () => {
    const incompleteResult = {
      ...analysis.currentResults[0],
      decisionCostsComplete: false,
      unconvertedDecisionCostIds: ["foreign-decision:payment"],
    };
    mockUseAssetTracker.mockReturnValue(
      trackerContext({
        analyseEmergencyFundDraft: () => ({
          ...analysis,
          unconvertedDecisionCostIds: ["foreign-decision:payment"],
          currentResults: [incompleteResult],
        }),
      }),
    );

    render(<EmergencyFundPlanner />);

    expect(
      screen.getByText(/affected stress results are marked incomplete/),
    ).toBeVisible();
    expect(screen.getByText(/omitted from this stress path/)).toBeVisible();
  });

  it("shows saved lineage and switches the save action to versioning", () => {
    mockUseAssetTracker.mockReturnValue({
      accountDetails: [cashAccount],
      analyseEmergencyFundDraft: () => analysis,
      baseCurrency: "GBP",
      emergencyFundFacts,
      emergencyFundPlans: [
        {
          id: "household-emergency-reserves-v2",
          seriesId: "household-emergency-reserves",
          name: "Household emergency reserves",
          version: 2,
          status: "active",
          createdAt: "2026-10-05T12:00:00Z",
          essentialMonthlyExpenditure: 1_000,
          annualIrregularEssentialCosts: 0,
          monthlyDebtPayments: 0,
          employmentMonthlyIncome: 1_000,
          monthlySideIncome: 0,
          accessNeedDays: 7,
          missingData: [],
          coverageMonths: [6, 18],
          accountPolicies: [cashPolicy],
          stressScenarios: [
            {
              id: "job-loss",
              name: "Job loss",
              durationMonths: 12,
              employmentIncomeLossRate: 1,
              sideIncomeDelayMonths: 2,
              unexpectedCost: 0,
              annualInflationRate: 0.025,
            },
          ],
        },
      ],
      financialIndependence: {
        representativeAnnualCurrentExpenditure: 12_000,
      },
      inflation: 0.025,
      saveEmergencyFundPlan,
    } as never);

    render(<EmergencyFundPlanner />);

    expect(screen.getByText("Version 2")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Save as new version" }),
    ).toBeVisible();
  });

  it("keeps the shared reserve plan out of a member scope", () => {
    mockUseAssetTracker.mockReturnValue({
      accountDetails: [cashAccount],
      analyseEmergencyFundDraft: () => analysis,
      baseCurrency: "GBP",
      emergencyFundFacts,
      emergencyFundPlans: [],
      financialIndependence: {
        representativeAnnualCurrentExpenditure: 12_000,
      },
      household: { activeScope: { kind: "member", memberId: "alex" } },
      inflation: 0.025,
      saveEmergencyFundPlan,
    } as never);

    render(<EmergencyFundPlanner />);

    expect(
      screen.getByText(/Switch the account scope to Household/),
    ).toBeVisible();
  });
});
