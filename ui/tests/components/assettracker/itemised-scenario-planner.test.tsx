import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("preserves unsaved edits when recorded payments refresh", async () => {
    const scenario = {
      id: "event",
      name: "Large event",
      kind: "decision" as const,
      status: "considering" as const,
      labels: ["itemised-scenario"],
      currency: "GBP" as const,
      reversibility: "partly-reversible" as const,
      dependencyIds: [],
      alternativeToIds: [],
      stages: [
        {
          id: "venue",
          name: "Venue",
          fromAccountId: "current",
          expectedDate: "2027-10-08",
          minimumAmount: 2_000,
          expectedAmount: 2_000,
          maximumAmount: 2_000,
          actuals: [],
        },
      ],
    };
    const tracker = mockTracker({ futureCashFlows: [scenario] });
    const { rerender } = render(<ItemisedScenarioPlanner />);
    fireEvent.change(screen.getByRole("textbox", { name: "Scenario name" }), {
      target: { value: "Edited event" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Venue amount" }), {
      target: { value: "2500" },
    });

    mockUseAssetTracker.mockReturnValue({
      ...tracker,
      futureCashFlows: [
        {
          ...scenario,
          stages: [
            {
              ...scenario.stages[0],
              actuals: [
                {
                  id: "payment-1",
                  date: "2026-10-09",
                  amount: 500,
                  direction: "payment" as const,
                },
              ],
            },
          ],
        },
      ],
    } as ReturnType<typeof useAssetTracker>);
    rerender(<ItemisedScenarioPlanner />);

    expect(screen.getByRole("textbox", { name: "Scenario name" })).toHaveValue(
      "Edited event",
    );
    expect(
      screen.getByRole("spinbutton", { name: "Venue amount" }),
    ).toHaveValue(2500);
    await waitFor(() => expect(screen.getByText("£500")).toBeVisible());
  });

  it("resets the draft when New scenario is selected", async () => {
    mockTracker({
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
              id: "venue",
              name: "Venue",
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
    render(<ItemisedScenarioPlanner />);

    const scenarioSelect = document.querySelector("select");
    expect(scenarioSelect).not.toBeNull();
    if (scenarioSelect == null) return;
    fireEvent.change(scenarioSelect, { target: { value: "__new__" } });

    expect(screen.getByRole("textbox", { name: "Scenario name" })).toHaveValue(
      "",
    );
    expect(screen.getByRole("textbox", { name: "Cost 1 name" })).toHaveValue(
      "",
    );
  });
});
