import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { addMonths, format, parseISO } from "date-fns";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAssetTracker } from "@/components/assettracker/asset-tracker-provider";
import { JobMoveScenarioPlanner } from "@/components/assettracker/job-move-scenario-planner";
import { todayIsoDate } from "@/lib/assettracker";

vi.mock("@/components/assettracker/asset-tracker-provider", () => ({
  useAssetTracker: vi.fn(),
}));

const mockUseAssetTracker = vi.mocked(useAssetTracker);
const saveJobMoveScenario = vi.fn().mockResolvedValue(undefined);
const duplicateJobMoveScenario = vi.fn().mockResolvedValue(undefined);
const deleteJobMoveScenario = vi.fn().mockResolvedValue(undefined);

function trackerValue() {
  return {
    accountDetails: [
      {
        id: "current",
        name: "Current account",
        currency: "GBP",
        assetType: "cash",
        isOpen: true,
      },
      {
        id: "pension",
        name: "Workplace pension",
        currency: "GBP",
        assetType: "stocks",
        isOpen: true,
      },
    ],
    baseCurrency: "GBP",
    valuationDate: "2026-01-01",
    household: {
      members: [
        { id: "primary", displayName: "Alex" },
        { id: "partner", displayName: "Sam" },
      ],
      activeScope: { kind: "household" },
    },
    recurringFlowOwnership: {
      salary: { kind: "personal", memberId: "primary" },
      "partner-salary": { kind: "personal", memberId: "partner" },
    },
    recurringFlows: [
      {
        id: "salary",
        name: "Salary",
        toAccountId: "current",
        amount: 3_000,
        currency: "GBP",
        frequency: "monthly",
        startDate: "2025-01-01",
        compensationKind: "takeHomeIncome",
      },
      {
        id: "partner-salary",
        name: "Partner salary",
        toAccountId: "current",
        amount: 2_500,
        currency: "GBP",
        frequency: "monthly",
        startDate: "2025-01-01",
        compensationKind: "takeHomeIncome",
      },
    ],
    jobMoveScenarios: [
      {
        id: "offer",
        name: "Product lead offer",
        householdMemberId: "primary",
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
        annualTakeHomeOverride: 55_000,
        annualSpendingOverride: 42_000,
        destinationAccountId: "current",
        pensionAccountId: "pension",
        replacedRecurringFlowIds: ["salary"],
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ],
    compareJobMoveScenario: vi.fn().mockReturnValue({
      scenarioId: "offer",
      warnings: [],
      compensation: {
        baselineAnnualTakeHomePay: 36_000,
        baselineAnnualPensionContribution: 2_000,
        scenarioAnnualTakeHomePay: 48_000,
        scenarioAnnualEmployeePensionContribution: 4_250,
        scenarioAnnualEmployerPensionContribution: 4_250,
        currency: "GBP",
      },
      calculation: {
        kind: "tax-derived",
        taxYear: "2026-27",
        calculationVersion: "historical-salary-v1",
        ruleDatasetVersion: "2026.10.3",
      },
      timeline: [
        {
          date: "2026-01-01",
          baseline: {
            cashBalance: 12_000,
            totalBalance: 70_000,
            liquidBalance: 30_000,
            liquidMonths: 12,
            totalMonths: 28,
            emergencyFundBalance: 12_000,
            emergencyFundMonths: 6,
            spendingDrawdown: {
              cash: 0,
              liquid: 0,
              illiquid: 0,
              unfunded: 0,
            },
          },
          scenario: {
            cashBalance: 12_000,
            totalBalance: 70_000,
            liquidBalance: 30_000,
            liquidMonths: 12,
            totalMonths: 28,
            emergencyFundBalance: 12_000,
            emergencyFundMonths: 6,
            spendingDrawdown: {
              cash: 0,
              liquid: 0,
              illiquid: 0,
              unfunded: 0,
            },
          },
        },
        {
          date: "2031-01-01",
          baseline: {
            cashBalance: 30_000,
            totalBalance: 100_000,
            liquidBalance: 50_000,
            liquidMonths: 20,
            totalMonths: 40,
            emergencyFundBalance: 12_000,
            emergencyFundMonths: 6,
            spendingDrawdown: {
              cash: 2_000,
              liquid: 0,
              illiquid: 0,
              unfunded: 0,
            },
          },
          scenario: {
            cashBalance: 20_000,
            totalBalance: 130_000,
            liquidBalance: 60_000,
            liquidMonths: 24,
            totalMonths: 52,
            emergencyFundBalance: 16_000,
            emergencyFundMonths: 8,
            spendingDrawdown: {
              cash: 0,
              liquid: 0,
              illiquid: 0,
              unfunded: 0,
            },
          },
        },
      ],
      milestones: [
        {
          date: "2026-02-01",
          kind: "income-stops",
          label: "Current pay stops",
          detail: "Selected pay and pension flows stop from this date.",
        },
      ],
      financialIndependenceTarget: 120_000,
      financialIndependenceDates: {
        baseline: null,
        scenario: "2030-06-01",
      },
    }),
    saveJobMoveScenario,
    duplicateJobMoveScenario,
    deleteJobMoveScenario,
  } as unknown as ReturnType<typeof useAssetTracker>;
}

describe("JobMoveScenarioPlanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAssetTracker.mockReturnValue(trackerValue());
  });

  it("labels assumptions and compares compensation, net worth, runway, and FI", () => {
    render(<JobMoveScenarioPlanner />);

    expect(screen.getByText("Hypothetical")).toBeVisible();
    expect(screen.getByText("Monthly take-home")).toBeVisible();
    expect(screen.getByText("Annual pension")).toBeVisible();
    expect(screen.getByText("Net worth at horizon")).toBeVisible();
    expect(screen.getByText("Liquid assets at horizon")).toBeVisible();
    expect(screen.getByText("Total runway at horizon")).toBeVisible();
    expect(screen.getByText("Asset growth from the move")).toBeVisible();
    expect(screen.getByText("Additional liquid assets")).toBeVisible();
    expect(screen.getByText("Additional net worth")).toBeVisible();
    expect(screen.getByLabelText("Chart time window")).toHaveValue("full");
    expect(screen.getByRole("option", { name: "First 1 year" })).toBeVisible();
    expect(screen.getByRole("option", { name: "First 3 years" })).toBeVisible();
    expect(screen.getByText("FI path over time")).toBeVisible();
    expect(screen.getByText("Forecast milestones")).toBeVisible();
    expect(
      screen.getByText("Selected pay and pension flows stop from this date."),
    ).toBeVisible();
    expect(screen.getByText("Scenario 2030-06")).toBeVisible();
    expect(screen.getByText(/calculation historical-salary-v1/)).toBeVisible();
  });

  it("saves unemployment as an indefinite income stop", async () => {
    const user = userEvent.setup();
    render(<JobMoveScenarioPlanner />);

    await user.click(screen.getByRole("button", { name: "Add scenario" }));
    await user.type(screen.getByLabelText("Scenario name"), "Career break");
    await user.selectOptions(screen.getByLabelText("Outcome"), "unemployed");
    fireEvent.change(screen.getByLabelText("Current income stops from"), {
      target: { value: "2026-06-01" },
    });
    expect(
      screen.getByText(/Quitting, redundancy, and dismissal/),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Save scenario" }));

    await waitFor(() =>
      expect(saveJobMoveScenario).toHaveBeenCalledWith({
        id: undefined,
        scenario: expect.objectContaining({
          name: "Career break",
          householdMemberId: "primary",
          employmentStatus: "unemployed",
          transitionDate: "2026-06-01",
          roleStartDate: undefined,
          annualTakeHomeOverride: undefined,
          replacedRecurringFlowIds: ["salary"],
        }),
      }),
    );
  });

  it("replaces only the selected household member's job flows", async () => {
    const user = userEvent.setup();
    render(<JobMoveScenarioPlanner />);

    await user.click(screen.getByRole("button", { name: "Add scenario" }));
    await user.selectOptions(
      screen.getByLabelText("Whose employment changes?"),
      "partner",
    );
    expect(
      screen.getByRole("checkbox", { name: /Partner salary · Sam/ }),
    ).toBeChecked();
    expect(
      screen.queryByRole("checkbox", { name: /^Salary · Alex/ }),
    ).toBeNull();

    await user.type(screen.getByLabelText("Scenario name"), "Sam job loss");
    await user.selectOptions(screen.getByLabelText("Outcome"), "unemployed");
    await user.click(screen.getByRole("button", { name: "Save scenario" }));

    await waitFor(() =>
      expect(saveJobMoveScenario).toHaveBeenCalledWith({
        id: undefined,
        scenario: expect.objectContaining({
          householdMemberId: "partner",
          replacedRecurringFlowIds: ["partner-salary"],
        }),
      }),
    );
  });

  it("edits every prospective-role input and saves the revised assumption", async () => {
    const user = userEvent.setup();
    render(<JobMoveScenarioPlanner />);

    await user.click(
      screen.getByRole("button", { name: "Edit Product lead offer" }),
    );
    fireEvent.change(screen.getByLabelText("Scenario name"), {
      target: { value: "Revised offer" },
    });
    fireEvent.change(screen.getByLabelText("Current income stops from"), {
      target: { value: "2026-04-01" },
    });
    fireEvent.change(screen.getByLabelText("Annual spending in scenario"), {
      target: { value: "50000" },
    });
    fireEvent.change(screen.getByLabelText("New role starts"), {
      target: { value: "2026-05-01" },
    });
    fireEvent.change(screen.getByLabelText("Prospective employer"), {
      target: { value: "Revised Ltd" },
    });
    fireEvent.change(screen.getByLabelText("Annual base gross"), {
      target: { value: "90000" },
    });
    fireEvent.change(screen.getByLabelText("Expected annual variable gross"), {
      target: { value: "10000" },
    });
    await user.selectOptions(screen.getByLabelText("Pay frequency"), "annual");
    await user.selectOptions(screen.getByLabelText("Currency"), "USD");
    fireEvent.change(screen.getByLabelText("Tax jurisdiction"), {
      target: { value: "United States" },
    });
    fireEvent.change(screen.getByLabelText("Employee pension rate (%)"), {
      target: { value: "6" },
    });
    await user.selectOptions(
      screen.getByLabelText("Employee pension method"),
      "netPay",
    );
    fireEvent.change(screen.getByLabelText("Employer pension rate (%)"), {
      target: { value: "7.5" },
    });
    fireEvent.change(screen.getByLabelText("Annual take-home override"), {
      target: { value: "60000" },
    });
    await user.selectOptions(
      screen.getByLabelText("Take-home account"),
      "pension",
    );
    await user.selectOptions(
      screen.getByLabelText("Pension account"),
      "current",
    );
    await user.click(screen.getByRole("checkbox", { name: /Salary/ }));
    await user.click(screen.getByRole("checkbox", { name: /Salary/ }));
    const form = screen
      .getByRole("button", { name: "Save scenario" })
      .closest("form");
    expect(
      Array.from(form?.querySelectorAll(":invalid") ?? []).map(
        (element) => element.id,
      ),
    ).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Save scenario" }));

    await waitFor(() =>
      expect(saveJobMoveScenario).toHaveBeenCalledWith({
        id: "offer",
        scenario: expect.objectContaining({
          name: "Revised offer",
          transitionDate: "2026-04-01",
          roleStartDate: "2026-05-01",
          baseGrossPay: 90_000,
          variableGrossPay: 10_000,
          payFrequency: "annual",
          currency: "USD",
          employeePensionRate: 0.06,
          employeePensionMethod: "netPay",
          employerPensionRate: 0.075,
          annualTakeHomeOverride: 60_000,
          annualSpendingOverride: 50_000,
          destinationAccountId: "pension",
          pensionAccountId: "current",
          replacedRecurringFlowIds: ["salary"],
        }),
      }),
    );
  });

  it("duplicates, deletes, cancels, and reports action failures", async () => {
    const user = userEvent.setup();
    duplicateJobMoveScenario.mockRejectedValueOnce(
      new Error("Duplicate failed"),
    );
    render(<JobMoveScenarioPlanner />);

    await user.click(
      screen.getByRole("button", { name: "Duplicate Product lead offer" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Something went wrong",
    );

    await user.click(
      screen.getByRole("button", { name: "Delete Product lead offer" }),
    );
    await waitFor(() =>
      expect(deleteJobMoveScenario).toHaveBeenCalledWith("offer"),
    );

    await user.click(screen.getByRole("button", { name: "Add scenario" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Scenario name")).toBeNull();
  });

  it("shows a job-loss default when no scenarios have been saved", () => {
    mockUseAssetTracker.mockReturnValue({
      ...trackerValue(),
      jobMoveScenarios: [],
    });

    render(<JobMoveScenarioPlanner />);

    expect(screen.getByText("Lose my job")).toBeVisible();
    expect(screen.getByText("Default scenario")).toBeVisible();
    expect(screen.getByText("Baseline comparison")).toBeVisible();
    expect(screen.getByLabelText("Expected job loss date")).toHaveValue(
      format(addMonths(parseISO(todayIsoDate()), 1), "yyyy-MM-dd"),
    );
    expect(
      screen.getByRole("button", { name: "Compare 1 month vs 3 months" }),
    ).toBeVisible();
  });
});
