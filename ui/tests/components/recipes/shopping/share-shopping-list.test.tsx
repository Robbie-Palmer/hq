import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ShareShoppingList } from "@/components/recipes/shopping/share-shopping-list";
import { render } from "@/tests/test-utils";

const mocks = vi.hoisted(() => ({
  getMembers: vi.fn(),
  share: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({ data: { user: { id: "owner-user" } } }),
  },
}));

vi.mock("@/lib/api/households", () => ({
  getHouseholdMembers: mocks.getMembers,
}));

vi.mock("@/lib/api/shopping-lists", () => ({
  shareCurrentShoppingList: mocks.share,
}));

vi.mock("sonner", () => ({ toast: mocks.toast }));

const scope = {
  type: "household" as const,
  household: { id: "household-1", name: "Park Road" },
};

const owner = {
  id: "member-owner",
  role: "owner" as const,
  createdAt: "2026-09-01T10:00:00.000Z",
  user: {
    id: "owner-user",
    name: "Alex",
    email: "alex@example.test",
    image: null,
  },
};

const member = {
  id: "member-sam",
  role: "member" as const,
  createdAt: "2026-09-02T10:00:00.000Z",
  user: {
    id: "sam-user",
    name: "Sam",
    email: "sam@example.test",
    image: null,
  },
};

describe("ShareShoppingList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getMembers.mockResolvedValue([owner, member]);
    mocks.share.mockResolvedValue(undefined);
  });

  it("notifies a selected household member", async () => {
    const user = userEvent.setup();
    render(<ShareShoppingList scope={scope} />);

    await user.click(screen.getByRole("button", { name: "share" }));
    await user.click(
      await screen.findByRole("button", { name: "Share with Sam" }),
    );

    await waitFor(() => {
      expect(mocks.share).toHaveBeenCalledWith("sam-user");
      expect(mocks.toast.success).toHaveBeenCalledWith("Sam has been notified");
    });
    expect(
      screen.queryByRole("button", { name: "Share with Sam" }),
    ).not.toBeInTheDocument();
  });

  it("keeps a copy-link option in the share menu", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(<ShareShoppingList scope={scope} />);

    await user.click(screen.getByRole("button", { name: "share" }));
    await user.click(await screen.findByRole("button", { name: "Copy link" }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        "http://localhost:3000/recipes/shopping",
      );
      expect(mocks.toast.success).toHaveBeenCalledWith(
        "Household shopping list link copied",
      );
    });
  });

  it("shows member-loading failures without hiding the copy option", async () => {
    mocks.getMembers.mockRejectedValue(new Error("offline"));
    const user = userEvent.setup();
    render(<ShareShoppingList scope={scope} />);

    await user.click(screen.getByRole("button", { name: "share" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Household members could not be loaded.",
    );
    expect(screen.getByRole("button", { name: "Copy link" })).toBeEnabled();
  });
});
