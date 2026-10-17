import {
  addSongSuggestion,
  collaborativePlaylistSchema,
  createCollaborativePlaylist,
  guestPlaylist,
  voteForSong,
  type CollaborativePlaylist,
} from "wedding-planner-domain";
import { z } from "zod";

export interface PlaylistKv {
  get(key: string): Promise<string | null>;
  get<T>(key: string, type: "json"): Promise<T | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl: number },
  ): Promise<void>;
}

interface Env {
  WEDDING_PLAYLISTS: PlaylistKv;
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
  updatedAt: string;
}

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
    id: z.string().trim().min(8).max(80),
    name: z.string().trim().min(1).max(80),
  }),
});

const voteSchema = z.object({
  song_id: z.string().trim().min(1),
  voter_id: z.string().trim().min(8).max(80),
  selected: z.boolean(),
});

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
  return btoa(String.fromCharCode(...data))
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
  return env.WEDDING_PLAYLISTS.get<StoredPlaylist>(`playlist:${id}`, "json");
}

async function writeStored(
  env: Env,
  id: string,
  stored: StoredPlaylist,
): Promise<void> {
  stored.updatedAt = new Date().toISOString();
  await env.WEDDING_PLAYLISTS.put(`playlist:${id}`, JSON.stringify(stored));
}

async function suppliedToken(request: Request): Promise<string> {
  const bearer = request.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1];
  return bearer ?? new URL(request.url).searchParams.get("token") ?? "";
}

async function authorized(
  request: Request,
  expectedHash: string,
): Promise<boolean> {
  const supplied = await suppliedToken(request);
  return supplied.length >= 16 && (await tokenHash(supplied)) === expectedHash;
}

async function enforceRateLimit(
  context: Context,
  scope: string,
  limit: number,
): Promise<Response | null> {
  const ip = context.request.headers.get("cf-connecting-ip") ?? "unknown";
  const window = Math.floor(Date.now() / 600_000);
  const key = `rate:${scope}:${ip}:${window}`;
  const current = Number((await context.env.WEDDING_PLAYLISTS.get(key)) ?? "0");
  if (current >= limit) return error("Too many requests. Try again later.", 429);
  await context.env.WEDDING_PLAYLISTS.put(key, String(current + 1), {
    expirationTtl: 660,
  });
  return null;
}

async function createPlaylist(context: Context): Promise<Response> {
  const limited = await enforceRateLimit(context, "create", 5);
  if (limited) return limited;
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
    updatedAt: new Date().toISOString(),
  });
  return json({ id, guest_token: guestToken, admin_token: adminToken }, 201);
}

async function getPlaylist(
  context: Context,
  stored: StoredPlaylist,
): Promise<Response> {
  const admin = new URL(context.request.url).searchParams.get("admin") === "1";
  const expected = admin ? stored.adminTokenHash : stored.guestTokenHash;
  if (!(await authorized(context.request, expected)))
    return error("This playlist link is invalid or has been replaced.", 403);
  return json(admin ? stored.playlist : guestPlaylist(stored.playlist));
}

async function replacePlaylist(
  context: Context,
  id: string,
  stored: StoredPlaylist,
): Promise<Response> {
  if (!(await authorized(context.request, stored.adminTokenHash)))
    return error("Only the couple can update this playlist.", 403);
  const parsed = collaborativePlaylistSchema.safeParse(
    await context.request.json(),
  );
  if (!parsed.success) return error("The playlist details are invalid.", 400);
  stored.playlist = { ...parsed.data, sharing: null };
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
  const limited = await enforceRateLimit(context, `suggest:${id}`, 30);
  if (limited) return limited;
  const parsed = suggestionSchema.safeParse(await context.request.json());
  if (!parsed.success) return error("Check the song details and try again.", 400);
  const selectedMoment = stored.playlist.moments.find(
    ({ id: momentId }) => momentId === parsed.data.moment_id,
  );
  if (!selectedMoment || selectedMoment.private)
    return error("Choose a moment shown on the guest playlist.", 400);
  const contributorCount = stored.playlist.songs.filter((song) =>
    song.contributors.some(({ id: contributorId }) =>
      contributorId === parsed.data.contributor.id,
    ),
  ).length;
  if (contributorCount >= 20)
    return error("This guest has reached the 20-song suggestion limit.", 429);
  addSongSuggestion(stored.playlist, {
    ...parsed.data,
    id: randomToken(12),
  });
  await writeStored(context.env, id, stored);
  return json(guestPlaylist(stored.playlist), 201);
}

async function vote(
  context: Context,
  id: string,
  stored: StoredPlaylist,
): Promise<Response> {
  if (!(await authorized(context.request, stored.guestTokenHash)))
    return error("This playlist link is invalid or has been replaced.", 403);
  const limited = await enforceRateLimit(context, `vote:${id}`, 120);
  if (limited) return limited;
  const parsed = voteSchema.safeParse(await context.request.json());
  if (!parsed.success) return error("The vote is invalid.", 400);
  try {
    voteForSong(
      stored.playlist,
      parsed.data.song_id,
      parsed.data.voter_id,
      parsed.data.selected,
    );
  } catch {
    return error("That song is no longer available.", 404);
  }
  await writeStored(context.env, id, stored);
  return json(guestPlaylist(stored.playlist));
}

async function routeExistingPlaylist(
  context: Context,
  id: string,
  action: string | undefined,
  stored: StoredPlaylist,
): Promise<Response> {
  if (!action && context.request.method === "GET")
    return getPlaylist(context, stored);
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
