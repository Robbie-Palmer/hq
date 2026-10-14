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
import { AddAccountDrawer } from "@/components/assettracker/add-account-drawer";
import { useAssetTracker } from "@/components/assettracker/asset-tracker-provider";

vi.mock("@/components/assettracker/asset-tracker-provider", () => ({
  useAssetTracker: vi.fn(),
}));

const mockUseAssetTracker = vi.mocked(useAssetTracker);

beforeAll(() => {
  for (const method of [
    "setPointerCapture",
    "releasePointerCapture",
    "hasPointerCapture",
    "scrollIntoView",
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
    "scrollIntoView",
  ]) {
    Reflect.deleteProperty(HTMLElement.prototype, method);
  }
});

describe("AddAccountDrawer", () => {
  beforeEach(() => {
    mockUseAssetTracker.mockReturnValue({
      accounts: [],
      baseCurrency: "GBP",
      createAccount: vi.fn().mockResolvedValue(undefined),
      household: {
        members: [
          { id: "alex", displayName: "Alex" },
          { id: "sam", displayName: "Sam" },
        ],
        activeScope: { kind: "household" },
      },
    } as unknown as ReturnType<typeof useAssetTracker>);
  });

  it("lets a household choose who owns a new account", async () => {
    const user = userEvent.setup();
    render(<AddAccountDrawer />);

    await user.click(screen.getByRole("button", { name: "Add account" }));
    const owner = screen.getByLabelText("Owner");
    expect(owner).toHaveTextContent("Alex");

    await user.click(owner);
    await user.click(screen.getByRole("option", { name: "Sam" }));
    expect(owner).toHaveTextContent("Sam");
  });
});
