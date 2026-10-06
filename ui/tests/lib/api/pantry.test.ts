import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getPantry,
  removePantryItem,
  replacePantry,
  restorePantry,
  setPantryItem,
} from "@/lib/api/pantry";

describe("pantry API client", () => {
  const operationId = "0198f1f0-1111-7111-8111-111111111111";
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("loads a household pantry and deletes obsolete browser stock", async () => {
    localStorage.setItem(
      "recipe-kitchen-stock-v1",
      JSON.stringify({ milk: "fridge" }),
    );
    localStorage.setItem("recipe-kitchen-stock-v1-owner", "old-user");
    const pantry = {
      resourceId: "household-1",
      revision: "4",
      scope: {
        type: "household" as const,
        household: { id: "household-1", name: "Park Road" },
      },
      stock: { onion: "fresh" as const },
      itemVersions: { onion: "2" },
    };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json(pantry));

    await expect(getPantry()).resolves.toEqual(pantry);
    expect(fetchMock).toHaveBeenCalledWith("/api/pantry", {
      credentials: "same-origin",
      signal: undefined,
    });
    expect(localStorage.getItem("recipe-kitchen-stock-v1")).toBeNull();
    expect(localStorage.getItem("recipe-kitchen-stock-v1-owner")).toBeNull();
  });

  it("updates and removes individual shared-stock entries", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () =>
        Response.json({ scope: { type: "personal" }, stock: {} }),
      );

    await setPantryItem(
      "red-onion",
      { location: "fridge", quantity: null, freshness: "unknown" },
      operationId,
    );
    await removePantryItem("red-onion", operationId);
    await restorePantry({ red: "fresh" }, operationId);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/pantry/items/red-onion",
      expect.objectContaining({
        method: "PUT",
        credentials: "same-origin",
        body: JSON.stringify({
          location: "fridge",
          quantity: null,
          freshness: "unknown",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/pantry/items/red-onion",
      expect.objectContaining({
        method: "DELETE",
        credentials: "same-origin",
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/pantry",
      expect.objectContaining({
        method: "PATCH",
        credentials: "same-origin",
        body: JSON.stringify({ stock: { red: "fresh" } }),
      }),
    );
    for (const [, request] of fetchMock.mock.calls) {
      expect(new Headers(request?.headers).get("Idempotency-Key")).toBe(
        operationId,
      );
    }
  });

  it("surfaces pantry API errors with their status and message", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        Response.json({ error: "Pantry is unavailable" }, { status: 503 }),
      )
      .mockResolvedValueOnce(new Response("not json", { status: 502 }));

    await expect(getPantry()).rejects.toMatchObject({
      name: "ApiError",
      message: "Pantry is unavailable",
      status: 503,
    });
    await expect(replacePantry({})).rejects.toMatchObject({
      name: "ApiError",
      message: "Pantry request failed.",
      status: 502,
    });
  });
});
