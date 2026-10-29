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
});
