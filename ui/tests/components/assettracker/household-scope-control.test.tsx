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
import { useAssetTracker } from "@/components/assettracker/asset-tracker-provider";
import { HouseholdScopeControl } from "@/components/assettracker/household-scope-control";

vi.mock("@/components/assettracker/asset-tracker-provider", () => ({
  useAssetTracker: vi.fn(),
}));

const mockUseAssetTracker = vi.mocked(useAssetTracker);

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

describe("HouseholdScopeControl", () => {
  const setActiveHouseholdScope = vi.fn().mockResolvedValue(undefined);
  const addHouseholdMember = vi.fn().mockResolvedValue(undefined);
  const renameHouseholdMember = vi.fn().mockResolvedValue(undefined);
  const setAccountOwnership = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAssetTracker.mockReturnValue({
      household: {
        members: [
          { id: "alex", displayName: "Alex" },
          { id: "sam", displayName: "Sam" },
        ],
        activeScope: { kind: "member", memberId: "alex" },
      },
      householdAccounts: [
        {
          id: "home",
          name: "Home",
          provider: "Joint bank",
          ownership: { kind: "personal", memberId: "alex" },
        },
      ],
      setActiveHouseholdScope,
      addHouseholdMember,
      renameHouseholdMember,
      setAccountOwnership,
    } as unknown as ReturnType<typeof useAssetTracker>);
  });

  it("identifies the active member and switches to the household view", async () => {
    const user = userEvent.setup();
    render(<HouseholdScopeControl />);

    await user.click(screen.getByRole("button", { name: "Viewing Alex" }));
    expect(screen.getByText(/do not create separate logins/i)).toBeVisible();
    await user.selectOptions(
      screen.getByLabelText("Active household view"),
      "household",
    );

    expect(setActiveHouseholdScope).toHaveBeenCalledWith({
      kind: "household",
    });
  });

  it("edits the local roster and assigns an account to equal shared ownership", async () => {
    const user = userEvent.setup();
    render(<HouseholdScopeControl />);

    await user.click(screen.getByRole("button", { name: "Viewing Alex" }));
    await user.clear(screen.getByLabelText("Display name for Sam"));
    await user.type(screen.getByLabelText("Display name for Sam"), "Samantha");
    const saveButton = screen.getAllByRole("button", { name: "Save" }).at(-1);
    if (saveButton == null) throw new Error("Missing member save button");
    await user.click(saveButton);
    await user.type(screen.getByLabelText("New household member"), "Jo");
    await user.click(screen.getByRole("button", { name: "Add" }));
    await user.selectOptions(screen.getByLabelText("Owner of Home"), "shared");

    await waitFor(() => {
      expect(renameHouseholdMember).toHaveBeenCalledWith("sam", "Samantha");
      expect(addHouseholdMember).toHaveBeenCalledWith("Jo");
      expect(setAccountOwnership).toHaveBeenCalledWith("home", {
        kind: "shared",
        shares: [
          { memberId: "alex", share: 0.5 },
          { memberId: "sam", share: 0.5 },
        ],
      });
    });
  });
});
