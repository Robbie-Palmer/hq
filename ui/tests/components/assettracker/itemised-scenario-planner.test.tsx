import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { useAssetTracker } from "@/components/assettracker/asset-tracker-provider";
import { ItemisedScenarioPlanner } from "@/components/assettracker/itemised-scenario-planner";

vi.mock("@/components/assettracker/asset-tracker-provider", () => ({
  useAssetTracker: vi.fn(),
}));

const mockUseAssetTracker = vi.mocked(useAssetTracker);
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
  latestSnapshotDate: "2026-10-01",
  cagr: null,
};

function mockTracker(
  overrides: Partial<ReturnType<typeof useAssetTracker>> = {},
) {
  const tracker = {
    accounts: [currentAccount],
    futureCashFlows: [],
    baseCurrency: "GBP",
    addCashFlowDecision: vi.fn(),
    updateCashFlowDecision: vi.fn(),
    ...overrides,
  } as unknown as ReturnType<typeof useAssetTracker>;
  mockUseAssetTracker.mockReturnValue(tracker);
  return tracker;
}

describe("ItemisedScenarioPlanner", () => {
  it("creates a scenario from user-entered cost rows", async () => {
    const tracker = mockTracker();
    const user = userEvent.setup();
    render(<ItemisedScenarioPlanner />);

    await user.type(
      screen.getByRole("textbox", { name: "Scenario name" }),
      "Wedding",
    );
    await user.type(
      screen.getByRole("textbox", { name: "Cost 1 name" }),
      "Venue",
    );
    await user.type(
      screen.getByRole("spinbutton", { name: "Venue amount" }),
      "12000",
    );
    await user.click(screen.getByRole("button", { name: "Add cost" }));
    await user.type(
      screen.getByRole("textbox", { name: "Cost 2 name" }),
      "Suit",
    );
    await user.type(
      screen.getByRole("spinbutton", { name: "Suit amount" }),
      "1000",
    );
    await user.click(screen.getByRole("button", { name: "Add scenario" }));

    expect(tracker.addCashFlowDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Wedding",
        labels: ["itemised-scenario"],
        currency: "GBP",
        stages: [
          expect.objectContaining({ name: "Venue", expectedAmount: 12_000 }),
          expect.objectContaining({ name: "Suit", expectedAmount: 1_000 }),
        ],
      }),
    );
  });

  it("saves edits to an existing itemised scenario", async () => {
    const tracker = mockTracker({
      futureCashFlows: [
        {
          id: "wedding",
          name: "Wedding",
          kind: "decision",
          status: "considering",
          labels: ["itemised-scenario"],
          currency: "GBP",
          reversibility: "partly-reversible",
          dependencyIds: [],
          alternativeToIds: [],
          stages: [
            {
              id: "cash-flow-1",
              name: "Venue",
              fromAccountId: "current",
              expectedDate: "2027-10-08",
              minimumAmount: 10_000,
              expectedAmount: 10_000,
              maximumAmount: 10_000,
              actuals: [],
            },
          ],
        },
      ],
    });
    render(<ItemisedScenarioPlanner />);

    fireEvent.change(screen.getByRole("spinbutton", { name: "Venue amount" }), {
      target: { value: "9500" },
    });
    await userEvent.click(
      screen.getByRole("button", { name: "Save scenario" }),
    );

    expect(tracker.updateCashFlowDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "wedding",
        stages: [
          expect.objectContaining({
            id: "cash-flow-1",
            name: "Venue",
            expectedAmount: 9_500,
          }),
        ],
      }),
    );
  });

  it("records a payment against one cost", async () => {
    const recordActualCashFlow = vi.fn();
    mockTracker({
      recordActualCashFlow,
      futureCashFlows: [
        {
          id: "event",
          name: "Large event",
          kind: "decision",
          status: "considering",
          labels: ["itemised-scenario"],
          currency: "GBP",
          reversibility: "partly-reversible",
          dependencyIds: [],
          alternativeToIds: [],
          stages: [
            {
              id: "deposit",
              name: "Venue deposit",
              fromAccountId: "current",
              expectedDate: "2027-10-08",
              minimumAmount: 2_000,
              expectedAmount: 2_000,
              maximumAmount: 2_000,
              actuals: [],
            },
          ],
        },
      ],
    });
    const user = userEvent.setup();
    render(<ItemisedScenarioPlanner />);

    await user.click(screen.getByRole("button", { name: "Record payment" }));
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "Venue deposit payment amount" }),
      { target: { value: "500" } },
    );
    await user.click(screen.getByRole("button", { name: "Save payment" }));

    expect(recordActualCashFlow).toHaveBeenCalledWith({
      futureCashFlowId: "event",
      stageId: "deposit",
      date: expect.any(String),
      amount: 500,
      direction: "payment",
    });
  });
});
