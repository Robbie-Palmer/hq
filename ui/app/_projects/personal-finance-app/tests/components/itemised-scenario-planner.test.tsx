import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { useAssetTracker } from "@/app/_projects/personal-finance-app/components/asset-tracker-provider";
import { ItemisedScenarioPlanner } from "@/app/_projects/personal-finance-app/components/itemised-scenario-planner";

vi.mock(
  "@/app/_projects/personal-finance-app/components/asset-tracker-provider",
  () => ({
    useAssetTracker: vi.fn(),
  }),
);

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
const investmentAccount = {
  ...currentAccount,
  id: "investment",
  name: "Stocks & Shares ISA",
  assetType: "stocks" as const,
  liquidity: "liquid" as const,
  latestBalance: 50_000,
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
      screen.getByRole("textbox", { name: "Cost group 1 name" }),
      "Venue",
    );
    await user.type(
      screen.getByRole("textbox", { name: "Cost 1 name" }),
      "Venue balance",
    );
    await user.type(
      screen.getByRole("spinbutton", { name: "Venue balance amount" }),
      "12000",
    );
    await user.click(
      screen.getByRole("button", { name: "Add scheduled cost" }),
    );
    await user.type(
      screen.getByRole("textbox", { name: "Cost group 2 name" }),
      "Suit",
    );
    await user.type(
      screen.getByRole("textbox", { name: "Cost 2 name" }),
      "Suit",
    );
    await user.type(
      screen.getByRole("spinbutton", { name: "Suit amount" }),
      "1000",
    );
    await user.click(
      screen.getByRole("button", { name: "Add cost with missing details" }),
    );
    await user.type(
      screen.getByRole("textbox", { name: "Cost group 3 name" }),
      "Rings",
    );
    await user.type(
      screen.getByRole("textbox", { name: "Rings unresolved cost name" }),
      "Rings total",
    );
    await user.click(screen.getByRole("button", { name: "Add scenario" }));

    expect(tracker.addCashFlowDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Wedding",
        labels: ["itemised-scenario"],
        currency: "GBP",
        groups: [
          expect.objectContaining({ name: "Venue", status: "considering" }),
          expect.objectContaining({ name: "Suit", status: "considering" }),
          expect.objectContaining({
            name: "Rings",
            status: "considering",
            unresolvedCosts: [expect.objectContaining({ name: "Rings total" })],
          }),
        ],
        stages: [
          expect.objectContaining({
            name: "Venue balance",
            expectedAmount: 12_000,
            groupId: "cost-group-1",
          }),
          expect.objectContaining({ name: "Suit", expectedAmount: 1_000 }),
        ],
      }),
    );
  }, 15_000);

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
              direction: "payment",
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

  it("assigns individual payments to their expected funding accounts", async () => {
    const tracker = mockTracker({
      accounts: [currentAccount, investmentAccount],
      futureCashFlows: [
        {
          id: "wedding",
          name: "Wedding",
          kind: "decision",
          status: "selected",
          labels: ["itemised-scenario"],
          currency: "GBP",
          reversibility: "partly-reversible",
          dependencyIds: [],
          alternativeToIds: [],
          groups: [{ id: "venue", name: "Venue", status: "committed" }],
          stages: [
            {
              id: "venue-balance",
              groupId: "venue",
              name: "Venue balance",
              direction: "payment",
              fromAccountId: "current",
              expectedDate: "2027-05-24",
              minimumAmount: 2_225,
              expectedAmount: 2_225,
              maximumAmount: 2_225,
              actuals: [],
            },
          ],
        },
      ],
    });
    const user = userEvent.setup();
    render(<ItemisedScenarioPlanner />);

    const fundingTrigger = screen.getByRole("combobox", {
      name: "Venue balance pay from",
    });
    const fundingSelect = fundingTrigger.nextElementSibling;
    expect(fundingSelect).toBeInstanceOf(HTMLSelectElement);
    if (!(fundingSelect instanceof HTMLSelectElement)) return;
    fireEvent.change(fundingSelect, { target: { value: "investment" } });
    await user.click(screen.getByRole("button", { name: "Save scenario" }));

    expect(tracker.updateCashFlowDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        stages: [
          expect.objectContaining({
            id: "venue-balance",
            fromAccountId: "investment",
          }),
        ],
      }),
    );
  });

  it("groups legacy payment stages and persists their commitment status", async () => {
    const tracker = mockTracker({
      futureCashFlows: [
        {
          id: "wedding",
          name: "Wedding",
          kind: "decision",
          status: "selected",
          labels: ["itemised-scenario"],
          currency: "GBP",
          reversibility: "partly-reversible",
          dependencyIds: [],
          alternativeToIds: [],
          stages: [
            {
              id: "venue-deposit",
              name: "Venue deposit",
              direction: "payment",
              fromAccountId: "current",
              expectedDate: "2026-05-08",
              minimumAmount: 750,
              expectedAmount: 750,
              maximumAmount: 750,
              actuals: [
                {
                  id: "paid-deposit",
                  date: "2026-05-08",
                  amount: 750,
                  direction: "payment",
                },
              ],
            },
            {
              id: "venue-balance",
              name: "Venue final instalment",
              direction: "payment",
              fromAccountId: "current",
              expectedDate: "2027-05-24",
              minimumAmount: 2_225,
              expectedAmount: 2_225,
              maximumAmount: 2_225,
              actuals: [],
            },
            {
              id: "flowers",
              name: "Flowers",
              direction: "payment",
              fromAccountId: "current",
              expectedDate: "2027-05-24",
              minimumAmount: 500,
              expectedAmount: 500,
              maximumAmount: 500,
              actuals: [],
            },
          ],
        },
      ],
    });
    render(<ItemisedScenarioPlanner />);

    expect(
      screen.getByRole("textbox", { name: "Cost group 1 name" }),
    ).toHaveValue("Venue");
    expect(screen.getByText("2 payments")).toBeVisible();
    expect(
      screen.getByRole("combobox", { name: "Venue status" }),
    ).toHaveTextContent("Committed");
    expect(
      screen.getByRole("img", {
        name: "Scenario costs by due date and commitment status",
      }),
    ).toBeVisible();

    await userEvent.click(
      screen.getByRole("button", { name: "Save scenario" }),
    );

    expect(tracker.updateCashFlowDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        groups: [
          { id: "venue", name: "Venue", status: "committed" },
          { id: "flowers", name: "Flowers", status: "considering" },
        ],
        stages: [
          expect.objectContaining({ groupId: "venue" }),
          expect.objectContaining({ groupId: "venue" }),
          expect.objectContaining({ groupId: "flowers" }),
        ],
      }),
    );
  });

  it("keeps costs with unknown prices or dates explicit", async () => {
    const tracker = mockTracker({
      futureCashFlows: [
        {
          id: "wedding",
          name: "Wedding",
          kind: "decision",
          status: "selected",
          labels: ["itemised-scenario"],
          currency: "GBP",
          reversibility: "partly-reversible",
          dependencyIds: [],
          alternativeToIds: [],
          groups: [
            {
              id: "hairstylist",
              name: "Hairstylist",
              status: "committed",
              unresolvedCosts: [
                { id: "balance", name: "Balance", amount: 460 },
                { id: "extras", name: "Extras" },
              ],
            },
          ],
          stages: [
            {
              id: "deposit",
              groupId: "hairstylist",
              name: "Hairstylist deposit",
              direction: "payment",
              fromAccountId: "current",
              expectedDate: "2026-07-26",
              minimumAmount: 60,
              expectedAmount: 60,
              maximumAmount: 60,
              actuals: [
                {
                  id: "paid-deposit",
                  date: "2026-07-26",
                  amount: 60,
                  direction: "payment",
                },
              ],
            },
          ],
        },
      ],
    });
    render(<ItemisedScenarioPlanner />);

    expect(screen.getByDisplayValue("Balance")).toBeVisible();
    expect(screen.getByDisplayValue("460")).toBeVisible();
    expect(
      screen.getByLabelText("Hairstylist deposit final amount"),
    ).toHaveTextContent("£60Final");
    expect(
      screen.queryByRole("spinbutton", {
        name: "Hairstylist deposit amount",
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Record payment" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Paid in full")).toBeVisible();
    expect(screen.getByText("Price needed")).toBeVisible();
    expect(screen.getAllByText("Date needed")).toHaveLength(2);
    expect(
      screen.getByText(/1 cost needs a price · 2 costs need a due date/),
    ).toBeVisible();
    expect(screen.getAllByText("£520")).not.toHaveLength(0);

    await userEvent.click(
      screen.getByRole("button", { name: "Save scenario" }),
    );

    expect(tracker.updateCashFlowDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        groups: [
          expect.objectContaining({
            id: "hairstylist",
            unresolvedCosts: [
              { id: "balance", name: "Balance", amount: 460 },
              { id: "extras", name: "Extras" },
            ],
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
              direction: "payment",
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
          direction: "payment" as const,
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
    await waitFor(() =>
      expect(screen.getAllByText("£500").length).toBeGreaterThan(0),
    );
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
              direction: "payment",
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
