import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAssetTracker } from "@/components/assettracker/asset-tracker-provider";
import { RecurringFlowsManager } from "@/components/assettracker/recurring-flows-manager";
import type { AccountDetailView } from "@/lib/domain/assettracker";

vi.mock("@/components/assettracker/asset-tracker-provider", () => ({
  useAssetTracker: vi.fn(),
}));

vi.mock("@/components/assettracker/account-flows", () => ({
  AccountFlows: ({ account }: { account: AccountDetailView }) => (
    <p>Managing {account.name}</p>
  ),
}));

const account: AccountDetailView = {
  id: "current",
  name: "Current account",
  provider: "Bank",
  currency: "GBP",
  assetType: "cash",
  expectedAnnualReturn: 0,
  isOpen: true,
  latestBalance: 100,
  latestSnapshotDate: "2026-09-01",
  cagr: null,
  createdAt: "2025-01-01",
  snapshots: [],
  capitalFlows: [],
  netContributed: null,
  gainLoss: null,
};

const mockUseAssetTracker = vi.mocked(useAssetTracker);

describe("RecurringFlowsManager", () => {
  beforeEach(() => {
    mockUseAssetTracker.mockReturnValue({
      accountDetails: [account],
    } as unknown as ReturnType<typeof useAssetTracker>);
  });

  it("opens recurring-flow management for an available account", () => {
    render(<RecurringFlowsManager />);

    expect(screen.getByText("Managing Current account")).toBeVisible();
  });

  it("handles an empty account list", () => {
    mockUseAssetTracker.mockReturnValue({
      accountDetails: [],
    } as unknown as ReturnType<typeof useAssetTracker>);

    render(<RecurringFlowsManager />);

    expect(screen.getByText(/Add an open account/)).toBeVisible();
  });
});
