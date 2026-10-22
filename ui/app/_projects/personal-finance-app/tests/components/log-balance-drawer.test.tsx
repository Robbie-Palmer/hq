import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { useAssetTracker } from "@/app/_projects/personal-finance-app/components/asset-tracker-provider";
import { LogBalanceDrawer } from "@/app/_projects/personal-finance-app/components/log-balance-drawer";

vi.mock(
  "@/app/_projects/personal-finance-app/components/asset-tracker-provider",
  () => ({
    useAssetTracker: vi.fn(),
  }),
);

const mockUseAssetTracker = vi.mocked(useAssetTracker);
const recordBalance = vi.fn();

beforeAll(() => {
  for (const method of [
    "setPointerCapture",
    "releasePointerCapture",
    "hasPointerCapture",
  ]) {
    Object.defineProperty(HTMLElement.prototype, method, {
      configurable: true,
      value: vi.fn(),
    });
  }
});

afterAll(() => {
  for (const method of [
    "setPointerCapture",
    "releasePointerCapture",
    "hasPointerCapture",
  ]) {
    Reflect.deleteProperty(HTMLElement.prototype, method);
  }
});

describe("LogBalanceDrawer", () => {
  beforeEach(() => {
    recordBalance.mockReset().mockResolvedValue(undefined);
    mockUseAssetTracker.mockReturnValue({
      accounts: [
        {
          id: "savings",
          name: "Savings",
          currency: "GBP",
          isOpen: true,
          latestBalance: 10_000,
          latestSnapshotDate: "2026-10-01",
        },
      ],
      recordBalance,
    } as unknown as ReturnType<typeof useAssetTracker>);
  });

  it("previews and records the result of a balance expression", async () => {
    const user = userEvent.setup();
    render(<LogBalanceDrawer accountId="savings" />);

    await user.click(screen.getByRole("button", { name: "Log balance" }));
    await user.type(screen.getByLabelText("Balance (GBP)"), "2648+16058");

    expect(screen.getByText("Result: £18,706.00")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Save balance" }));

    await waitFor(() =>
      expect(recordBalance).toHaveBeenCalledWith({
        accountId: "savings",
        balance: 18_706,
        date: expect.any(String),
      }),
    );
  });

  it("explains unsupported expressions without recording a balance", async () => {
    const user = userEvent.setup();
    render(<LogBalanceDrawer accountId="savings" />);

    await user.click(screen.getByRole("button", { name: "Log balance" }));
    await user.type(screen.getByLabelText("Balance (GBP)"), "savings+100");
    await user.click(screen.getByRole("button", { name: "Save balance" }));

    expect(
      screen.getByText("Use numbers and +, -, *, /, or parentheses"),
    ).toBeVisible();
    expect(recordBalance).not.toHaveBeenCalled();
  });
});
