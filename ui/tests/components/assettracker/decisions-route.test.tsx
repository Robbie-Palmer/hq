import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { useAssetTracker } from "@/components/assettracker/asset-tracker-provider";
import { DecisionsRoute } from "@/components/assettracker/decisions-route";

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

const mockUseAssetTracker = vi.mocked(useAssetTracker);

describe("DecisionsRoute", () => {
  it("opens with the comparison workspace", () => {
    mockUseAssetTracker.mockReturnValue({
      accountDetails: [],
      baseCurrency: "GBP",
      decisionRecords: [],
      mortgageScenarios: [],
    } as unknown as ReturnType<typeof useAssetTracker>);

    render(<DecisionsRoute />);

    expect(screen.getByText("Decision comparison workspace")).toBeVisible();
  });

  it("explains how to create the first decision record", async () => {
    mockUseAssetTracker.mockReturnValue({
      accountDetails: [],
      baseCurrency: "GBP",
      decisionRecords: [],
      mortgageScenarios: [],
    } as unknown as ReturnType<typeof useAssetTracker>);

    render(<DecisionsRoute />);
    await userEvent.click(screen.getByRole("tab", { name: "Recorded" }));

    expect(screen.getByText("No decision records yet")).toBeVisible();
  });

  it("opens the job-move workspace", async () => {
    mockUseAssetTracker.mockReturnValue({
      accountDetails: [],
      baseCurrency: "GBP",
      decisionRecords: [],
      mortgageScenarios: [],
    } as unknown as ReturnType<typeof useAssetTracker>);

    render(<DecisionsRoute />);
    await userEvent.click(screen.getByRole("tab", { name: "Job moves" }));

    expect(screen.getByText("Job move workspace")).toBeVisible();
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
});
