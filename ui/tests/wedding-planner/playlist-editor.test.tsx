import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addSongSuggestion,
  type CollaborativePlaylist,
  createCollaborativePlaylist,
  moderateSong,
} from "wedding-planner-domain";
import { PlaylistEditor } from "@/components/wedding-planner/playlist-editor";
import type { WeddingPlanDraft } from "@/lib/wedding-planner/types";
import { fireEvent, render, screen, waitFor, within } from "@/tests/test-utils";

function plan(playlist?: CollaborativePlaylist): WeddingPlanDraft {
  return {
    nights: 1,
    guests: [],
    payment_modes: {},
    cottage_options: {},
    cottage_paid_by_us_gbp: {},
    reservations: {},
    reviewed_non_couples: [],
    suite_billing_modes: {},
    guest_charge_cap_gbp: "",
    max_cottage_spend_gbp: "",
    default_outside_cost_gbp: "",
    optimization_mode: "priority_first",
    playlist,
  };
}

function PlaylistHarness({
  initialPlaylist,
}: Readonly<{ initialPlaylist?: CollaborativePlaylist }>) {
  const [state, setState] = useState(() => plan(initialPlaylist));
  return (
    <>
      <PlaylistEditor
        playlist={state.playlist}
        onUpdate={(change) =>
          setState((current) => {
            const draft = structuredClone(current);
            change(draft);
            return draft;
          })
        }
      />
      <output data-testid="playlist-state">
        {JSON.stringify(state.playlist)}
      </output>
    </>
  );
}

function closest(element: HTMLElement, selector: string): HTMLElement {
  const match = element.closest<HTMLElement>(selector);
  if (!match) throw new Error(`Expected ${selector} ancestor`);
  return match;
}

function playlistWithStatuses(): CollaborativePlaylist {
  const playlist = createCollaborativePlaylist("Alex and Sam's requests");
  const pending = addSongSuggestion(playlist, {
    id: "pending-song",
    title: "Pending song",
    artist: "Guest artist",
    moment_id: "reception",
    note: "A guest note",
    service_url: "https://music.example/pending",
    contributor: { id: "guest-one", name: "Casey" },
    created_at: "2026-10-17T12:00:00.000Z",
  });
  const approved = addSongSuggestion(playlist, {
    id: "approved-song",
    title: "Approved song",
    artist: "DJ artist",
    moment_id: "dinner",
    contributor: { id: "guest-two", name: "Drew" },
    created_at: "2026-10-17T12:01:00.000Z",
  });
  moderateSong(playlist, approved.id, { status: "approved" });
  const rejected = addSongSuggestion(playlist, {
    id: "rejected-song",
    title: "Rejected song",
    artist: "Other artist",
    contributor: { id: "guest-three", name: "Morgan" },
    created_at: "2026-10-17T12:02:00.000Z",
  });
  moderateSong(playlist, rejected.id, { status: "rejected" });
  pending.voter_ids = ["guest-two"];
  return playlist;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("playlist editor", () => {
  it("creates a playlist, edits moments, adds songs, and exports the DJ brief", async () => {
    const createObjectUrl = vi.fn(() => "blob:playlist");
    const revokeObjectUrl = vi.fn();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: createObjectUrl,
      revokeObjectURL: revokeObjectUrl,
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    render(<PlaylistHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Create playlist" }));
    expect(screen.getByRole("heading", { name: "Music" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Song title"), {
      target: { value: "First added song" },
    });
    fireEvent.change(screen.getByLabelText("Song artist"), {
      target: { value: "An artist" },
    });
    fireEvent.change(screen.getByLabelText("Song note"), {
      target: { value: "Play this loudly" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add song" }));
    expect(
      screen.getByRole("heading", { name: "First added song" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Play this loudly")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("New playlist moment"), {
      target: { value: "After party" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(
      screen.getByText("After party", { selector: "span" }),
    ).toBeInTheDocument();
    const moment = closest(
      screen.getByText("After party", { selector: "span" }),
      "div",
    );
    fireEvent.click(within(moment).getByRole("button", { name: "Visible" }));
    expect(
      within(moment).getByRole("button", { name: "Hidden" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "CSV" }));
    fireEvent.click(screen.getByRole("button", { name: "Document" }));
    expect(createObjectUrl).toHaveBeenCalledTimes(2);
    expect(click).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(revokeObjectUrl).toHaveBeenCalledTimes(2));
  });

  it("moderates, arranges, merges, publishes, copies, and refreshes songs", async () => {
    const playlist = playlistWithStatuses();
    const sharing = {
      id: "playlist-public-id",
      guest_token: "guest-token-value-1234",
      admin_token: "admin-token-value-1234",
    };
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === "POST")
          return Response.json(sharing, { status: 201 });
        if (url.includes("?admin=1")) {
          const remote = structuredClone(playlist);
          remote.title = "Refreshed playlist";
          return Response.json(remote);
        }
        return Response.json(playlist);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(<PlaylistHarness initialPlaylist={playlist} />);
    expect(screen.getByText("1 vote")).toBeInTheDocument();

    const pendingCard = closest(
      screen.getByRole("heading", { name: "Pending song" }),
      "article",
    );
    fireEvent.click(
      within(pendingCard).getByRole("button", { name: "Approve" }),
    );
    const rejectedCard = closest(
      screen.getByRole("heading", { name: "Rejected song" }),
      "article",
    );
    fireEvent.click(
      within(rejectedCard).getByRole("button", { name: "Return to review" }),
    );

    const approvedCard = closest(
      screen.getByRole("heading", { name: "Approved song" }),
      "article",
    );
    fireEvent.change(
      within(approvedCard).getByLabelText("DJ priority for Approved song"),
      { target: { value: "must_play" } },
    );
    fireEvent.change(
      within(approvedCard).getByLabelText("Moment for Approved song"),
      { target: { value: "arrivals" } },
    );
    fireEvent.click(
      within(approvedCard).getByRole("button", { name: "Hide from guests" }),
    );
    fireEvent.click(
      within(approvedCard).getByRole("button", {
        name: "Move Approved song up",
      }),
    );
    fireEvent.change(
      within(approvedCard).getByLabelText("Merge target for Approved song"),
      { target: { value: "pending-song" } },
    );
    fireEvent.click(
      within(approvedCard).getByRole("button", { name: "Merge" }),
    );
    expect(
      screen.queryByRole("heading", { name: "Approved song" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Create guest link" }));
    expect(await screen.findByText("Guest link created")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy guest link" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    expect(await screen.findByText("Guest link copied")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Publish changes" }));
    expect(
      await screen.findByText("Guest playlist updated"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Get guest changes" }));
    expect(
      await screen.findByText("Guest suggestions and votes loaded"),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("shows remote publishing failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 500 })),
    );
    render(<PlaylistHarness initialPlaylist={createCollaborativePlaylist()} />);
    fireEvent.click(screen.getByRole("button", { name: "Create guest link" }));
    expect(
      await screen.findByText("Could not create the guest link"),
    ).toBeInTheDocument();
  });
});
