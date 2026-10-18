import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { useAssetTracker } from "@/components/assettracker/asset-tracker-provider";
import { DecisionsRoute } from "@/components/assettracker/decisions-route";
import type { TrackedFinancialDecisionRecord } from "@/lib/domain/assettracker";

vi.mock("@/components/assettracker/asset-tracker-provider", () => ({
  useAssetTracker: vi.fn(),
}));
vi.mock("@/components/assettracker/decision-scenario-comparison", () => ({
  DecisionScenarioComparison: () => <div>Decision comparison workspace</div>,
}));
vi.mock("@/components/assettracker/forecast-assumption-manager", () => ({
  ForecastAssumptionManager: () => <div>Forecast assumptions workspace</div>,
}));
vi.mock("@/components/assettracker/future-cash-flow-manager", () => ({
  FutureCashFlowManager: () => <div>Future cash flow workspace</div>,
}));
vi.mock("@/components/assettracker/job-move-scenario-planner", () => ({
  JobMoveScenarioPlanner: () => <div>Job move workspace</div>,
}));
vi.mock("@/components/assettracker/itemised-scenario-planner", () => ({
  ItemisedScenarioPlanner: () => <div>Scenario workspace</div>,
}));

const mockUseAssetTracker = vi.mocked(useAssetTracker);

function trackedDecision(
  observations: TrackedFinancialDecisionRecord["observations"] = [],
  interpretations: TrackedFinancialDecisionRecord["interpretations"] = [],
): TrackedFinancialDecisionRecord {
  return {
    id: "invest-decision",
    kind: "tracked",
    question: "Should we invest the cash reserve?",
    decisionDate: "2026-01-01",
    selectedScenario: { id: "invest", label: "Invest £10,000" },
    rationale: "Six months of cash remain available.",
    action: "Invest £10,000.",
    forecast: {
      capturedAt: "2026-01-01T12:00:00.000Z",
      calculationVersion: "portfolio-v1",
      lineage: [
        {
          id: "fact",
          kind: "financial-fact",
          label: "Cash",
          value: "£30,000",
          source: "Bank statement",
          validAt: "2026-01-01",
        },
        {
          id: "rate",
          kind: "rate",
          label: "Return",
          value: "5%",
          source: "Planning policy",
          validAt: "2026-01-01",
        },
        {
          id: "tax",
          kind: "tax-rule",
          label: "ISA allowance",
          value: "£20,000",
          source: "HMRC",
          validAt: "2026-01-01",
        },
        {
          id: "assumption",
          kind: "assumption",
          label: "Contributions",
          value: "£500 monthly",
          source: "Household plan",
          validAt: "2026-01-01",
        },
      ],
      checkpoints: [
        {
          id: "year-one",
          label: "Portfolio after one year",
          dueDate: "2027-01-01",
          expectedAmount: 16_650,
          currency: "GBP",
        },
      ],
    },
    observations,
    interpretations,
  };
}

describe("DecisionsRoute", () => {
  it("opens with the job-move workspace", () => {
    mockUseAssetTracker.mockReturnValue({
      accountDetails: [],
      baseCurrency: "GBP",
      decisionRecords: [],
      mortgageScenarios: [],
    } as unknown as ReturnType<typeof useAssetTracker>);

    render(<DecisionsRoute />);

    expect(screen.getByText("Job move workspace")).toBeVisible();
  });

  it.each([
    ["Recorded", "No decision records yet"],
    ["Job moves", "Job move workspace"],
    ["Scenarios", "Scenario workspace"],
  ])("opens the %s workspace", async (tab, expectedText) => {
    mockUseAssetTracker.mockReturnValue({
      accountDetails: [],
      baseCurrency: "GBP",
      decisionRecords: [],
      mortgageScenarios: [],
    } as unknown as ReturnType<typeof useAssetTracker>);

    render(<DecisionsRoute />);
    await userEvent.click(screen.getByRole("tab", { name: tab }));

    expect(screen.getByText(expectedText)).toBeVisible();
  });

  it("shows a mortgage decision with its linked source facts", async () => {
    mockUseAssetTracker.mockReturnValue({
      accountDetails: [
        { id: "mortgage", name: "Home loan" },
        { id: "property", name: "Main home" },
      ],
      baseCurrency: "GBP",
      decisionRecords: [
        {
          id: "fix-decision",
          kind: "mortgage",
          title: "Five-year fix",
          scenarioId: "fix",
          recordedAt: "2026-06-15",
          status: "recorded",
        },
      ],
      mortgageScenarios: [
        {
          id: "fix",
          name: "Five-year fix",
          createdAt: "2026-06-15",
          decisionRecordId: "fix-decision",
          source: {
            mortgageAccountId: "mortgage",
            propertyAccountId: "property",
            snapshotDate: "2026-05-31",
          },
          assumptions: {
            purchasePrice: 300_000,
            availableFunds: 100_000,
            depositAmount: 75_000,
            initialAnnualRate: 0.04,
            termMonths: 240,
            repaymentType: "repayment",
            firstPaymentDate: "2026-07-01",
            followOnAnnualRate: 0.06,
            refinanceFee: 0,
            purchaseFees: 0,
            taxes: 0,
            transactionCosts: 0,
            monthlyOverpayment: 0,
            overpaymentAllowance: 10_000,
            overpaymentChargeRate: 0.05,
          },
        },
      ],
    } as unknown as ReturnType<typeof useAssetTracker>);

    render(<DecisionsRoute />);
    await userEvent.click(screen.getByRole("tab", { name: "Recorded" }));

    expect(screen.getByText("Five-year fix")).toBeVisible();
    expect(screen.getByText("£300,000")).toBeVisible();
    expect(
      screen.getByText("Based on Home loan and Main home at 2026-05-31."),
    ).toBeVisible();
  });

  it("shows frozen lineage and the largest reconciliation sources", async () => {
    mockUseAssetTracker.mockReturnValue({
      accountDetails: [],
      baseCurrency: "EUR",
      createDecisionRecord: vi.fn(),
      recordDecisionObservation: vi.fn(),
      addDecisionInterpretation: vi.fn(),
      decisionRecords: [
        trackedDecision([
          {
            id: "year-one-observation",
            checkpointId: "year-one",
            observedAt: "2027-01-02T12:00:00.000Z",
            actualAmount: 15_300,
            note: "One contribution was missed.",
            divergenceSources: [
              {
                kind: "changed-reality",
                label: "Missed contribution",
                impactAmount: -500,
              },
              {
                kind: "changed-assumption",
                label: "Market return",
                impactAmount: -850,
              },
            ],
          },
        ]),
      ],
      mortgageScenarios: [],
    } as unknown as ReturnType<typeof useAssetTracker>);

    render(<DecisionsRoute />);
    await userEvent.click(screen.getByRole("tab", { name: "Recorded" }));
    await userEvent.click(
      screen.getByText("Frozen forecast lineage", { selector: "summary" }),
    );

    const article = screen
      .getByText("Should we invest the cash reserve?")
      .closest("article");
    expect(article).not.toBeNull();
    expect(article).toHaveTextContent("Calculation version portfolio-v1.");
    expect(article).toHaveTextContent("Expected £16,650");
    expect(article).toHaveTextContent("Actual £15,300");
    expect(article).toHaveTextContent(
      "Changed assumption: Market return (-£850)",
    );
    expect(article).toHaveTextContent(
      "Changed reality: Missed contribution (-£500)",
    );
  });

  it("shows invalid observation amounts and clears the error on edit", async () => {
    const recordDecisionObservation = vi.fn().mockResolvedValue(undefined);
    mockUseAssetTracker.mockReturnValue({
      accountDetails: [],
      baseCurrency: "EUR",
      createDecisionRecord: vi.fn(),
      recordDecisionObservation,
      addDecisionInterpretation: vi.fn(),
      decisionRecords: [trackedDecision()],
      mortgageScenarios: [],
    } as unknown as ReturnType<typeof useAssetTracker>);
    const user = userEvent.setup();

    render(<DecisionsRoute />);
    await user.click(screen.getByRole("tab", { name: "Recorded" }));
    await user.type(screen.getByLabelText("Actual amount"), "15,300");
    await user.type(screen.getByLabelText("What happened"), "On plan");
    await user.click(screen.getByRole("button", { name: "Record checkpoint" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Actual amount must be a valid number.",
    );
    expect(recordDecisionObservation).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText("Actual amount"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Actual amount"), "15300");
    await user.click(screen.getByRole("button", { name: "Record checkpoint" }));

    expect(recordDecisionObservation).toHaveBeenCalledWith(
      expect.objectContaining({ actualAmount: 15_300 }),
    );
  });

  it("creates a decision with frozen lineage and a checkpoint", async () => {
    const createDecisionRecord = vi.fn().mockResolvedValue(undefined);
    mockUseAssetTracker.mockReturnValue({
      accountDetails: [],
      baseCurrency: "GBP",
      createDecisionRecord,
      decisionRecords: [],
      mortgageScenarios: [],
    } as unknown as ReturnType<typeof useAssetTracker>);
    const user = userEvent.setup();

    render(<DecisionsRoute />);
    await user.click(screen.getByRole("tab", { name: "Recorded" }));
    await user.click(
      screen.getByText("Record a decision", { selector: "summary" }),
    );
    const values = [
      ["Question", "Should we invest the cash reserve?"],
      ["Selected scenario", "Invest £10,000"],
      ["Action taken", "Invest £10,000 in the index fund"],
      ["Household-visible rationale", "The emergency fund remains funded"],
      ["First checkpoint", "Portfolio after one year"],
      ["Expected amount (GBP)", "16650"],
      ["Financial facts", "£30,000 cash"],
      ["Rates", "5% expected return"],
      ["Tax rules", "£20,000 ISA allowance"],
      ["Assumptions", "£500 monthly contributions"],
      ["Source reference", "October planning pack"],
      ["Calculation version", "portfolio-v1"],
    ] as const;
    for (const [label, value] of values) {
      await user.type(screen.getByLabelText(label), value);
    }
    await user.click(
      screen.getByRole("button", { name: "Freeze decision forecast" }),
    );

    expect(createDecisionRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        question: "Should we invest the cash reserve?",
        selectedScenario: expect.objectContaining({ label: "Invest £10,000" }),
        forecast: expect.objectContaining({
          calculationVersion: "portfolio-v1",
          lineage: expect.arrayContaining([
            expect.objectContaining({
              kind: "tax-rule",
              value: "£20,000 ISA allowance",
            }),
          ]),
          checkpoints: [
            expect.objectContaining({
              expectedAmount: 16_650,
              currency: "GBP",
            }),
          ],
        }),
      }),
    );
  });

  it("appends an observation and a corrected interpretation", async () => {
    const recordDecisionObservation = vi.fn().mockResolvedValue(undefined);
    const addDecisionInterpretation = vi.fn().mockResolvedValue(undefined);
    mockUseAssetTracker.mockReturnValue({
      accountDetails: [],
      baseCurrency: "GBP",
      createDecisionRecord: vi.fn(),
      recordDecisionObservation,
      addDecisionInterpretation,
      decisionRecords: [
        trackedDecision(
          [],
          [
            {
              id: "earlier-interpretation",
              createdAt: "2026-06-01T12:00:00.000Z",
              reason: "Updated contribution plan",
              revisedRationale: "The lower contribution remains affordable.",
              assumptionChanges: [
                {
                  label: "Monthly contribution",
                  previousValue: "£500",
                  revisedValue: "£400",
                },
              ],
            },
          ],
        ),
      ],
      mortgageScenarios: [],
    } as unknown as ReturnType<typeof useAssetTracker>);
    const user = userEvent.setup();

    render(<DecisionsRoute />);
    await user.click(screen.getByRole("tab", { name: "Recorded" }));
    await user.type(screen.getByLabelText("Actual amount"), "15300");
    await user.type(
      screen.getByLabelText("What happened"),
      "One contribution was missed",
    );
    await user.type(
      screen.getByLabelText("Changed assumption"),
      "Market return",
    );
    await user.type(screen.getByLabelText("Assumption impact"), "-850");
    await user.type(
      screen.getByLabelText("Changed reality"),
      "Missed contribution",
    );
    await user.type(screen.getByLabelText("Reality impact"), "-500");
    await user.click(screen.getByRole("button", { name: "Record checkpoint" }));
    await user.click(
      screen.getByText("Add corrected interpretation", { selector: "summary" }),
    );
    await user.type(
      screen.getByLabelText("Reason for correction"),
      "Contribution plan changed",
    );
    await user.clear(screen.getByLabelText("Revised rationale"));
    await user.type(
      screen.getByLabelText("Revised rationale"),
      "Investing remains affordable",
    );
    await user.type(
      screen.getByLabelText("Assumption"),
      "Monthly contribution",
    );
    await user.type(screen.getByLabelText("Value known then"), "£500");
    await user.type(screen.getByLabelText("Corrected value"), "£400");
    await user.click(
      screen.getByRole("button", { name: "Save interpretation" }),
    );

    expect(recordDecisionObservation).toHaveBeenCalledWith({
      decisionId: "invest-decision",
      checkpointId: "year-one",
      actualAmount: 15_300,
      note: "One contribution was missed",
      divergenceSources: [
        {
          kind: "changed-assumption",
          label: "Market return",
          impactAmount: -850,
        },
        {
          kind: "changed-reality",
          label: "Missed contribution",
          impactAmount: -500,
        },
      ],
    });
    expect(addDecisionInterpretation).toHaveBeenCalledWith({
      decisionId: "invest-decision",
      reason: "Contribution plan changed",
      revisedRationale: "Investing remains affordable",
      assumptionChanges: [
        {
          label: "Monthly contribution",
          previousValue: "£500",
          revisedValue: "£400",
        },
      ],
    });
    expect(screen.getByText("Updated contribution plan")).toBeVisible();
  });
});
