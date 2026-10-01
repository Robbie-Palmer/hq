import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCurrentShoppingList,
  type ShoppingListContents,
  saveCurrentShoppingList,
  shareCurrentShoppingList,
  startNewShoppingList,
} from "@/lib/api/shopping-lists";

const snapshot: ShoppingListContents = {
  recipes: [{ slug: "mushroom-risotto", servings: 4 }],
  checked: ["garlic"],
  extras: [{ id: "extra-milk", text: "Milk", checked: false }],
};

describe("shopping-list API client", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("loads and saves the active list", async () => {
    const response = { id: "list-1", snapshot };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => Response.json(response));

    await expect(getCurrentShoppingList()).resolves.toEqual(response);
    await expect(
      saveCurrentShoppingList("list-1", "3", snapshot),
    ).resolves.toEqual(response);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/shopping-lists/current",
      {
        credentials: "same-origin",
        signal: undefined,
      },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/shopping-lists/current",
      expect.objectContaining({
        body: JSON.stringify({ listId: "list-1", revision: "3", snapshot }),
        credentials: "same-origin",
        method: "PUT",
      }),
    );
  });

  it("starts a new list while sending the final archived snapshot", async () => {
    const next = { id: "list-2", snapshot: { ...snapshot, recipes: [] } };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json(next, { status: 201 }));

    await expect(
      startNewShoppingList("list-1", "3", snapshot),
    ).resolves.toEqual(next);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/shopping-lists",
      expect.objectContaining({
        body: JSON.stringify({
          previousListId: "list-1",
          previousRevision: "3",
          snapshot,
        }),
        credentials: "same-origin",
        method: "POST",
      }),
    );
  });

  it("shares the current list with a household member", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ shared: true }, { status: 201 }));

    await expect(
      shareCurrentShoppingList("member-user"),
    ).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/shopping-lists/current/shares",
      expect.objectContaining({
        body: JSON.stringify({ recipientUserId: "member-user" }),
        credentials: "same-origin",
        method: "POST",
      }),
    );
  });
});
