import { afterEach, describe, expect, it, vi } from "vitest";
import { browserGuestPlaylistSession } from "@/app/_projects/wedding-planner/application/guest-session";

const GUEST_ID = "1ecb2993-9471-4d47-85db-5dbf4d68c1e0";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("browser guest playlist session", () => {
  it("keeps the session stable when browser storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage is blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage is blocked", "SecurityError");
    });
    vi.spyOn(crypto, "randomUUID").mockReturnValue(GUEST_ID);

    expect(
      browserGuestPlaylistSession.load("blocked-storage-playlist"),
    ).toEqual({ guestId: GUEST_ID, name: "" });

    expect(() =>
      browserGuestPlaylistSession.saveName(
        "blocked-storage-playlist",
        "Taylor",
      ),
    ).not.toThrow();
    expect(
      browserGuestPlaylistSession.load("blocked-storage-playlist"),
    ).toEqual({ guestId: GUEST_ID, name: "Taylor" });
    expect(crypto.randomUUID).toHaveBeenCalledTimes(1);
  });

  it("keeps a newer in-memory name when a browser storage write fails", () => {
    const playlistId = "failed-write-playlist";
    const guestIdKey = `wedding-playlist:${playlistId}:guest-id`;
    const guestNameKey = `wedding-playlist:${playlistId}:guest-name`;
    vi.spyOn(Storage.prototype, "getItem").mockImplementation((key) => {
      if (key === guestIdKey) return GUEST_ID;
      if (key === guestNameKey) return "Old name";
      return null;
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage is full", "QuotaExceededError");
    });

    expect(browserGuestPlaylistSession.load(playlistId)).toEqual({
      guestId: GUEST_ID,
      name: "Old name",
    });

    browserGuestPlaylistSession.saveName(playlistId, "New name");

    expect(browserGuestPlaylistSession.load(playlistId)).toEqual({
      guestId: GUEST_ID,
      name: "New name",
    });
    expect(Storage.prototype.getItem).toHaveBeenCalledWith(guestNameKey);
  });
});
