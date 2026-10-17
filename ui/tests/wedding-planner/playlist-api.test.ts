import { describe, expect, it } from "vitest";
import {
  addSongSuggestion,
  createCollaborativePlaylist,
  moderateSong,
} from "wedding-planner-domain";
import {
  onRequest,
  type PlaylistBucket,
} from "../../../functions/api/wedding-playlists/[[path]]";

const GUEST_ONE = "1ecb2993-9471-4d47-85db-5dbf4d68c1e0";
const GUEST_TWO = "c5947a26-e5d8-48af-96cf-98ad9a44e724";

class MemoryBucket implements PlaylistBucket {
  values = new Map<string, string>();

  async get(key: string) {
    const value = this.values.get(key);
    if (value === undefined) return null;
    return {
      async json<T>() {
        return JSON.parse(value) as T;
      },
    };
  }

  async put(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async list({ prefix }: { cursor?: string; prefix: string }) {
    return {
      objects: [...this.values.keys()]
        .filter((key) => key.startsWith(prefix))
        .sort()
        .map((key) => ({ key })),
      truncated: false,
    };
  }
}

function request(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
  guestId = GUEST_ONE,
): Request {
  return new Request(`https://example.test/api/wedding-playlists/${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "X-Wedding-Guest-Id": guestId,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe("wedding playlist API", () => {
  it("keeps admin data private while accepting deduplicated guest suggestions", async () => {
    const kv = new MemoryBucket();
    const call = (incoming: Request, path?: string) =>
      onRequest({
        request: incoming,
        env: { WEDDING_PLAYLISTS: kv },
        params: { path },
      });
    const playlist = createCollaborativePlaylist("Alex and Sam");
    const privateSong = addSongSuggestion(playlist, {
      id: "first-dance",
      title: "Secret song",
      artist: "Artist",
      moment_id: "first-dance",
      contributor: { id: "couple", name: "The couple" },
      created_at: "2026-10-17T12:00:00.000Z",
    });
    moderateSong(playlist, privateSong.id, { status: "approved" });

    const createdResponse = await call(request("POST", "", playlist));
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()) as {
      id: string;
      guest_token: string;
      admin_token: string;
      synced_song_ids: string[];
    };
    const stored = [...kv.values.values()].find((value) =>
      value.includes("adminTokenHash"),
    );
    expect(stored).not.toContain(created.guest_token);
    expect(stored).not.toContain(created.admin_token);

    const guestResponse = await call(
      request("GET", created.id, undefined, created.guest_token),
      created.id,
    );
    const guestView = (await guestResponse.json()) as {
      moments: { id: string }[];
      songs: unknown[];
    };
    expect(guestView.moments.map(({ id }) => id)).not.toContain("first-dance");
    expect(guestView.songs).toEqual([]);

    const privateMomentSuggestion = await call(
      request(
        "POST",
        `${created.id}/suggestions`,
        {
          title: "Another secret",
          artist: "Artist",
          moment_id: "first-dance",
          contributor: { id: "guest-private", name: "Private guest" },
        },
        created.guest_token,
      ),
      `${created.id}/suggestions`,
    );
    expect(privateMomentSuggestion.status).toBe(400);

    for (const [name, artist, guestId] of [
      ["Crazy in Love", "Beyoncé", GUEST_ONE],
      ["Crazy In Love", "Beyonce feat Jay-Z", GUEST_TWO],
    ]) {
      const response = await call(
        request(
          "POST",
          `${created.id}/suggestions`,
          {
            title: name,
            artist,
            moment_id: "reception",
            contributor: {
              name: artist,
            },
          },
          created.guest_token,
          guestId,
        ),
        `${created.id}/suggestions`,
      );
      expect(response.status).toBe(201);
    }

    const refreshed = await call(
      request("GET", created.id, undefined, created.guest_token),
      created.id,
    );
    const refreshedBody = (await refreshed.json()) as {
      songs: { contributors: unknown[] }[];
    };
    expect(refreshedBody.songs).toHaveLength(1);
    expect(refreshedBody.songs[0]?.contributors).toHaveLength(2);
    expect(JSON.stringify(refreshedBody)).not.toContain(GUEST_ONE);
    expect(JSON.stringify(refreshedBody)).not.toContain(GUEST_TWO);
    const suggestionEvents = [...kv.values.entries()]
      .filter(([key]) => key.includes(":events:"))
      .map(
        ([, value]) =>
          JSON.parse(value) as { suggestion: { id: string }; type: string },
      );
    expect(suggestionEvents).toHaveLength(2);
    expect(
      new Set(suggestionEvents.map(({ suggestion }) => suggestion.id)),
    ).toHaveProperty("size", 1);

    const stalePublish = await call(
      request(
        "PUT",
        created.id,
        { playlist, removed_song_ids: [] },
        created.admin_token,
      ),
      created.id,
    );
    const published = (await stalePublish.json()) as { songs: unknown[] };
    expect(published.songs).toHaveLength(2);

    const adminPlaylist = (await (
      await call(
        request("GET", `${created.id}?admin=1`, undefined, created.admin_token),
        created.id,
      )
    ).json()) as ReturnType<typeof createCollaborativePlaylist>;
    const guestSong = adminPlaylist.songs.find(
      ({ title }) => title === "Crazy in Love",
    );
    expect(guestSong).toBeDefined();
    const removed = await call(
      request(
        "PUT",
        created.id,
        {
          playlist: {
            ...adminPlaylist,
            songs: adminPlaylist.songs.filter(({ id }) => id !== guestSong?.id),
          },
          removed_song_ids: guestSong ? [guestSong.id] : [],
        },
        created.admin_token,
      ),
      created.id,
    );
    expect(
      ((await removed.json()) as { songs: { title: string }[] }).songs,
    ).not.toContainEqual(expect.objectContaining({ title: "Crazy in Love" }));

    const forbidden = await call(
      request("GET", created.id, undefined, "wrong-token-value"),
      created.id,
    );
    expect(forbidden.status).toBe(403);
  });

  it("authorizes couple updates, records votes, and rejects malformed routes", async () => {
    const kv = new MemoryBucket();
    const call = (incoming: Request, path?: string | string[]) =>
      onRequest({
        request: incoming,
        env: { WEDDING_PLAYLISTS: kv },
        params: { path },
      });
    const playlist = createCollaborativePlaylist("Alex and Sam");
    const song = addSongSuggestion(playlist, {
      id: "vote-song",
      title: "Vote song",
      artist: "Artist",
      moment_id: "reception",
      contributor: { id: "guest-owner", name: "Guest" },
      created_at: "2026-10-17T12:00:00.000Z",
    });

    const createdResponse = await call(request("POST", "", playlist));
    const created = (await createdResponse.json()) as {
      id: string;
      guest_token: string;
      admin_token: string;
    };
    const adminView = await call(
      request("GET", `${created.id}?admin=1`, undefined, created.admin_token),
      created.id,
    );
    expect(adminView.status).toBe(200);

    const forbiddenUpdate = await call(
      request(
        "PUT",
        created.id,
        { playlist, removed_song_ids: [] },
        created.guest_token,
      ),
      created.id,
    );
    expect(forbiddenUpdate.status).toBe(403);
    const invalidUpdate = await call(
      request("PUT", created.id, {}, created.admin_token),
      created.id,
    );
    expect(invalidUpdate.status).toBe(400);
    const updated = await call(
      request(
        "PUT",
        created.id,
        { playlist, removed_song_ids: [] },
        created.admin_token,
      ),
      created.id,
    );
    expect(updated.status).toBe(200);

    const forbiddenVote = await call(
      request(
        "POST",
        `${created.id}/votes`,
        { song_id: song.id, selected: true },
        created.admin_token,
      ),
      `${created.id}/votes`,
    );
    expect(forbiddenVote.status).toBe(403);
    const invalidVote = await call(
      request(
        "POST",
        `${created.id}/votes`,
        { song_id: "", selected: true },
        created.guest_token,
      ),
      `${created.id}/votes`,
    );
    expect(invalidVote.status).toBe(400);
    const missingVote = await call(
      request(
        "POST",
        `${created.id}/votes`,
        { song_id: "missing", selected: true },
        created.guest_token,
      ),
      `${created.id}/votes`,
    );
    expect(missingVote.status).toBe(404);
    const voted = await call(
      request(
        "POST",
        `${created.id}/votes`,
        { song_id: song.id, selected: true },
        created.guest_token,
      ),
      `${created.id}/votes`,
    );
    expect(voted.status).toBe(200);
    const publishAfterVote = await call(
      request(
        "PUT",
        created.id,
        { playlist, removed_song_ids: [] },
        created.admin_token,
      ),
      created.id,
    );
    expect(
      ((await publishAfterVote.json()) as { songs: { voter_ids: string[] }[] })
        .songs[0]?.voter_ids,
    ).toEqual([GUEST_ONE]);

    expect(
      (
        await call(request("GET", `${created.id}/unknown`), [
          created.id,
          "unknown",
        ])
      ).status,
    ).toBe(404);
    expect(
      (
        await call(request("GET", `${created.id}/votes/extra`), [
          created.id,
          "votes",
          "extra",
        ])
      ).status,
    ).toBe(404);
    expect((await call(request("GET", ""))).status).toBe(404);

    const malformed = new Request(
      "https://example.test/api/wedding-playlists/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      },
    );
    expect((await call(malformed)).status).toBe(400);
    const failed = await onRequest({
      request: request("GET", "missing"),
      env: {
        WEDDING_PLAYLISTS: {
          get: async () => {
            throw new Error("R2 unavailable");
          },
          put: async () => {},
          list: async () => ({ objects: [], truncated: false }),
        },
      },
      params: { path: "missing" },
    });
    expect(failed.status).toBe(500);
  });

  it("reads paginated R2 events and ignores objects removed between list and get", async () => {
    const bucket = new MemoryBucket();
    const call = (incoming: Request, path?: string) =>
      onRequest({
        request: incoming,
        env: { WEDDING_PLAYLISTS: bucket },
        params: { path },
      });
    const playlist = createCollaborativePlaylist("Alex and Sam");
    const created = (await (
      await call(request("POST", "", playlist))
    ).json()) as {
      guest_token: string;
      id: string;
    };
    await call(
      request(
        "POST",
        `${created.id}/suggestions`,
        {
          artist: "Artist",
          contributor: { name: "Guest" },
          moment_id: "reception",
          title: "Song",
        },
        created.guest_token,
      ),
      `${created.id}/suggestions`,
    );
    const eventKey = [...bucket.values.keys()].find((key) =>
      key.includes(":events:"),
    );
    expect(eventKey).toBeDefined();
    let pages = 0;
    bucket.list = async ({ cursor, prefix }) => {
      pages += 1;
      return cursor
        ? { objects: [], truncated: false }
        : {
            cursor: "next",
            objects: [
              { key: eventKey ?? "" },
              { key: `${prefix}removed-object` },
            ],
            truncated: true,
          };
    };

    const response = await call(
      request("GET", created.id, undefined, created.guest_token),
      created.id,
    );
    expect(response.status).toBe(200);
    expect(
      ((await response.json()) as { songs: unknown[] }).songs,
    ).toHaveLength(1);
    expect(pages).toBe(2);
    expect((await call(request("GET", "missing"), "missing")).status).toBe(404);
  });
});
