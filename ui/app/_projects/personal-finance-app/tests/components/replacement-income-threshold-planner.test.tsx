import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAssetTracker } from "@/app/_projects/personal-finance-app/components/asset-tracker-provider";
import { ReplacementIncomeThresholdPlanner } from "@/app/_projects/personal-finance-app/components/replacement-income-threshold-planner";
import type {
  JobMoveScenario,
  ReplacementIncomeThreshold,
} from "@/app/_projects/personal-finance-app/domain";

vi.mock(
  "@/app/_projects/personal-finance-app/components/asset-tracker-provider",
  () => ({ useAssetTracker: vi.fn() }),
);

const mockUseAssetTracker = vi.mocked(useAssetTracker);
const solveReplacementIncomeThresholds = vi.fn();

const scenario: JobMoveScenario = {
  id: "offer",
  name: "Product lead offer",
  employmentStatus: "employed",
  transitionDate: "2026-02-01",
  roleStartDate: "2026-03-01",
  employer: "Northstar",
  baseGrossPay: 80_000,
  variableGrossPay: 5_000,
  payFrequency: "monthly",
  currency: "GBP",
  jurisdiction: "England",
  employeePensionRate: 0.05,
  employeePensionMethod: "salarySacrifice",
  employerPensionRate: 0.05,
  destinationAccountId: "current",
  includedFutureCashFlowIds: [],
  replacedRecurringFlowIds: ["salary"],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const centralAssumption = {
  id: "central",
  name: "Central",
  annualReturn: 0.065,
  annualInflation: 0.025,
  annualSpending: 42_000,
  annualFeeRate: 0.005,
  earlyReturnShock: 0,
  earlyReturnShockYears: 0,
};

function assumptions(
  overrides: Partial<ReplacementIncomeThreshold["assumptions"]> = {},
): ReplacementIncomeThreshold["assumptions"] {
  return {
    projectionStartDate: "2026-01-01",
    roleStartDate: "2026-03-01",
    unemploymentGapMonths: 1,
    redundancyReceipts: [
      {
        name: "Net redundancy",
        date: "2026-02-15",
        amount: 3_000,
        currency: "GBP",
      },
    ],
    annualSpending: 42_000,
    otherIncome: ["Side income"],
    annualReturn: 0.065,
    annualInflation: 0.025,
    annualFeeRate: 0.005,
    earlyReturnShock: 0,
    earlyReturnShockYears: 0,
    employeePensionRate: 0.05,
    employerPensionRate: 0.05,
    horizonMonths: 120,
    ...overrides,
  };
}

function solvedResult(): ReplacementIncomeThreshold {
  return {
    startDate: "2026-03-01",
    assumption: centralAssumption,
    goal: { kind: "preserve-cash-reserve", amount: 15_000 },
    status: "solved",
    explanation: "Converted with reviewed tax rules.",
    annualTakeHomeIncome: 55_000,
    grossAnnualSalary: 80_000,
    annualEmployeePensionContribution: 4_000,
    annualEmployerPensionContribution: 4_000,
    calculation: {
      kind: "tax-derived",
      taxYear: "2026-27",
      calculationVersion: "historical-salary-v2",
      ruleDatasetVersion: "2026.10.4",
    },
    feasibleTakeHomeRange: { minimum: 55_000, maximum: 600_000 },
    boundaries: {
      below: {
        candidateAnnualIncome: 79_999,
        annualTakeHomeIncome: 54_999,
        satisfiesGoal: false,
      },
      at: {
        candidateAnnualIncome: 80_000,
        annualTakeHomeIncome: 55_000,
        satisfiesGoal: true,
      },
      above: {
        candidateAnnualIncome: 80_001,
        annualTakeHomeIncome: 55_001,
        satisfiesGoal: true,
      },
    },
    assumptions: assumptions(),
  };
}

function manualResult(): ReplacementIncomeThreshold {
  return {
    ...solvedResult(),
    startDate: "2026-06-01",
    assumption: { ...centralAssumption, id: "manual", name: "Manual" },
    grossAnnualSalary: null,
    annualEmployeePensionContribution: null,
    annualEmployerPensionContribution: null,
    calculation: {
      kind: "manual-override",
      reasons: ["No supported tax rules."],
    },
    assumptions: assumptions({
      roleStartDate: "2026-06-01",
      redundancyReceipts: [],
      otherIncome: [],
    }),
  };
}

function impossibleResult(): ReplacementIncomeThreshold {
  return {
    ...manualResult(),
    startDate: "2026-09-01",
    assumption: {
      ...centralAssumption,
      id: "impossible",
      name: "Impossible",
    },
    status: "impossible",
    explanation: "The goal is not met in the tested range.",
    annualTakeHomeIncome: null,
    calculation: null,
    feasibleTakeHomeRange: null,
    boundaries: { below: null, at: null, above: null },
  };
}

beforeEach(() => {
  solveReplacementIncomeThresholds.mockReset();
  mockUseAssetTracker.mockReturnValue({
    baseCurrency: "GBP",
    financialIndependence: { representativeAnnualExpenditure: 42_000 },
    solveReplacementIncomeThresholds,
  } as unknown as ReturnType<typeof useAssetTracker>);
});

describe("ReplacementIncomeThresholdPlanner", () => {
  it("submits edited goals and renders solved, manual, and impossible results", async () => {
    const user = userEvent.setup();
    solveReplacementIncomeThresholds.mockReturnValue([
      solvedResult(),
      manualResult(),
      impossibleResult(),
    ]);
    render(<ReplacementIncomeThresholdPlanner scenario={scenario} />);

    await user.selectOptions(
      screen.getByLabelText("Goal"),
      "preserve-cash-reserve",
    );
    await user.clear(screen.getByLabelText("Cash reserve"));
    await user.type(screen.getByLabelText("Cash reserve"), "15000");
    fireEvent.change(screen.getByLabelText("Forecast horizon, years"), {
      target: { value: "12" },
    });
    fireEvent.change(screen.getByLabelText("Job start 2"), {
      target: { value: "2026-07-01" },
    });
    await user.click(
      screen.getByRole("button", { name: "Calculate thresholds" }),
    );

    expect(solveReplacementIncomeThresholds).toHaveBeenCalledWith(
      expect.objectContaining({
        scenarioId: "offer",
        roleStartDates: ["2026-03-01", "2026-07-01", "2026-09-01"],
        goal: { kind: "preserve-cash-reserve", amount: 15_000 },
        horizonMonths: 144,
      }),
    );
    expect(screen.getByText("2026-27, rules 2026.10.4")).toBeVisible();
    expect(
      screen.getByText("Take-home only: No supported tax rules."),
    ).toBeVisible();
    expect(
      screen.getAllByText("Below fails; at passes; above passes."),
    ).toHaveLength(2);
    expect(
      screen.getByText("The goal is not met in the tested range."),
    ).toBeVisible();
    expect(
      screen.getByText(/Net redundancy 3000 GBP on 2026-02-15/),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Not converted")).toHaveLength(2);
    expect(screen.getAllByText("Unavailable").length).toBeGreaterThanOrEqual(3);
  });

  it("submits an FI target and reports solver errors", async () => {
    const user = userEvent.setup();
    solveReplacementIncomeThresholds.mockImplementationOnce(() => {
      throw new Error("Forecast failed");
    });
    render(<ReplacementIncomeThresholdPlanner scenario={scenario} />);

    await user.selectOptions(
      screen.getByLabelText("Goal"),
      "reach-financial-independence",
    );
    fireEvent.change(screen.getByLabelText("FI target date"), {
      target: { value: "2035-12-31" },
    });
    await user.click(
      screen.getByRole("button", { name: "Calculate thresholds" }),
    );

    expect(solveReplacementIncomeThresholds).toHaveBeenCalledWith(
      expect.objectContaining({
        goal: {
          kind: "reach-financial-independence",
          targetDate: "2035-12-31",
        },
      }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Forecast failed");

    solveReplacementIncomeThresholds.mockImplementationOnce(() => {
      throw "unknown failure";
    });
    await user.click(
      screen.getByRole("button", { name: "Calculate thresholds" }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not solve the threshold",
    );
  });
});
