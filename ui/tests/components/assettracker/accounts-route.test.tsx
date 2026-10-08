import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccountsRoute } from "@/components/assettracker/accounts-route";
import { useAssetTracker } from "@/components/assettracker/asset-tracker-provider";
import type { AccountDetailView } from "@/lib/domain/assettracker";

const mocks = vi.hoisted(() => ({
  accountId: null as string | null,
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
  useSearchParams: () => {
    const params = new URLSearchParams();
    if (mocks.accountId !== null) params.set("account", mocks.accountId);
    return params;
  },
}));

vi.mock("@/components/assettracker/asset-tracker-provider", () => ({
  useAssetTracker: vi.fn(),
}));

vi.mock("@/components/assettracker/account-detail-sheet", () => ({
  AccountDetailSheet: ({
    accountId,
    onClose,
  }: {
    accountId: string | null;
    onClose(): void;
  }) => (
    <div>
      <p>Selected account: {accountId ?? "none"}</p>
      {accountId && (
        <button type="button" onClick={onClose}>
          Close account
        </button>
      )}
    </div>
  ),
}));

vi.mock("@/components/assettracker/account-history-import-drawer", () => ({
  AccountHistoryImportDrawer: () => (
    <button type="button">Import history</button>
  ),
}));

vi.mock("@/components/assettracker/add-account-drawer", () => ({
  AddAccountDrawer: () => <button type="button">Add account</button>,
}));

vi.mock("@/components/assettracker/log-balance-drawer", () => ({
  LogBalanceDrawer: () => <button type="button">Log balance</button>,
}));

vi.mock("@/components/assettracker/record-transfer-drawer", () => ({
  RecordTransferDrawer: () => <button type="button">Record transfer</button>,
}));

const account: AccountDetailView = {
  id: "current",
  name: "Current account",
  provider: "Bank",
  currency: "GBP",
  assetType: "cash",
  expectedAnnualReturn: 0.01,
  isOpen: true,
  latestBalance: 2_000,
  latestSnapshotDate: "2026-09-01",
  cagr: null,
  createdAt: "2024-01-01",
  snapshots: [{ date: "2026-09-01", balance: 2_000 }],
  capitalFlows: [],
  netContributed: null,
  gainLoss: null,
};

const mockUseAssetTracker = vi.mocked(useAssetTracker);

function trackerWithAccounts(accountDetails: AccountDetailView[]) {
  return {
    accountDetails,
    household: {
      members: [
        { id: "alex", displayName: "Alex" },
        { id: "sam", displayName: "Sam" },
      ],
      activeScope: { kind: "household" },
    },
    householdAccounts: accountDetails.map(({ id, name, provider }) => ({
      id,
      name,
      provider,
      ownership: {
        kind: "shared",
        shares: [
          { memberId: "alex", share: 0.6 },
          { memberId: "sam", share: 0.4 },
        ],
      },
    })),
  } as unknown as ReturnType<typeof useAssetTracker>;
}

describe("AccountsRoute", () => {
  beforeEach(() => {
    mocks.accountId = null;
    mocks.replace.mockReset();
    mockUseAssetTracker.mockReturnValue(trackerWithAccounts([account]));
  });

  it("opens the account named by the URL and closes it without a stale history entry", async () => {
    const user = userEvent.setup();
    mocks.accountId = "current";

    render(<AccountsRoute />);

    expect(screen.getByText("Selected account: current")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Close account" }));
    expect(mocks.replace).toHaveBeenCalledWith("/assettracker/accounts", {
      scroll: false,
    });
  });

  it("shows the registered owners of each account", () => {
    render(<AccountsRoute />);

    expect(screen.getByRole("columnheader", { name: "Owner" })).toBeVisible();
    expect(screen.getByText("Alex 60%, Sam 40%")).toBeVisible();
  });

  it("handles an unknown account URL without opening account controls", async () => {
    const user = userEvent.setup();
    mocks.accountId = "missing";

    render(<AccountsRoute />);

    expect(screen.getByRole("alert")).toHaveTextContent("Account not found");
    expect(screen.getByText("Selected account: none")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Show all accounts" }));
    expect(mocks.replace).toHaveBeenCalledWith("/assettracker/accounts", {
      scroll: false,
    });
  });

  it("offers account creation when the browser has no accounts", () => {
    mockUseAssetTracker.mockReturnValue(trackerWithAccounts([]));

    render(<AccountsRoute />);

    expect(
      screen.getByRole("heading", { name: "No accounts yet" }),
    ).toBeVisible();
    expect(screen.getAllByRole("button", { name: "Add account" })).toHaveLength(
      2,
    );
  });
});
