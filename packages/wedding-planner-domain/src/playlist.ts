import { z } from "zod";

const trimmedText = z.string().trim().min(1);
const httpUrl = z
  .url()
  .refine(
    (value) => value.startsWith("http://") || value.startsWith("https://"),
    "Use an HTTP or HTTPS link",
  );
const optionalUrl = z.union([httpUrl, z.literal("")]).default("");

export const playlistMomentSchema = z.object({
  id: trimmedText,
  name: trimmedText,
  private: z.boolean().default(false),
});
export type PlaylistMoment = z.infer<typeof playlistMomentSchema>;

export const songContributorSchema = z.object({
  id: trimmedText,
  name: trimmedText,
});
export type SongContributor = z.infer<typeof songContributorSchema>;

export const songSuggestionSchema = z.object({
  id: trimmedText,
  title: trimmedText,
  artist: trimmedText,
  service_url: optionalUrl,
  moment_id: z.string().default("reception"),
  note: z.string().trim().max(500).default(""),
  contributors: z.array(songContributorSchema).min(1),
  voter_ids: z.array(trimmedText).default([]),
  status: z.enum(["pending", "approved", "rejected"]).default("pending"),
  priority: z.enum(["normal", "must_play", "do_not_play"]).default("normal"),
  private: z.boolean().default(false),
  order: z.number().int().nonnegative().default(0),
  created_at: z.iso.datetime(),
});
export type SongSuggestion = z.infer<typeof songSuggestionSchema>;

export const playlistSharingSchema = z.object({
  id: trimmedText,
  guest_token: trimmedText,
  admin_token: trimmedText,
  synced_song_ids: z.array(trimmedText).default([]),
});
export type PlaylistSharing = z.infer<typeof playlistSharingSchema>;

export const collaborativePlaylistSchema = z.object({
  title: trimmedText.default("Our wedding playlist"),
  moments: z.array(playlistMomentSchema).min(1),
  songs: z.array(songSuggestionSchema).default([]),
  sharing: playlistSharingSchema.nullable().default(null),
});
export type CollaborativePlaylist = z.infer<typeof collaborativePlaylistSchema>;

export const guestSongSuggestionSchema = songSuggestionSchema
  .omit({ contributors: true, voter_ids: true })
  .extend({
    contributors: z.array(z.object({ name: trimmedText })).min(1),
    vote_count: z.number().int().nonnegative(),
    voted_by_you: z.boolean(),
  });
export type GuestSongSuggestion = z.infer<typeof guestSongSuggestionSchema>;

export const guestPlaylistSchema = collaborativePlaylistSchema
  .omit({ sharing: true, songs: true })
  .extend({
    sharing: z.null(),
    songs: z.array(guestSongSuggestionSchema),
  });
export type GuestPlaylist = z.infer<typeof guestPlaylistSchema>;

export const DEFAULT_PLAYLIST_MOMENTS: PlaylistMoment[] = [
  { id: "reception", name: "Reception", private: false },
  { id: "arrivals", name: "Arrivals", private: false },
  { id: "dinner", name: "Dinner", private: false },
  { id: "first-dance", name: "First dance", private: true },
  { id: "last-song", name: "Last song", private: false },
];

export function createCollaborativePlaylist(
  title = "Our wedding playlist",
): CollaborativePlaylist {
  return collaborativePlaylistSchema.parse({
    title,
    moments: DEFAULT_PLAYLIST_MOMENTS,
    songs: [],
  });
}

function normalizeSongPart(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en")
    .replace(/[[(]\s*(?:feat|featuring|ft)\.?\s+[^\])]*[\])]/giu, "")
    .replace(/\s+(?:feat|featuring|ft)\.?\s+.*$/iu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeSongIdentity(title: string, artist: string): string {
  const normalizedTitle = normalizeSongPart(title);
  const normalizedArtist = normalizeSongPart(artist);
  return normalizedTitle && normalizedArtist
    ? `${normalizedTitle}\u0000${normalizedArtist}`
    : "";
}

export function likelyDuplicateSongs(
  playlist: CollaborativePlaylist,
  title: string,
  artist: string,
): SongSuggestion[] {
  const identity = normalizeSongIdentity(title, artist);
  if (!identity) return [];
  return playlist.songs.filter((song) => {
    const candidate = normalizeSongIdentity(song.title, song.artist);
    return candidate.length > 0 && candidate === identity;
  });
}

export interface NewSongSuggestion {
  id: string;
  title: string;
  artist: string;
  service_url?: string;
  moment_id?: string;
  note?: string;
  contributor: SongContributor;
  created_at?: string;
}

export function addSongSuggestion(
  playlist: CollaborativePlaylist,
  input: NewSongSuggestion,
): SongSuggestion {
  if (
    input.moment_id &&
    !playlist.moments.some((moment) => moment.id === input.moment_id)
  )
    throw new Error("Choose a playlist moment that still exists");
  const existing = playlist.songs.find(({ id }) => id === input.id);
  if (existing) {
    if (!existing.contributors.some(({ id }) => id === input.contributor.id))
      existing.contributors.push(
        songContributorSchema.parse(input.contributor),
      );
    if (input.note && !existing.note) existing.note = input.note.trim();
    return existing;
  }
  const duplicate = likelyDuplicateSongs(
    playlist,
    input.title,
    input.artist,
  )[0];
  if (duplicate) {
    if (!duplicate.contributors.some(({ id }) => id === input.contributor.id))
      duplicate.contributors.push(
        songContributorSchema.parse(input.contributor),
      );
    if (input.note && !duplicate.note) duplicate.note = input.note.trim();
    return duplicate;
  }
  const song = songSuggestionSchema.parse({
    id: input.id,
    title: input.title,
    artist: input.artist,
    service_url: input.service_url,
    moment_id: input.moment_id,
    note: input.note,
    contributors: [input.contributor],
    order: playlist.songs.length,
    created_at: input.created_at ?? new Date().toISOString(),
  });
  playlist.songs.push(song);
  return song;
}

function requireSong(
  playlist: CollaborativePlaylist,
  songId: string,
): SongSuggestion {
  const song = playlist.songs.find(({ id }) => id === songId);
  if (!song) throw new Error("That song is no longer in the playlist");
  return song;
}

export function voteForSong(
  playlist: CollaborativePlaylist,
  songId: string,
  voterId: string,
  selected: boolean,
): void {
  const song = requireSong(playlist, songId);
  song.voter_ids = song.voter_ids.filter((id) => id !== voterId);
  if (selected) song.voter_ids.push(trimmedText.parse(voterId));
}

export function moderateSong(
  playlist: CollaborativePlaylist,
  songId: string,
  change: Partial<
    Pick<SongSuggestion, "status" | "priority" | "private" | "moment_id">
  >,
): void {
  const song = requireSong(playlist, songId);
  if (
    change.moment_id !== undefined &&
    !playlist.moments.some(({ id }) => id === change.moment_id)
  )
    throw new Error("Choose a playlist moment that still exists");
  Object.assign(song, change);
}

export function mergeSongs(
  playlist: CollaborativePlaylist,
  targetId: string,
  duplicateId: string,
): void {
  if (targetId === duplicateId) throw new Error("Choose two different songs");
  const target = requireSong(playlist, targetId);
  const duplicate = requireSong(playlist, duplicateId);
  target.contributors = uniqueById([
    ...target.contributors,
    ...duplicate.contributors,
  ]);
  target.voter_ids = [
    ...new Set([...target.voter_ids, ...duplicate.voter_ids]),
  ];
  if (!target.note) target.note = duplicate.note;
  if (!target.service_url) target.service_url = duplicate.service_url;
  playlist.songs = playlist.songs.filter(({ id }) => id !== duplicateId);
  normalizeSongOrder(playlist);
}

export function moveSong(
  playlist: CollaborativePlaylist,
  songId: string,
  direction: -1 | 1,
): void {
  const ordered = [...playlist.songs].sort((a, b) => a.order - b.order);
  const index = ordered.findIndex(({ id }) => id === songId);
  if (index < 0) throw new Error("That song is no longer in the playlist");
  const status = ordered[index]?.status;
  let destination = index + direction;
  while (
    destination >= 0 &&
    destination < ordered.length &&
    ordered[destination]?.status !== status
  )
    destination += direction;
  if (destination < 0 || destination >= ordered.length) return;
  const current = ordered[index];
  const next = ordered[destination];
  if (!current || !next) return;
  [ordered[index], ordered[destination]] = [next, current];
  ordered.forEach((song, order) => {
    song.order = order;
  });
  playlist.songs = ordered;
}

export function guestPlaylist(
  playlist: CollaborativePlaylist,
  voterId = "",
): GuestPlaylist {
  const privateMoments = new Set(
    playlist.moments.filter((moment) => moment.private).map(({ id }) => id),
  );
  const visibleSongs = playlist.songs.filter(
    (song) =>
      song.status !== "rejected" &&
      song.priority !== "do_not_play" &&
      !song.private &&
      !privateMoments.has(song.moment_id),
  );
  return guestPlaylistSchema.parse({
    title: playlist.title,
    sharing: null,
    moments: playlist.moments.filter((moment) => !moment.private),
    songs: visibleSongs.map(({ contributors, voter_ids, ...song }) => ({
      ...song,
      contributors: contributors.map(({ name }) => ({ name })),
      vote_count: voter_ids.length,
      voted_by_you: voterId ? voter_ids.includes(voterId) : false,
    })),
  });
}

function approvedSongs(playlist: CollaborativePlaylist): SongSuggestion[] {
  return [...playlist.songs]
    .filter(
      (song) => song.status === "approved" || song.priority === "do_not_play",
    )
    .sort((a, b) => a.order - b.order);
}

export function playlistDjBriefCsv(playlist: CollaborativePlaylist): string {
  const momentNames = new Map(
    playlist.moments.map((moment) => [moment.id, moment.name]),
  );
  const rows = [
    [
      "moment",
      "priority",
      "title",
      "artist",
      "notes",
      "suggested_by",
      "votes",
      "service_url",
    ],
    ...approvedSongs(playlist).map((song) => [
      momentNames.get(song.moment_id) ?? song.moment_id,
      song.priority,
      song.title,
      song.artist,
      song.note,
      song.contributors.map(({ name }) => name).join("; "),
      String(song.voter_ids.length),
      song.service_url,
    ]),
  ];
  return rows.map((row) => row.map(csvValue).join(",")).join("\n");
}

export function playlistDjBriefMarkdown(
  playlist: CollaborativePlaylist,
): string {
  const sections = playlist.moments.map((moment) => {
    const songs = approvedSongs(playlist).filter(
      (song) => song.moment_id === moment.id && song.priority !== "do_not_play",
    );
    const lines = songs.length
      ? songs.map((song) => {
          const priority = song.priority === "must_play" ? " [MUST PLAY]" : "";
          const note = song.note ? `, ${song.note}` : "";
          return `- ${song.title} by ${song.artist}${priority}${note}`;
        })
      : ["- No approved songs"];
    return `## ${moment.name}\n\n${lines.join("\n")}`;
  });
  const doNotPlay = approvedSongs(playlist)
    .filter((song) => song.priority === "do_not_play")
    .map((song) => `- ${song.title} by ${song.artist}`);
  return [
    `# ${playlist.title}`,
    ...sections,
    "## Do not play",
    doNotPlay.length ? doNotPlay.join("\n") : "- None",
  ].join("\n\n");
}

function normalizeSongOrder(playlist: CollaborativePlaylist): void {
  [...playlist.songs]
    .sort((a, b) => a.order - b.order)
    .forEach((song, order) => {
      song.order = order;
    });
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

function csvValue(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}
