import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAssetTracker } from "@/app/_projects/personal-finance-app/components/asset-tracker-provider";
import { CompoundGrowthPlanner } from "@/app/_projects/personal-finance-app/components/compound-growth-planner";
import type { AccountDetailView } from "@/app/_projects/personal-finance-app/domain";

vi.mock(
  "@/app/_projects/personal-finance-app/components/asset-tracker-provider",
  () => ({ useAssetTracker: vi.fn() }),
);

const mockUseAssetTracker = vi.mocked(useAssetTracker);

const linkedAccount: AccountDetailView = {
  id: "stocks-isa",
  name: "Stocks ISA",
  provider: "Provider",
  currency: "GBP",
  assetType: "stocks",
  taxWrapper: "isa",
  expectedAnnualReturn: 0.06,
  isOpen: true,
  latestBalance: 25_000,
  latestSnapshotDate: "2026-10-01",
  cagr: null,
  createdAt: "2020-01-01",
  snapshots: [],
  capitalFlows: [],
  netContributed: null,
  gainLoss: null,
};

describe("CompoundGrowthPlanner", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockUseAssetTracker.mockReturnValue({
      accountDetails: [linkedAccount],
      baseCurrency: "GBP",
    } as ReturnType<typeof useAssetTracker>);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("links household balances and persists editable assumptions", async () => {
    render(<CompoundGrowthPlanner />);

    expect(
      screen.getByRole("heading", {
        name: "Contribution and compound growth planner",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("table", { name: "Annual compound growth calculation" }),
    ).toBeVisible();
    expect(
      screen.getByRole("img", {
        name: "Projected nominal balance and inflation-adjusted purchasing power",
      }),
    ).toBeVisible();

    fireEvent.click(screen.getByLabelText(/Stocks ISA/));
    fireEvent.change(screen.getByLabelText("Scenario name"), {
      target: { value: "Household ISA plan" },
    });
    fireEvent.change(screen.getByLabelText("Start date"), {
      target: { value: "2027-04-06" },
    });
    fireEvent.change(screen.getByLabelText("Standalone principal"), {
      target: { value: "15000" },
    });
    fireEvent.change(screen.getByLabelText("Horizon, months"), {
      target: { value: "24" },
    });
    fireEvent.change(screen.getByLabelText("Recurring cash flow"), {
      target: { value: "4000" },
    });
    fireEvent.change(screen.getByLabelText("Recurring direction"), {
      target: { value: "withdrawal" },
    });
    fireEvent.change(screen.getByLabelText("Recurring frequency"), {
      target: { value: "quarterly" },
    });
    fireEvent.change(screen.getByLabelText("Contribution timing"), {
      target: { value: "beginning" },
    });
    fireEvent.change(screen.getByLabelText("One-off cash flow"), {
      target: { value: "250" },
    });
    fireEvent.change(screen.getByLabelText("One-off direction"), {
      target: { value: "contribution" },
    });
    fireEvent.change(screen.getByLabelText("One-off date"), {
      target: { value: "2027-10-06" },
    });
    fireEvent.change(screen.getByLabelText("Account wrapper"), {
      target: { value: "taxable" },
    });
    fireEvent.change(screen.getByLabelText("Annual return"), {
      target: { value: "7" },
    });
    fireEvent.change(screen.getByLabelText("Return convention"), {
      target: { value: "nominal-annual" },
    });
    fireEvent.change(screen.getByLabelText("Compounds per year"), {
      target: { value: "4" },
    });
    fireEvent.change(screen.getByLabelText("Return type"), {
      target: { value: "guaranteed-savings" },
    });
    for (const [label, value] of [
      ["Annual fee", "0.5"],
      ["Tax on positive growth", "25"],
      ["Future inflation", "3"],
      ["Return stress range", "4"],
      ["Inflation stress range", "2"],
    ] as const) {
      fireEvent.change(screen.getByLabelText(label), {
        target: { value },
      });
    }

    expect(
      screen.getByText(/labelled as guaranteed savings interest/),
    ).toBeVisible();
    expect(screen.getByText(/Unsupported: Taxable growth/)).toBeVisible();

    await waitFor(() => {
      const stored = window.localStorage.getItem(
        "assettracker:compound-growth-planner:v1",
      );
      expect(stored).not.toBeNull();
      expect(JSON.parse(stored ?? "{}")).toMatchObject({
        name: "Household ISA plan",
        selectedAccountIds: ["stocks-isa"],
        horizonMonths: 24,
        contributionTiming: "beginning",
        returnConvention: {
          kind: "nominal-annual",
          compoundingPeriods: 4,
        },
      });
    });
  });

  it("shows invalid assumptions and contribution-limit breaches", () => {
    render(<CompoundGrowthPlanner />);

    fireEvent.change(screen.getByLabelText("Recurring cash flow"), {
      target: { value: "4000" },
    });
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText("Horizon, months"), {
      target: { value: "0" },
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Horizon must be a positive whole number of months",
    );
  });

  it("recovers corrupt saved assumptions and exports calculation lineage", async () => {
    window.localStorage.setItem(
      "assettracker:compound-growth-planner:v1",
      "{not-json",
    );
    const createObjectUrl = vi.fn(() => "blob:growth-calculation");
    const revokeObjectUrl = vi.fn();
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    Object.defineProperties(URL, {
      createObjectURL: { configurable: true, value: createObjectUrl },
      revokeObjectURL: { configurable: true, value: revokeObjectUrl },
    });

    render(<CompoundGrowthPlanner />);
    fireEvent.click(screen.getByRole("button", { name: "Export calculation" }));

    expect(createObjectUrl).toHaveBeenCalledWith(expect.any(Blob));
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:growth-calculation");
    await waitFor(() =>
      expect(
        JSON.parse(
          window.localStorage.getItem(
            "assettracker:compound-growth-planner:v1",
          ) ?? "{}",
        ),
      ).toMatchObject({ name: "Long-term growth plan" }),
    );
  });

  it("hides household account controls when no eligible account exists", () => {
    mockUseAssetTracker.mockReturnValue({
      accountDetails: [],
      baseCurrency: "GBP",
    } as unknown as ReturnType<typeof useAssetTracker>);

    render(<CompoundGrowthPlanner />);

    expect(
      screen.queryByRole("group", { name: "Link household accounts" }),
    ).not.toBeInTheDocument();
  });
});
