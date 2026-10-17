"use client";

import {
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  EyeOff,
  Link2,
  ListMusic,
  Plus,
  RefreshCw,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  addSongSuggestion,
  type CollaborativePlaylist,
  collaborativePlaylistSchema,
  createCollaborativePlaylist,
  mergeSongs,
  moderateSong,
  moveSong,
  playlistDjBriefCsv,
  playlistDjBriefMarkdown,
  type SongSuggestion,
} from "wedding-planner-domain";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { WeddingPlanDraft } from "@/lib/wedding-planner/types";

type UpdatePlan = (change: (draft: WeddingPlanDraft) => void) => void;

function download(filename: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function publicLink(sharing: NonNullable<CollaborativePlaylist["sharing"]>) {
  const values = new URLSearchParams({
    id: sharing.id,
    token: sharing.guest_token,
  });
  return `${window.location.origin}/wedding-planner/playlist/#${values}`;
}

function SongActions({
  song,
  playlist,
  onUpdate,
}: Readonly<{
  song: SongSuggestion;
  playlist: CollaborativePlaylist;
  onUpdate: UpdatePlan;
}>) {
  const [mergeTarget, setMergeTarget] = useState("");
  const updateSong = (change: Parameters<typeof moderateSong>[2]): void =>
    onUpdate((draft) => {
      if (draft.playlist) moderateSong(draft.playlist, song.id, change);
    });
  return (
    <div className="playlist-song-actions">
      <label>
        <span>Moment</span>
        <select
          aria-label={`Moment for ${song.title}`}
          value={song.moment_id}
          onChange={(event) => updateSong({ moment_id: event.target.value })}
        >
          {playlist.moments.map((moment) => (
            <option key={moment.id} value={moment.id}>
              {moment.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>DJ priority</span>
        <select
          aria-label={`DJ priority for ${song.title}`}
          value={song.priority}
          onChange={(event) =>
            updateSong({
              priority: event.target.value as SongSuggestion["priority"],
            })
          }
        >
          <option value="normal">Normal</option>
          <option value="must_play">Must play</option>
          <option value="do_not_play">Do not play</option>
        </select>
      </label>
      <Button
        size="sm"
        variant={song.private ? "default" : "outline"}
        onClick={() => updateSong({ private: !song.private })}
      >
        <EyeOff size={14} /> {song.private ? "Hidden" : "Hide from guests"}
      </Button>
      {playlist.songs.length > 1 && (
        <div className="playlist-merge">
          <select
            aria-label={`Merge target for ${song.title}`}
            value={mergeTarget}
            onChange={(event) => setMergeTarget(event.target.value)}
          >
            <option value="">Merge into…</option>
            {playlist.songs
              .filter(({ id }) => id !== song.id)
              .map((target) => (
                <option key={target.id} value={target.id}>
                  {target.title} · {target.artist}
                </option>
              ))}
          </select>
          <Button
            size="sm"
            variant="outline"
            disabled={!mergeTarget}
            onClick={() =>
              onUpdate((draft) => {
                if (draft.playlist)
                  mergeSongs(draft.playlist, mergeTarget, song.id);
              })
            }
          >
            Merge
          </Button>
        </div>
      )}
    </div>
  );
}

function SongCard({
  song,
  playlist,
  onUpdate,
  sortable,
}: Readonly<{
  song: SongSuggestion;
  playlist: CollaborativePlaylist;
  onUpdate: UpdatePlan;
  sortable?: boolean;
}>) {
  return (
    <article className="playlist-song">
      <div className="playlist-song-copy">
        <div>
          <h4>{song.title}</h4>
          <p>{song.artist}</p>
        </div>
        <div className="playlist-badges">
          <Badge variant="outline">
            {song.voter_ids.length}{" "}
            {song.voter_ids.length === 1 ? "vote" : "votes"}
          </Badge>
          <Badge variant="outline">
            {song.contributors.map(({ name }) => name).join(", ")}
          </Badge>
          {song.priority === "must_play" && <Badge>Must play</Badge>}
          {song.priority === "do_not_play" && (
            <Badge variant="destructive">Do not play</Badge>
          )}
        </div>
      </div>
      {song.note && (
        <p className="playlist-note">
          <q>{song.note}</q>
        </p>
      )}
      {song.service_url && (
        <a
          className="playlist-service-link"
          href={song.service_url}
          target="_blank"
          rel="noreferrer"
        >
          Open the guest's music link
        </a>
      )}
      <SongActions song={song} playlist={playlist} onUpdate={onUpdate} />
      <div className="playlist-row-buttons">
        {song.status === "pending" && (
          <>
            <Button
              size="sm"
              onClick={() =>
                onUpdate((draft) => {
                  if (draft.playlist)
                    moderateSong(draft.playlist, song.id, {
                      status: "approved",
                    });
                })
              }
            >
              <ThumbsUp size={14} /> Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                onUpdate((draft) => {
                  if (draft.playlist)
                    moderateSong(draft.playlist, song.id, {
                      status: "rejected",
                    });
                })
              }
            >
              <ThumbsDown size={14} /> Reject
            </Button>
          </>
        )}
        {song.status === "rejected" && (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              onUpdate((draft) => {
                if (draft.playlist)
                  moderateSong(draft.playlist, song.id, { status: "pending" });
              })
            }
          >
            Return to review
          </Button>
        )}
        {sortable && (
          <>
            <Button
              size="icon-sm"
              variant="outline"
              aria-label={`Move ${song.title} up`}
              onClick={() =>
                onUpdate((draft) => {
                  if (draft.playlist) moveSong(draft.playlist, song.id, -1);
                })
              }
            >
              <ChevronUp size={14} />
            </Button>
            <Button
              size="icon-sm"
              variant="outline"
              aria-label={`Move ${song.title} down`}
              onClick={() =>
                onUpdate((draft) => {
                  if (draft.playlist) moveSong(draft.playlist, song.id, 1);
                })
              }
            >
              <ChevronDown size={14} />
            </Button>
          </>
        )}
      </div>
    </article>
  );
}

export function PlaylistEditor({
  playlist,
  onUpdate,
}: Readonly<{
  playlist?: CollaborativePlaylist;
  onUpdate: UpdatePlan;
}>) {
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [note, setNote] = useState("");
  const [momentId, setMomentId] = useState("reception");
  const [momentName, setMomentName] = useState("");
  const [remoteStatus, setRemoteStatus] = useState("");
  const [remoteBusy, setRemoteBusy] = useState(false);
  const pending = useMemo(
    () => playlist?.songs.filter(({ status }) => status === "pending") ?? [],
    [playlist],
  );
  const approved = useMemo(
    () =>
      [...(playlist?.songs ?? [])]
        .filter(({ status }) => status === "approved")
        .sort((a, b) => a.order - b.order),
    [playlist],
  );
  const rejected =
    playlist?.songs.filter(({ status }) => status === "rejected") ?? [];

  if (!playlist) {
    return (
      <Card className="playlist-empty">
        <CardHeader>
          <ListMusic size={30} />
          <CardTitle>Start the wedding playlist</CardTitle>
          <CardDescription>
            Collect guest ideas, choose the final songs, then hand the DJ one
            clean brief.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            onClick={() =>
              onUpdate((draft) => {
                draft.playlist = createCollaborativePlaylist();
              })
            }
          >
            Create playlist
          </Button>
        </CardContent>
      </Card>
    );
  }

  async function publish(): Promise<void> {
    if (!playlist) return;
    setRemoteBusy(true);
    setRemoteStatus("");
    try {
      if (!playlist.sharing) {
        const response = await fetch("/api/wedding-playlists", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(playlist),
        });
        if (!response.ok) throw new Error("Could not create the guest link");
        const sharing = (await response.json()) as {
          id: string;
          guest_token: string;
          admin_token: string;
        };
        onUpdate((draft) => {
          if (draft.playlist) draft.playlist.sharing = sharing;
        });
        setRemoteStatus("Guest link created");
        return;
      }
      const response = await fetch(
        `/api/wedding-playlists/${playlist.sharing.id}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${playlist.sharing.admin_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ ...playlist, sharing: null }),
        },
      );
      if (!response.ok) throw new Error("Could not publish playlist changes");
      setRemoteStatus("Guest playlist updated");
    } catch (cause) {
      setRemoteStatus(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRemoteBusy(false);
    }
  }

  async function refresh(): Promise<void> {
    if (!playlist?.sharing) return;
    setRemoteBusy(true);
    setRemoteStatus("");
    try {
      const response = await fetch(
        `/api/wedding-playlists/${playlist.sharing.id}?admin=1`,
        {
          headers: { Authorization: `Bearer ${playlist.sharing.admin_token}` },
        },
      );
      if (!response.ok) throw new Error("Could not fetch guest changes");
      const remote = collaborativePlaylistSchema.parse(await response.json());
      onUpdate((draft) => {
        draft.playlist = { ...remote, sharing: playlist.sharing };
      });
      setRemoteStatus("Guest suggestions and votes loaded");
    } catch (cause) {
      setRemoteStatus(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRemoteBusy(false);
    }
  }

  return (
    <>
      <div className="page-heading playlist-heading">
        <div>
          <h2>Music</h2>
          <p>Guest ideas come here for review before they reach the DJ.</p>
        </div>
        <div className="playlist-heading-actions">
          {playlist.sharing && (
            <Button
              variant="outline"
              onClick={() => {
                const sharing = playlist.sharing;
                if (!sharing) return;
                navigator.clipboard
                  .writeText(publicLink(sharing))
                  .then(() => setRemoteStatus("Guest link copied"));
              }}
            >
              <Copy size={15} /> Copy guest link
            </Button>
          )}
          <Button onClick={publish} disabled={remoteBusy}>
            <Link2 size={15} />
            {playlist.sharing ? "Publish changes" : "Create guest link"}
          </Button>
          {playlist.sharing && (
            <Button variant="outline" onClick={refresh} disabled={remoteBusy}>
              <RefreshCw size={15} /> Get guest changes
            </Button>
          )}
        </div>
      </div>
      {remoteStatus && (
        <output className="editor-hint block mb-5">{remoteStatus}</output>
      )}

      <div className="playlist-summary">
        <span>
          <strong>{pending.length}</strong> to review
        </span>
        <span>
          <strong>{approved.length}</strong> approved
        </span>
        <span>
          <strong>
            {playlist.songs.reduce(
              (sum, song) => sum + song.voter_ids.length,
              0,
            )}
          </strong>{" "}
          votes
        </span>
      </div>

      <div className="playlist-grid">
        <Card>
          <CardHeader>
            <CardTitle>Add a song</CardTitle>
            <CardDescription>
              Songs added here are approved immediately. Guest additions wait
              for review.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="playlist-form"
              onSubmit={(event) => {
                event.preventDefault();
                onUpdate((draft) => {
                  if (!draft.playlist) return;
                  const song = addSongSuggestion(draft.playlist, {
                    id: crypto.randomUUID(),
                    title,
                    artist,
                    note,
                    moment_id: momentId,
                    contributor: { id: "couple", name: "The couple" },
                  });
                  moderateSong(draft.playlist, song.id, { status: "approved" });
                });
                setTitle("");
                setArtist("");
                setNote("");
              }}
            >
              <Input
                aria-label="Song title"
                placeholder="Song title"
                required
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
              <Input
                aria-label="Song artist"
                placeholder="Artist"
                required
                value={artist}
                onChange={(event) => setArtist(event.target.value)}
              />
              <select
                aria-label="Song moment"
                value={momentId}
                onChange={(event) => setMomentId(event.target.value)}
              >
                {playlist.moments.map((moment) => (
                  <option key={moment.id} value={moment.id}>
                    {moment.name}
                  </option>
                ))}
              </select>
              <Textarea
                aria-label="Song note"
                placeholder="Optional note for the DJ"
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
              <Button type="submit">
                <Plus size={15} /> Add song
              </Button>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Moments</CardTitle>
            <CardDescription>
              Hidden moments never appear on the guest page.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="playlist-moments">
              {playlist.moments.map((moment) => (
                <div key={moment.id}>
                  <span>{moment.name}</span>
                  <Button
                    size="sm"
                    variant={moment.private ? "default" : "outline"}
                    onClick={() =>
                      onUpdate((draft) => {
                        const found = draft.playlist?.moments.find(
                          ({ id }) => id === moment.id,
                        );
                        if (found) found.private = !found.private;
                      })
                    }
                  >
                    <EyeOff size={13} /> {moment.private ? "Hidden" : "Visible"}
                  </Button>
                </div>
              ))}
            </div>
            <form
              className="playlist-add-moment"
              onSubmit={(event) => {
                event.preventDefault();
                onUpdate((draft) => {
                  draft.playlist?.moments.push({
                    id: crypto.randomUUID(),
                    name: momentName,
                    private: false,
                  });
                });
                setMomentName("");
              }}
            >
              <Input
                aria-label="New playlist moment"
                placeholder="Add a moment"
                required
                value={momentName}
                onChange={(event) => setMomentName(event.target.value)}
              />
              <Button type="submit" size="sm" variant="outline">
                <Plus size={14} /> Add
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      {pending.length > 0 && (
        <section className="playlist-section">
          <h3>Review guest suggestions</h3>
          <div className="playlist-song-list">
            {pending.map((song) => (
              <SongCard
                key={song.id}
                song={song}
                playlist={playlist}
                onUpdate={onUpdate}
              />
            ))}
          </div>
        </section>
      )}
      <section className="playlist-section">
        <div className="playlist-section-heading">
          <h3>DJ brief</h3>
          <div>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                download(
                  "wedding-dj-brief.csv",
                  playlistDjBriefCsv(playlist),
                  "text/csv;charset=utf-8",
                )
              }
            >
              <Download size={14} /> CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                download(
                  "wedding-dj-brief.md",
                  playlistDjBriefMarkdown(playlist),
                  "text/markdown;charset=utf-8",
                )
              }
            >
              <Download size={14} /> Document
            </Button>
          </div>
        </div>
        {approved.length ? (
          <div className="playlist-song-list">
            {approved.map((song) => (
              <SongCard
                key={song.id}
                song={song}
                playlist={playlist}
                onUpdate={onUpdate}
                sortable
              />
            ))}
          </div>
        ) : (
          <p className="editor-hint">Approve a song to start the DJ brief.</p>
        )}
      </section>
      {rejected.length > 0 && (
        <details className="playlist-rejected">
          <summary>
            {rejected.length} rejected{" "}
            {rejected.length === 1 ? "song" : "songs"}
          </summary>
          <div className="playlist-song-list">
            {rejected.map((song) => (
              <SongCard
                key={song.id}
                song={song}
                playlist={playlist}
                onUpdate={onUpdate}
              />
            ))}
          </div>
        </details>
      )}
    </>
  );
}
