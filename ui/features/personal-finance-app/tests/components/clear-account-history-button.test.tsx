import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAssetTracker } from "@/features/personal-finance-app/components/asset-tracker-provider";
import { ClearAccountHistoryButton } from "@/features/personal-finance-app/components/clear-account-history-button";

vi.mock(
  "@/features/personal-finance-app/components/asset-tracker-provider",
  () => ({
    useAssetTracker: vi.fn(),
  }),
);

const mockUseAssetTracker = vi.mocked(useAssetTracker);

describe("ClearAccountHistoryButton", () => {
  const clearAccountHistory = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAssetTracker.mockReturnValue({
      clearAccountHistory,
    } as unknown as ReturnType<typeof useAssetTracker>);
  });

  it("requires confirmation before clearing all balance history", async () => {
    const user = userEvent.setup();
    render(
      <ClearAccountHistoryButton
        accountId="stocks-isa"
        kind="balances"
        count={214}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Clear all balance history" }),
    );
    expect(clearAccountHistory).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", {
        name: "Confirm clear 214 balance records",
      }),
    );
    expect(clearAccountHistory).toHaveBeenCalledWith({
      accountId: "stocks-isa",
      kind: "balances",
    });
  });

  it("allows a pending clear to be cancelled", async () => {
    const user = userEvent.setup();
    render(
      <ClearAccountHistoryButton
        accountId="stocks-isa"
        kind="capitalFlows"
        count={12}
      />,
    );

    await user.click(
      screen.getByRole("button", {
        name: "Clear all deposit/withdrawal history",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(clearAccountHistory).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", {
        name: "Clear all deposit/withdrawal history",
      }),
    ).toBeVisible();
  });
});
