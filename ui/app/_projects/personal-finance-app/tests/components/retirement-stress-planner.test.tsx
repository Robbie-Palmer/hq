import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAssetTracker } from "@/app/_projects/personal-finance-app/components/asset-tracker-provider";
import { RetirementStressPlanner } from "@/app/_projects/personal-finance-app/components/retirement-stress-planner";
import type { AccountDetailView } from "@/app/_projects/personal-finance-app/domain";

vi.mock(
  "@/app/_projects/personal-finance-app/components/asset-tracker-provider",
  () => ({ useAssetTracker: vi.fn() }),
);

const mockUseAssetTracker = vi.mocked(useAssetTracker);

function account(
  overrides: Partial<AccountDetailView> &
    Pick<AccountDetailView, "id" | "name">,
): AccountDetailView {
  const { id, name, ...rest } = overrides;
  return {
    id,
    name,
    provider: "Provider",
    currency: "GBP",
    assetType: "stocks",
    taxWrapper: "isa",
    expectedAnnualReturn: 0.05,
    isOpen: true,
    latestBalance: 300_000,
    latestSnapshotDate: "2026-10-01",
    cagr: null,
    createdAt: "2020-01-01",
    snapshots: [],
    capitalFlows: [],
    netContributed: null,
    gainLoss: null,
    ...rest,
  };
}

describe("RetirementStressPlanner", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockUseAssetTracker.mockReturnValue({
      accountDetails: [
        account({ id: "isa", name: "Stocks ISA" }),
        account({
          id: "pension",
          name: "Workplace pension",
          taxWrapper: "pension",
          liquidity: "illiquid",
          latestBalance: 200_000,
        }),
      ],
      baseCurrency: "GBP",
      spendingBaselines: [],
    } as unknown as ReturnType<typeof useAssetTracker>);
  });

  it("shows fixed-horizon ranges, stress attribution, and retirement choices", () => {
    render(<RetirementStressPlanner />);

    expect(
      screen.getByRole("heading", { name: "Retirement stress ranges" }),
    ).toBeVisible();
    expect(
      screen.getByRole("table", {
        name: "Retirement stress outcomes at 10, 15, 20, and 30 years",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("table", {
        name: "Retirement stress effects at 20 years",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("table", {
        name: "Retirement timing and replacement income comparison",
      }),
    ).toHaveTextContent("Work 2 years longer");
  });

  it("persists named assumptions and keeps every changed value visible", async () => {
    render(<RetirementStressPlanner />);

    fireEvent.change(screen.getByLabelText("Conservative name"), {
      target: { value: "Long downturn" },
    });
    fireEvent.change(screen.getByLabelText("Central inflation, %"), {
      target: { value: "3.2" },
    });
    fireEvent.change(screen.getByLabelText("Work longer by, years"), {
      target: { value: "3" },
    });

    expect(screen.getByDisplayValue("Long downturn")).toBeVisible();
    expect(screen.getByLabelText("Central inflation, %")).toHaveValue(3.2);
    expect(screen.getByText("Work 3 years longer")).toBeVisible();
    await waitFor(() => {
      const saved = window.localStorage.getItem(
        "assettracker:retirement-stress-planner:v1",
      );
      const parsed = JSON.parse(saved ?? "{}");
      expect(parsed.workLongerYears).toBe(3);
      expect(parsed.assumptionSets).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "Long downturn" }),
          expect.objectContaining({
            id: "central",
            annualInflation: 0.032,
          }),
        ]),
      );
    });
  });

  it("shows invalid deterministic assumptions instead of false precision", () => {
    render(<RetirementStressPlanner />);

    fireEvent.change(
      screen.getByLabelText("Conservative longevity horizon, years"),
      { target: { value: "20" } },
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Longevity horizons must be whole years of at least 30",
    );
  });
});
