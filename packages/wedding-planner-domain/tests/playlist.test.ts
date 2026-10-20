import { describe, expect, it } from "vitest";
import {
  addSongSuggestion,
  createCollaborativePlaylist,
  guestPlaylist,
  likelyDuplicateSongs,
  mergeSongs,
  moderateSong,
  moveSong,
  playlistDjBriefCsv,
  playlistDjBriefMarkdown,
  voteForSong,
} from "../src";

function addSong(
  playlist: ReturnType<typeof createCollaborativePlaylist>,
  id: string,
  title: string,
  artist: string,
  contributorId = "guest-a",
) {
  return addSongSuggestion(playlist, {
    id,
    title,
    artist,
    contributor: { id: contributorId, name: contributorId },
    created_at: "2026-10-17T12:00:00.000Z",
  });
}

describe("collaborative playlist", () => {
  it("folds normalized duplicate suggestions into one song and keeps attribution", () => {
    const playlist = createCollaborativePlaylist();
    addSong(playlist, "one", "Crazy in Love", "Beyoncé", "alex");
    const duplicate = addSong(
      playlist,
      "two",
      "Crazy In Love",
      "Beyonce feat. Jay-Z",
      "sam",
    );
    expect(playlist.songs).toHaveLength(1);
    expect(duplicate.contributors.map(({ id }) => id)).toEqual(["alex", "sam"]);
    expect(likelyDuplicateSongs(playlist, "crazy-in-love", "BEYONCE")).toEqual([
      duplicate,
    ]);
  });

  it("keeps featured tracks and Unicode song identities distinct", () => {
    const playlist = createCollaborativePlaylist();
    addSong(
      playlist,
      "stay-laroi",
      "Stay (feat. Justin Bieber)",
      "The Kid LAROI",
    );
    addSong(playlist, "stay-rihanna", "Stay (feat. Mikky Ekko)", "Rihanna");
    addSong(playlist, "unicode-one", "光", "宇多田ヒカル");
    addSong(playlist, "unicode-two", "夜に駆ける", "YOASOBI");
    expect(playlist.songs).toHaveLength(4);
  });

  it("replays a suggestion idempotently after planner edits", () => {
    const playlist = createCollaborativePlaylist();
    const input = {
      id: "stable-song",
      title: "Original title",
      artist: "Original artist",
      contributor: { id: "guest-one", name: "Guest one" },
    };
    const song = addSongSuggestion(playlist, input);
    song.title = "Planner-corrected title";

    addSongSuggestion(playlist, {
      ...input,
      contributor: { id: "guest-two", name: "Guest two" },
    });

    expect(playlist.songs).toHaveLength(1);
    expect(playlist.songs[0]?.title).toBe("Planner-corrected title");
    expect(playlist.songs[0]?.contributors).toHaveLength(2);
  });

  it("supports votes, manual merges, moderation, and ordering", () => {
    const playlist = createCollaborativePlaylist();
    const first = addSong(playlist, "one", "Song one", "Artist");
    const second = addSong(playlist, "two", "Song two", "Artist", "guest-b");
    voteForSong(playlist, second.id, "guest-a", true);
    moderateSong(playlist, second.id, {
      status: "approved",
      priority: "must_play",
    });
    moderateSong(playlist, first.id, { status: "approved" });
    moveSong(playlist, second.id, -1);
    expect(playlist.songs.map(({ id }) => id)).toEqual([second.id, first.id]);
    mergeSongs(playlist, second.id, first.id);
    expect(playlist.songs).toHaveLength(1);
    expect(playlist.songs[0]).toMatchObject({
      id: second.id,
      voter_ids: ["guest-a"],
      priority: "must_play",
    });
    expect(playlist.songs[0]?.contributors).toHaveLength(2);
  });

  it("moves songs past entries outside the approved DJ list", () => {
    const playlist = createCollaborativePlaylist();
    const first = addSong(playlist, "one", "Song one", "Artist");
    addSong(playlist, "pending", "Pending song", "Artist");
    const second = addSong(playlist, "two", "Song two", "Artist");
    moderateSong(playlist, first.id, { status: "approved" });
    moderateSong(playlist, second.id, { status: "approved" });
    moveSong(playlist, second.id, -1);
    expect(playlist.songs.map(({ id }) => id)).toEqual([
      second.id,
      "pending",
      first.id,
    ]);
  });

  it("keeps private moments, private songs, rejected songs, and do-not-play entries out of the guest view", () => {
    const playlist = createCollaborativePlaylist();
    const dance = addSong(playlist, "dance", "Private dance", "Artist");
    moderateSong(playlist, dance.id, {
      moment_id: "first-dance",
      status: "approved",
    });
    const rejected = addSong(playlist, "rejected", "Rejected", "Artist");
    moderateSong(playlist, rejected.id, { status: "rejected" });
    const banned = addSong(playlist, "banned", "Banned", "Artist");
    moderateSong(playlist, banned.id, { priority: "do_not_play" });
    expect(guestPlaylist(playlist, "guest-a").songs).toEqual([]);
    expect(
      guestPlaylist(playlist, "guest-a").moments.map(({ id }) => id),
    ).not.toContain("first-dance");
  });

  it("keeps contributor and voter identifiers out of the guest projection", () => {
    const playlist = createCollaborativePlaylist();
    const song = addSong(playlist, "one", "Song one", "Artist");
    voteForSong(playlist, song.id, "guest-voter", true);
    const projected = guestPlaylist(playlist, "guest-voter");
    expect(projected.songs[0]).toMatchObject({
      contributors: [{ name: "guest-a" }],
      vote_count: 1,
      voted_by_you: true,
    });
    expect(JSON.stringify(projected)).not.toContain("guest-voter");
  });

  it("exports approved choices and do-not-play entries for the DJ", () => {
    const playlist = createCollaborativePlaylist("Alex and Sam");
    const approved = addSong(playlist, "one", "Song, one", "Artist");
    moderateSong(playlist, approved.id, {
      status: "approved",
      priority: "must_play",
      moment_id: "dinner",
    });
    const banned = addSong(playlist, "two", "No thanks", "Artist");
    moderateSong(playlist, banned.id, { priority: "do_not_play" });
    expect(playlistDjBriefCsv(playlist)).toContain(
      'Dinner,must_play,"Song, one",Artist',
    );
    expect(playlistDjBriefCsv(playlist)).toContain(
      "Reception,do_not_play,No thanks,Artist",
    );
    expect(playlistDjBriefMarkdown(playlist)).toContain(
      "- Song, one by Artist [MUST PLAY]",
    );
    expect(playlistDjBriefMarkdown(playlist)).toContain(
      "## Do not play\n\n- No thanks by Artist",
    );
  });

  it("neutralizes formulas in CSV fields supplied by guests", () => {
    const playlist = createCollaborativePlaylist();
    const song = addSong(playlist, "formula", '=HYPERLINK("bad")', "+1");
    moderateSong(playlist, song.id, { status: "approved" });
    expect(playlistDjBriefCsv(playlist)).toContain(
      `"'=HYPERLINK(""bad"")",'+1`,
    );
  });
});
