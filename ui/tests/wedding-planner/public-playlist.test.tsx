import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addSongSuggestion,
  createCollaborativePlaylist,
  guestPlaylist as projectGuestPlaylist,
  voteForSong,
} from "wedding-planner-domain";
import { PublicPlaylist } from "@/components/wedding-planner/public-playlist";
import { fireEvent, render, screen, waitFor, within } from "@/tests/test-utils";

const GUEST_ID = "1ecb2993-9471-4d47-85db-5dbf4d68c1e0";

function playlistSource() {
  const playlist = createCollaborativePlaylist("Alex and Sam's playlist");
  addSongSuggestion(playlist, {
    id: "guest-song",
    title: "Guest song",
    artist: "Guest artist",
    moment_id: "reception",
    contributor: { id: "another-guest", name: "Casey" },
    created_at: "2026-10-17T12:00:00.000Z",
  });
  return playlist;
}

function closest(element: HTMLElement, selector: string): HTMLElement {
  const match = element.closest<HTMLElement>(selector);
  if (!match) throw new Error(`Expected ${selector} ancestor`);
  return match;
}

afterEach(() => {
  window.location.hash = "";
  window.localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("public wedding playlist", () => {
  it("loads the guest link, remembers the guest, suggests songs, and votes", async () => {
    const playlist = playlistSource();
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/suggestions") && init?.method === "POST") {
          const changed = structuredClone(playlist);
          addSongSuggestion(changed, {
            id: "new-song",
            title: "New song",
            artist: "New artist",
            moment_id: "reception",
            contributor: { id: GUEST_ID, name: "Taylor" },
            created_at: "2026-10-17T12:01:00.000Z",
          });
          return Response.json(projectGuestPlaylist(changed, GUEST_ID), {
            status: 201,
          });
        }
        if (url.endsWith("/votes") && init?.method === "POST") {
          const changed = structuredClone(playlist);
          const [song] = changed.songs;
          if (!song) throw new Error("Expected playlist song");
          voteForSong(changed, song.id, GUEST_ID, true);
          return Response.json(projectGuestPlaylist(changed, GUEST_ID));
        }
        return Response.json(projectGuestPlaylist(playlist, GUEST_ID));
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(crypto, "randomUUID").mockReturnValue(GUEST_ID);
    window.location.hash =
      "#id=playlist-public-id&token=guest-token-value-1234";

    render(<PublicPlaylist />);
    expect(
      await screen.findByRole("heading", { name: "Alex and Sam's playlist" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Suggested by Casey")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Your name"), {
      target: { value: "Taylor" },
    });
    fireEvent.change(screen.getByLabelText("Song title"), {
      target: { value: "New song" },
    });
    fireEvent.change(screen.getByLabelText("Artist"), {
      target: { value: "New artist" },
    });
    fireEvent.change(
      screen.getByLabelText("Spotify, Apple Music, or YouTube link"),
      { target: { value: "https://music.example/new" } },
    );
    fireEvent.change(screen.getByLabelText("Song note"), {
      target: { value: "Please play this" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add suggestion" }));
    await screen.findByRole("heading", { name: "New song" });
    expect(
      window.localStorage.getItem(
        "wedding-playlist:playlist-public-id:guest-name",
      ),
    ).toBe("Taylor");
    expect(screen.getByLabelText("Song title")).toHaveValue("");

    const guestSong = closest(
      screen.getByRole("heading", { name: "Guest song" }),
      "article",
    );
    fireEvent.click(within(guestSong).getByRole("button"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    for (const [, init] of fetchMock.mock.calls) {
      expect(new Headers(init?.headers).get("X-Wedding-Guest-Id")).toBe(
        GUEST_ID,
      );
      expect(String(init?.body ?? "")).not.toContain(GUEST_ID);
    }
  });

  it("explains incomplete and rejected guest links", async () => {
    const incomplete = render(<PublicPlaylist />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This guest link is incomplete. Ask the couple for a new one.",
    );
    incomplete.unmount();

    window.location.hash =
      "#id=playlist-public-id&token=guest-token-value-1234";
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { error: "This playlist has expired." },
            { status: 403 },
          ),
        ),
    );
    render(<PublicPlaylist />);
    expect(
      await screen.findByText("This playlist has expired."),
    ).toBeInTheDocument();
  });
});
