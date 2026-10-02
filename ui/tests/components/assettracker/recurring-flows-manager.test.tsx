import { render, screen } from "@testing-library/react";
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
import { useAssetTracker } from "@/components/assettracker/asset-tracker-provider";
import { RecurringFlowsManager } from "@/components/assettracker/recurring-flows-manager";
import type { AccountDetailView } from "@/lib/domain/assettracker";

vi.mock("@/components/assettracker/asset-tracker-provider", () => ({
  useAssetTracker: vi.fn(),
}));

vi.mock("@/components/assettracker/account-flows", async () => {
  const { useState } = await import("react");

  return {
    AccountFlows: ({ account }: { account: AccountDetailView }) => {
      const [draftName, setDraftName] = useState("");

      return (
        <div>
          <p>Managing {account.name}</p>
          <label htmlFor="mock-flow-name">Flow name</label>
          <input
            id="mock-flow-name"
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
          />
        </div>
      );
    },
  };
});

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
const originalScrollIntoView = Element.prototype.scrollIntoView;

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
  Element.prototype.scrollIntoView = vi.fn();
});

afterAll(() => {
  for (const method of [
    "setPointerCapture",
    "releasePointerCapture",
    "hasPointerCapture",
  ]) {
    Reflect.deleteProperty(HTMLElement.prototype, method);
  }
  Element.prototype.scrollIntoView = originalScrollIntoView;
});

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

  it("clears the flow draft when the managed account changes", async () => {
    const savingsAccount = {
      ...account,
      id: "savings",
      name: "Savings account",
    };
    mockUseAssetTracker.mockReturnValue({
      accountDetails: [account, savingsAccount],
    } as unknown as ReturnType<typeof useAssetTracker>);
    const user = userEvent.setup();
    render(<RecurringFlowsManager />);

    await user.type(screen.getByLabelText("Flow name"), "Salary");
    await user.click(screen.getByRole("combobox", { name: "Account" }));
    await user.click(screen.getByRole("option", { name: "Savings account" }));

    expect(screen.getByText("Managing Savings account")).toBeVisible();
    expect(screen.getByLabelText("Flow name")).toHaveValue("");
  });

  it("handles an empty account list", () => {
    mockUseAssetTracker.mockReturnValue({
      accountDetails: [],
    } as unknown as ReturnType<typeof useAssetTracker>);

    render(<RecurringFlowsManager />);

    expect(screen.getByText(/Add an open account/)).toBeVisible();
  });
});
