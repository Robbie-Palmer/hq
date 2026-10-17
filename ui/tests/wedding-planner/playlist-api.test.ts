import { describe, expect, it } from "vitest";
import {
  addSongSuggestion,
  createCollaborativePlaylist,
  moderateSong,
} from "wedding-planner-domain";
import {
  onRequest,
  type PlaylistKv,
} from "../../../functions/api/wedding-playlists/[[path]]";

class MemoryKv implements PlaylistKv {
  values = new Map<string, string>();

  async get(key: string): Promise<string | null>;
  async get<T>(key: string, type: "json"): Promise<T | null>;
  async get<T>(key: string, type?: "json"): Promise<T | string | null> {
    const value = this.values.get(key);
    if (value === undefined) return null;
    return type === "json" ? (JSON.parse(value) as T) : value;
  }

  async put(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }
}

function request(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
): Request {
  return new Request(`https://example.test/api/wedding-playlists/${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "cf-connecting-ip": "192.0.2.10",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe("wedding playlist API", () => {
  it("keeps admin data private while accepting deduplicated guest suggestions", async () => {
    const kv = new MemoryKv();
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

    for (const [name, artist] of [
      ["Crazy in Love", "Beyoncé"],
      ["Crazy In Love", "Beyonce feat Jay-Z"],
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
              id: `guest-${artist}`,
              name: artist,
            },
          },
          created.guest_token,
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

    const forbidden = await call(
      request("GET", created.id, undefined, "wrong-token-value"),
      created.id,
    );
    expect(forbidden.status).toBe(403);
  });
});
