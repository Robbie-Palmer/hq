import {
  addSongSuggestion,
  collaborativePlaylistSchema,
  createCollaborativePlaylist,
  guestPlaylist,
  normalizeSongIdentity,
  voteForSong,
  type CollaborativePlaylist,
  type NewSongSuggestion,
} from "wedding-planner-domain";
import { z } from "zod";

export interface PlaylistObject {
  json<T>(): Promise<T>;
}

export interface PlaylistBucket {
  get(key: string): Promise<PlaylistObject | null>;
  put(key: string, value: string): Promise<void>;
  list(options: { cursor?: string; prefix: string }): Promise<{
    cursor?: string;
    objects: { key: string }[];
    truncated: boolean;
  }>;
}

interface Env {
  WEDDING_PLAYLISTS: PlaylistBucket;
}

interface Context {
  request: Request;
  env: Env;
  params: { path?: string | string[] };
}

interface StoredPlaylist {
  playlist: CollaborativePlaylist;
  guestTokenHash: string;
  adminTokenHash: string;
  suppressedSongIds?: string[];
  updatedAt: string;
}

type GuestPlaylistEvent =
  | {
      createdAt: string;
      suggestion: NewSongSuggestion;
      type: "suggestion";
    }
  | {
      createdAt: string;
      selected: boolean;
      songId: string;
      type: "vote";
      voterId: string;
    };

const createSchema = z.object({
  title: z.string().trim().min(1).max(120),
  moments: collaborativePlaylistSchema.shape.moments,
  songs: collaborativePlaylistSchema.shape.songs,
});

const suggestionSchema = z.object({
  title: z.string().trim().min(1).max(160),
  artist: z.string().trim().min(1).max(160),
  service_url: z
    .union([
      z.url().refine(
        (value) => value.startsWith("http://") || value.startsWith("https://"),
      ),
      z.literal(""),
    ])
    .default(""),
  moment_id: z.string().trim().min(1),
  note: z.string().trim().max(500).default(""),
  contributor: z.object({
    name: z.string().trim().min(1).max(80),
  }),
});

const voteSchema = z.object({
  song_id: z.string().trim().min(1),
  selected: z.boolean(),
});

const adminUpdateSchema = z.object({
  playlist: collaborativePlaylistSchema,
  removed_song_ids: z.array(z.string().trim().min(1)).max(500).default([]),
});

const guestIdSchema = z.uuid();

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function error(message: string, status: number): Response {
  return json({ error: message }, status);
}

function pathParts(context: Context): string[] {
  const path = context.params.path;
  if (Array.isArray(path)) return path.filter(Boolean);
  return path ? path.split("/").filter(Boolean) : [];
}

function randomToken(bytes = 24): string {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCodePoint(...data))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

async function tokenHash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function readStored(
  env: Env,
  id: string,
): Promise<StoredPlaylist | null> {
  const object = await env.WEDDING_PLAYLISTS.get(`playlist:${id}`);
  return object ? object.json<StoredPlaylist>() : null;
}

async function writeStored(
  env: Env,
  id: string,
  stored: StoredPlaylist,
): Promise<void> {
  stored.updatedAt = new Date().toISOString();
  await env.WEDDING_PLAYLISTS.put(`playlist:${id}`, JSON.stringify(stored));
}

function eventPrefix(id: string): string {
  return `playlist:${id}:events:`;
}

async function readGuestEvents(env: Env, id: string): Promise<GuestPlaylistEvent[]> {
  const events: GuestPlaylistEvent[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.WEDDING_PLAYLISTS.list({
      prefix: eventPrefix(id),
      ...(cursor ? { cursor } : {}),
    });
    const values = await Promise.all(
      page.objects.map(async ({ key }) => {
        const object = await env.WEDDING_PLAYLISTS.get(key);
        return object ? object.json<GuestPlaylistEvent>() : null;
      }),
    );
    events.push(...values.filter((value) => value !== null));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return events.sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) ||
      JSON.stringify(left).localeCompare(JSON.stringify(right)),
  );
}

async function appendGuestEvent(
  env: Env,
  id: string,
  event: GuestPlaylistEvent,
): Promise<void> {
  const key = `${eventPrefix(id)}${event.createdAt}:${randomToken(12)}`;
  await env.WEDDING_PLAYLISTS.put(key, JSON.stringify(event));
}

async function materializePlaylist(
  env: Env,
  id: string,
  stored: StoredPlaylist,
): Promise<CollaborativePlaylist> {
  const playlist = structuredClone(stored.playlist);
  const suppressed = new Set(stored.suppressedSongIds ?? []);
  for (const event of await readGuestEvents(env, id)) {
    if (event.type === "suggestion") {
      if (!suppressed.has(event.suggestion.id))
        addSongSuggestion(playlist, event.suggestion);
      continue;
    }
    try {
      voteForSong(playlist, event.songId, event.voterId, event.selected);
    } catch {
      // Votes for suggestions not yet visible at this edge appear on a later read.
    }
  }
  return playlist;
}

function suppliedToken(request: Request): string {
  const bearer = request.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1];
  return bearer ?? new URL(request.url).searchParams.get("token") ?? "";
}

function suppliedGuestId(request: Request): string | null {
  const parsed = guestIdSchema.safeParse(request.headers.get("x-wedding-guest-id"));
  return parsed.success ? parsed.data : null;
}

async function authorized(
  request: Request,
  expectedHash: string,
): Promise<boolean> {
  const supplied = suppliedToken(request);
  return supplied.length >= 16 && (await tokenHash(supplied)) === expectedHash;
}

async function createPlaylist(context: Context): Promise<Response> {
  const parsed = createSchema.safeParse(await context.request.json());
  if (!parsed.success) return error("The playlist details are invalid.", 400);
  const id = randomToken(12);
  const guestToken = randomToken();
  const adminToken = randomToken(32);
  const playlist = collaborativePlaylistSchema.parse({
    ...createCollaborativePlaylist(parsed.data.title),
    moments: parsed.data.moments,
    songs: parsed.data.songs,
    sharing: null,
  });
  await writeStored(context.env, id, {
    playlist,
    guestTokenHash: await tokenHash(guestToken),
    adminTokenHash: await tokenHash(adminToken),
    suppressedSongIds: [],
    updatedAt: new Date().toISOString(),
  });
  return json(
    {
      id,
      guest_token: guestToken,
      admin_token: adminToken,
      synced_song_ids: playlist.songs.map(({ id: songId }) => songId),
    },
    201,
  );
}

async function getPlaylist(
  context: Context,
  id: string,
  stored: StoredPlaylist,
): Promise<Response> {
  const admin = new URL(context.request.url).searchParams.get("admin") === "1";
  const expected = admin ? stored.adminTokenHash : stored.guestTokenHash;
  if (!(await authorized(context.request, expected)))
    return error("This playlist link is invalid or has been replaced.", 403);
  const playlist = await materializePlaylist(context.env, id, stored);
  if (admin) return json(playlist);
  const guestId = suppliedGuestId(context.request);
  if (!guestId) return error("This guest session is invalid.", 400);
  return json(guestPlaylist(playlist, guestId));
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function mergeAdminPlaylist(
  current: CollaborativePlaylist,
  incoming: CollaborativePlaylist,
  removedSongIds: Set<string>,
): CollaborativePlaylist {
  const currentById = new Map(current.songs.map((song) => [song.id, song]));
  const removedSongs = current.songs.filter(({ id }) => removedSongIds.has(id));
  const transferredContributorIds = new Set(
    removedSongs.flatMap((song) => song.contributors.map(({ id }) => id)),
  );
  const transferredVoterIds = new Set(
    removedSongs.flatMap(({ voter_ids }) => voter_ids),
  );
  const songs = incoming.songs.map((song) => {
    const stored = currentById.get(song.id);
    if (!stored) return song;
    return {
      ...song,
      contributors: [
        ...new Map(
          [
            ...stored.contributors,
            ...song.contributors.filter(({ id }) =>
              transferredContributorIds.has(id),
            ),
          ].map((item) => [item.id, item]),
        ).values(),
      ],
      voter_ids: unique([
        ...stored.voter_ids,
        ...song.voter_ids.filter((id) => transferredVoterIds.has(id)),
      ]),
    };
  });
  const incomingIds = new Set(songs.map(({ id }) => id));
  for (const song of current.songs) {
    if (!incomingIds.has(song.id) && !removedSongIds.has(song.id))
      songs.push({ ...song, order: songs.length });
  }
  return collaborativePlaylistSchema.parse({ ...incoming, songs, sharing: null });
}

async function replacePlaylist(
  context: Context,
  id: string,
  stored: StoredPlaylist,
): Promise<Response> {
  if (!(await authorized(context.request, stored.adminTokenHash)))
    return error("Only the couple can update this playlist.", 403);
  const parsed = adminUpdateSchema.safeParse(await context.request.json());
  if (!parsed.success) return error("The playlist details are invalid.", 400);
  const current = await materializePlaylist(context.env, id, stored);
  const removedSongIds = new Set(parsed.data.removed_song_ids);
  stored.playlist = mergeAdminPlaylist(
    current,
    parsed.data.playlist,
    removedSongIds,
  );
  stored.suppressedSongIds = unique([
    ...(stored.suppressedSongIds ?? []),
    ...removedSongIds,
  ]);
  await writeStored(context.env, id, stored);
  return json(stored.playlist);
}

async function suggestSong(
  context: Context,
  id: string,
  stored: StoredPlaylist,
): Promise<Response> {
  if (!(await authorized(context.request, stored.guestTokenHash)))
    return error("This playlist link is invalid or has been replaced.", 403);
  const guestId = suppliedGuestId(context.request);
  if (!guestId) return error("This guest session is invalid.", 400);
  const parsed = suggestionSchema.safeParse(await context.request.json());
  if (!parsed.success) return error("Check the song details and try again.", 400);
  const playlist = await materializePlaylist(context.env, id, stored);
  const selectedMoment = playlist.moments.find(
    ({ id: momentId }) => momentId === parsed.data.moment_id,
  );
  if (!selectedMoment || selectedMoment.private)
    return error("Choose a moment shown on the guest playlist.", 400);
  const contributorCount = playlist.songs.filter((song) =>
    song.contributors.some(({ id: contributorId }) =>
      contributorId === guestId,
    ),
  ).length;
  if (contributorCount >= 20)
    return error("This guest has reached the 20-song suggestion limit.", 429);
  const identity = normalizeSongIdentity(parsed.data.title, parsed.data.artist);
  const suggestion = {
    ...parsed.data,
    id: identity
      ? `song-${(await tokenHash(identity)).slice(0, 24)}`
      : randomToken(12),
    contributor: { id: guestId, name: parsed.data.contributor.name },
    created_at: new Date().toISOString(),
  } satisfies NewSongSuggestion;
  const song = addSongSuggestion(playlist, suggestion);
  await appendGuestEvent(context.env, id, {
    type: "suggestion",
    suggestion: { ...suggestion, id: song.id },
    createdAt: suggestion.created_at,
  });
  return json(guestPlaylist(playlist, guestId), 201);
}

async function vote(
  context: Context,
  id: string,
  stored: StoredPlaylist,
): Promise<Response> {
  if (!(await authorized(context.request, stored.guestTokenHash)))
    return error("This playlist link is invalid or has been replaced.", 403);
  const guestId = suppliedGuestId(context.request);
  if (!guestId) return error("This guest session is invalid.", 400);
  const parsed = voteSchema.safeParse(await context.request.json());
  if (!parsed.success) return error("The vote is invalid.", 400);
  const playlist = await materializePlaylist(context.env, id, stored);
  try {
    voteForSong(
      playlist,
      parsed.data.song_id,
      guestId,
      parsed.data.selected,
    );
  } catch {
    return error("That song is no longer available.", 404);
  }
  await appendGuestEvent(context.env, id, {
    type: "vote",
    songId: parsed.data.song_id,
    voterId: guestId,
    selected: parsed.data.selected,
    createdAt: new Date().toISOString(),
  });
  return json(guestPlaylist(playlist, guestId));
}

async function routeExistingPlaylist(
  context: Context,
  id: string,
  action: string | undefined,
  stored: StoredPlaylist,
): Promise<Response> {
  if (!action && context.request.method === "GET")
    return getPlaylist(context, id, stored);
  if (!action && context.request.method === "PUT")
    return replacePlaylist(context, id, stored);
  if (action === "suggestions" && context.request.method === "POST")
    return suggestSong(context, id, stored);
  if (action === "votes" && context.request.method === "POST")
    return vote(context, id, stored);
  return error("Playlist endpoint not found.", 404);
}

async function routeRequest(context: Context): Promise<Response> {
  const [id, action, extra] = pathParts(context);
  if (!id && context.request.method === "POST") return createPlaylist(context);
  if (!id || extra) return error("Playlist endpoint not found.", 404);
  const stored = await readStored(context.env, id);
  if (!stored) return error("Playlist not found.", 404);
  return routeExistingPlaylist(context, id, action, stored);
}

export const onRequest = async (context: Context): Promise<Response> => {
  try {
    return await routeRequest(context);
  } catch (cause) {
    if (cause instanceof SyntaxError) return error("Request body is not JSON.", 400);
    return error("The playlist service could not complete this request.", 500);
  }
};
