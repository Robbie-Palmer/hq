import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createHousehold,
  getHouseholds,
  getIncomingHouseholdInvitations,
  removeHouseholdMember,
  revokeHouseholdInvitation,
  saveHouseholdEquipmentMatchMode,
} from "@/lib/api/households";

describe("household API client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("loads the signed-in user's households", async () => {
    const household = {
      id: "household-1",
      name: "Park Road kitchen",
      slug: "household-1",
      logo: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      membership: { id: "member-1", role: "owner" },
    };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json([household]));

    await expect(getHouseholds()).resolves.toEqual([household]);
    expect(fetchMock).toHaveBeenCalledWith("/api/households", {
      credentials: "same-origin",
      signal: undefined,
    });
  });

  it("reports an empty successful response as an API failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 200 }),
    );

    await expect(getHouseholds()).rejects.toThrow(
      "Couldn't load your household.",
    );
  });

  it("reports malformed successful JSON as an API failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("not json", { status: 200 }),
    );

    await expect(getHouseholds()).rejects.toThrow(
      "Couldn't load your household.",
    );
  });

  it("creates a household with a JSON request", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json(
        {
          id: "household-1",
          name: "Park Road kitchen",
          slug: "household-1",
          logo: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        { status: 201 },
      ),
    );

    await expect(createHousehold("Park Road kitchen")).resolves.toMatchObject({
      name: "Park Road kitchen",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/households",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "Park Road kitchen" }),
      }),
    );
  });

  it("loads incoming invitations for the signed-in email", async () => {
    const invitation = {
      id: "invitation-1",
      householdId: "household-1",
      email: "invitee@example.com",
      role: "member",
      status: "pending",
      expiresAt: "2026-01-03T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
      household: { id: "household-1", name: "Park Road kitchen" },
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json([invitation]),
    );

    await expect(getIncomingHouseholdInvitations()).resolves.toEqual([
      invitation,
    ]);
  });

  it("surfaces API errors from member removal", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json(
        { error: "Household owner cannot be revoked" },
        { status: 400 },
      ),
    );

    await expect(
      removeHouseholdMember("household-1", "owner-member"),
    ).rejects.toThrow("Household owner cannot be revoked");
  });

  it("accepts a successful no-content invitation revocation", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 204 }),
    );

    await expect(
      revokeHouseholdInvitation("household-1", "invitation-1"),
    ).resolves.toBeUndefined();
  });

  it("saves the household equipment matching preference", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ recipeMatchMode: "hide" }));

    await expect(
      saveHouseholdEquipmentMatchMode("household-1", "hide"),
    ).resolves.toEqual({ recipeMatchMode: "hide" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/households/household-1/equipment",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ recipeMatchMode: "hide" }),
      }),
    );
  });
});
