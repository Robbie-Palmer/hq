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
  type PlaylistMoment,
  playlistDjBriefCsv,
  playlistDjBriefMarkdown,
  playlistSharingSchema,
  type SongSuggestion,
} from "wedding-planner-domain";
import type { WeddingPlanDraft } from "@/app/_projects/wedding-planner/application/types";
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

type UpdatePlan = (change: (draft: WeddingPlanDraft) => void) => void;

interface SongDraft {
  artist: string;
  momentId: string;
  note: string;
  title: string;
}

const initialSongDraft: SongDraft = {
  artist: "",
  momentId: "reception",
  note: "",
  title: "",
};

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

function usePlaylistEditor(
  playlist: CollaborativePlaylist | undefined,
  onUpdate: UpdatePlan,
) {
  const [songDraft, setSongDraft] = useState(initialSongDraft);
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

  function changeSongDraft(field: keyof SongDraft, value: string): void {
    setSongDraft((current) => ({ ...current, [field]: value }));
  }

  function addSong(): void {
    onUpdate((draft) => {
      if (!draft.playlist) return;
      const song = addSongSuggestion(draft.playlist, {
        id: crypto.randomUUID(),
        title: songDraft.title,
        artist: songDraft.artist,
        note: songDraft.note,
        moment_id: songDraft.momentId,
        contributor: { id: "couple", name: "The couple" },
      });
      moderateSong(draft.playlist, song.id, { status: "approved" });
    });
    setSongDraft((current) => ({
      ...initialSongDraft,
      momentId: current.momentId,
    }));
  }

  function addMoment(): void {
    onUpdate((draft) => {
      draft.playlist?.moments.push({
        id: crypto.randomUUID(),
        name: momentName,
        private: false,
      });
    });
    setMomentName("");
  }

  function toggleMoment(momentId: string): void {
    onUpdate((draft) => {
      const moment = draft.playlist?.moments.find(({ id }) => id === momentId);
      if (moment) moment.private = !moment.private;
    });
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
        const sharing = playlistSharingSchema.parse(await response.json());
        onUpdate((draft) => {
          if (draft.playlist) draft.playlist.sharing = sharing;
        });
        setRemoteStatus("Guest link created");
        return;
      }
      const sharing = playlist.sharing;
      const response = await fetch(`/api/wedding-playlists/${sharing.id}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${sharing.admin_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          playlist: { ...playlist, sharing: null },
          removed_song_ids: sharing.synced_song_ids.filter(
            (songId) => !playlist.songs.some(({ id }) => id === songId),
          ),
        }),
      });
      if (!response.ok) throw new Error("Could not publish playlist changes");
      const published = collaborativePlaylistSchema.parse(
        await response.json(),
      );
      onUpdate((draft) => {
        draft.playlist = {
          ...published,
          sharing: {
            ...sharing,
            synced_song_ids: published.songs.map(({ id }) => id),
          },
        };
      });
      setRemoteStatus("Guest playlist updated");
    } catch (cause) {
      setRemoteStatus(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRemoteBusy(false);
    }
  }

  async function refresh(): Promise<void> {
    if (!playlist?.sharing) return;
    const sharing = playlist.sharing;
    setRemoteBusy(true);
    setRemoteStatus("");
    try {
      const response = await fetch(
        `/api/wedding-playlists/${sharing.id}?admin=1`,
        {
          headers: { Authorization: `Bearer ${sharing.admin_token}` },
        },
      );
      if (!response.ok) throw new Error("Could not fetch guest changes");
      const remote = collaborativePlaylistSchema.parse(await response.json());
      onUpdate((draft) => {
        draft.playlist = {
          ...remote,
          sharing: {
            ...sharing,
            synced_song_ids: remote.songs.map(({ id }) => id),
          },
        };
      });
      setRemoteStatus("Guest suggestions and votes loaded");
    } catch (cause) {
      setRemoteStatus(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRemoteBusy(false);
    }
  }

  function copyGuestLink(): void {
    if (!playlist?.sharing) return;
    void navigator.clipboard
      .writeText(publicLink(playlist.sharing))
      .then(() => setRemoteStatus("Guest link copied"));
  }

  return {
    addMoment,
    addSong,
    approved,
    changeSongDraft,
    copyGuestLink,
    momentName,
    pending,
    publish,
    refresh,
    rejected,
    remoteBusy,
    remoteStatus,
    setMomentName,
    songDraft,
    toggleMoment,
  };
}

function SongSettings({
  song,
  moments,
  onChange,
}: Readonly<{
  song: SongSuggestion;
  moments: PlaylistMoment[];
  onChange: (change: Parameters<typeof moderateSong>[2]) => void;
}>) {
  return (
    <>
      <label>
        <span>Moment</span>
        <select
          aria-label={`Moment for ${song.title}`}
          value={song.moment_id}
          onChange={(event) => onChange({ moment_id: event.target.value })}
        >
          {moments.map((moment) => (
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
            onChange({
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
        onClick={() => onChange({ private: !song.private })}
      >
        <EyeOff size={14} /> {song.private ? "Hidden" : "Hide from guests"}
      </Button>
    </>
  );
}

function SongMerge({
  song,
  playlist,
  onUpdate,
}: Readonly<{
  song: SongSuggestion;
  playlist: CollaborativePlaylist;
  onUpdate: UpdatePlan;
}>) {
  const [targetId, setTargetId] = useState("");
  if (playlist.songs.length <= 1) return null;
  return (
    <div className="playlist-merge">
      <select
        aria-label={`Merge target for ${song.title}`}
        value={targetId}
        onChange={(event) => setTargetId(event.target.value)}
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
        disabled={!targetId}
        onClick={() =>
          onUpdate((draft) => {
            if (draft.playlist) mergeSongs(draft.playlist, targetId, song.id);
          })
        }
      >
        Merge
      </Button>
    </div>
  );
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
  const updateSong = (change: Parameters<typeof moderateSong>[2]): void =>
    onUpdate((draft) => {
      if (draft.playlist) moderateSong(draft.playlist, song.id, change);
    });
  return (
    <div className="playlist-song-actions">
      <SongSettings
        song={song}
        moments={playlist.moments}
        onChange={updateSong}
      />
      <SongMerge song={song} playlist={playlist} onUpdate={onUpdate} />
    </div>
  );
}

function SongBadges({ song }: Readonly<{ song: SongSuggestion }>) {
  return (
    <div className="playlist-badges">
      <Badge variant="outline">
        {song.voter_ids.length} {song.voter_ids.length === 1 ? "vote" : "votes"}
      </Badge>
      <Badge variant="outline">
        {song.contributors.map(({ name }) => name).join(", ")}
      </Badge>
      {song.priority === "must_play" && <Badge>Must play</Badge>}
      {song.priority === "do_not_play" && (
        <Badge variant="destructive">Do not play</Badge>
      )}
    </div>
  );
}

function SongDetails({ song }: Readonly<{ song: SongSuggestion }>) {
  return (
    <>
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
    </>
  );
}

function SongModeration({
  song,
  onUpdate,
}: Readonly<{
  song: SongSuggestion;
  onUpdate: UpdatePlan;
}>) {
  const setStatus = (status: SongSuggestion["status"]): void =>
    onUpdate((draft) => {
      if (draft.playlist) moderateSong(draft.playlist, song.id, { status });
    });
  if (song.status === "pending") {
    return (
      <>
        <Button size="sm" onClick={() => setStatus("approved")}>
          <ThumbsUp size={14} /> Approve
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setStatus("rejected")}
        >
          <ThumbsDown size={14} /> Reject
        </Button>
      </>
    );
  }
  if (song.status !== "rejected") return null;
  return (
    <Button size="sm" variant="outline" onClick={() => setStatus("pending")}>
      Return to review
    </Button>
  );
}

function SongOrdering({
  song,
  sortable,
  onUpdate,
}: Readonly<{
  song: SongSuggestion;
  sortable?: boolean;
  onUpdate: UpdatePlan;
}>) {
  const move = (direction: -1 | 1): void =>
    onUpdate((draft) => {
      if (draft.playlist) moveSong(draft.playlist, song.id, direction);
    });
  if (!sortable) return null;
  return (
    <>
      <Button
        size="icon-sm"
        variant="outline"
        aria-label={`Move ${song.title} up`}
        onClick={() => move(-1)}
      >
        <ChevronUp size={14} />
      </Button>
      <Button
        size="icon-sm"
        variant="outline"
        aria-label={`Move ${song.title} down`}
        onClick={() => move(1)}
      >
        <ChevronDown size={14} />
      </Button>
    </>
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
        <SongBadges song={song} />
      </div>
      <SongDetails song={song} />
      <SongActions song={song} playlist={playlist} onUpdate={onUpdate} />
      <div className="playlist-row-buttons">
        <SongModeration song={song} onUpdate={onUpdate} />
        <SongOrdering song={song} sortable={sortable} onUpdate={onUpdate} />
      </div>
    </article>
  );
}

function EmptyPlaylist({ onUpdate }: Readonly<{ onUpdate: UpdatePlan }>) {
  return (
    <>
      <div className="page-heading">
        <div>
          <h2>Music</h2>
          <p>Guest ideas come here for review before they reach the DJ.</p>
        </div>
      </div>
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
    </>
  );
}

function PlaylistHeading({
  playlist,
  busy,
  onCopy,
  onPublish,
  onRefresh,
}: Readonly<{
  playlist: CollaborativePlaylist;
  busy: boolean;
  onCopy: () => void;
  onPublish: () => void;
  onRefresh: () => void;
}>) {
  return (
    <div className="page-heading playlist-heading">
      <div>
        <h2>Music</h2>
        <p>Guest ideas come here for review before they reach the DJ.</p>
      </div>
      <div className="playlist-heading-actions">
        {playlist.sharing && (
          <Button variant="outline" onClick={onCopy}>
            <Copy size={15} /> Copy guest link
          </Button>
        )}
        <Button onClick={onPublish} disabled={busy}>
          <Link2 size={15} />
          {playlist.sharing ? "Publish changes" : "Create guest link"}
        </Button>
        {playlist.sharing && (
          <Button variant="outline" onClick={onRefresh} disabled={busy}>
            <RefreshCw size={15} /> Get guest changes
          </Button>
        )}
      </div>
    </div>
  );
}

function PlaylistSummary({
  pending,
  approved,
  votes,
}: Readonly<{
  pending: number;
  approved: number;
  votes: number;
}>) {
  return (
    <div className="playlist-summary">
      <span>
        <strong>{pending}</strong> to review
      </span>
      <span>
        <strong>{approved}</strong> approved
      </span>
      <span>
        <strong>{votes}</strong> votes
      </span>
    </div>
  );
}

function AddSongFields({
  draft,
  moments,
  onChange,
}: Readonly<{
  draft: SongDraft;
  moments: PlaylistMoment[];
  onChange: (field: keyof SongDraft, value: string) => void;
}>) {
  return (
    <>
      <Input
        aria-label="Song title"
        placeholder="Song title"
        required
        value={draft.title}
        onChange={(event) => onChange("title", event.target.value)}
      />
      <Input
        aria-label="Song artist"
        placeholder="Artist"
        required
        value={draft.artist}
        onChange={(event) => onChange("artist", event.target.value)}
      />
      <select
        aria-label="Song moment"
        value={draft.momentId}
        onChange={(event) => onChange("momentId", event.target.value)}
      >
        {moments.map((moment) => (
          <option key={moment.id} value={moment.id}>
            {moment.name}
          </option>
        ))}
      </select>
      <Textarea
        aria-label="Song note"
        placeholder="Optional note for the DJ"
        value={draft.note}
        onChange={(event) => onChange("note", event.target.value)}
      />
    </>
  );
}

function AddSongCard({
  draft,
  moments,
  onChange,
  onSubmit,
}: Readonly<{
  draft: SongDraft;
  moments: PlaylistMoment[];
  onChange: (field: keyof SongDraft, value: string) => void;
  onSubmit: () => void;
}>) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Add a song</CardTitle>
        <CardDescription>
          Songs added here are approved immediately. Guest additions wait for
          review.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="playlist-form"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <AddSongFields draft={draft} moments={moments} onChange={onChange} />
          <Button type="submit">
            <Plus size={15} /> Add song
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function MomentList({
  moments,
  onToggle,
}: Readonly<{
  moments: PlaylistMoment[];
  onToggle: (id: string) => void;
}>) {
  return (
    <div className="playlist-moments">
      {moments.map((moment) => (
        <div key={moment.id}>
          <span>{moment.name}</span>
          <Button
            size="sm"
            variant={moment.private ? "default" : "outline"}
            onClick={() => onToggle(moment.id)}
          >
            <EyeOff size={13} /> {moment.private ? "Hidden" : "Visible"}
          </Button>
        </div>
      ))}
    </div>
  );
}

function AddMomentForm({
  name,
  onNameChange,
  onSubmit,
}: Readonly<{
  name: string;
  onNameChange: (value: string) => void;
  onSubmit: () => void;
}>) {
  return (
    <form
      className="playlist-add-moment"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <Input
        aria-label="New playlist moment"
        placeholder="Add a moment"
        required
        value={name}
        onChange={(event) => onNameChange(event.target.value)}
      />
      <Button type="submit" size="sm" variant="outline">
        <Plus size={14} /> Add
      </Button>
    </form>
  );
}

function MomentsCard({
  moments,
  name,
  onNameChange,
  onSubmit,
  onToggle,
}: Readonly<{
  moments: PlaylistMoment[];
  name: string;
  onNameChange: (value: string) => void;
  onSubmit: () => void;
  onToggle: (id: string) => void;
}>) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Moments</CardTitle>
        <CardDescription>
          Hidden moments never appear on the guest page.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <MomentList moments={moments} onToggle={onToggle} />
        <AddMomentForm
          name={name}
          onNameChange={onNameChange}
          onSubmit={onSubmit}
        />
      </CardContent>
    </Card>
  );
}

function PlaylistSetup({
  playlist,
  editor,
}: Readonly<{
  playlist: CollaborativePlaylist;
  editor: ReturnType<typeof usePlaylistEditor>;
}>) {
  return (
    <div className="playlist-grid">
      <AddSongCard
        draft={editor.songDraft}
        moments={playlist.moments}
        onChange={editor.changeSongDraft}
        onSubmit={editor.addSong}
      />
      <MomentsCard
        moments={playlist.moments}
        name={editor.momentName}
        onNameChange={editor.setMomentName}
        onSubmit={editor.addMoment}
        onToggle={editor.toggleMoment}
      />
    </div>
  );
}

function SongList({
  songs,
  playlist,
  onUpdate,
  sortable,
}: Readonly<{
  songs: SongSuggestion[];
  playlist: CollaborativePlaylist;
  onUpdate: UpdatePlan;
  sortable?: boolean;
}>) {
  return (
    <div className="playlist-song-list">
      {songs.map((song) => (
        <SongCard
          key={song.id}
          song={song}
          playlist={playlist}
          onUpdate={onUpdate}
          sortable={sortable}
        />
      ))}
    </div>
  );
}

function ReviewSection({
  songs,
  playlist,
  onUpdate,
}: Readonly<{
  songs: SongSuggestion[];
  playlist: CollaborativePlaylist;
  onUpdate: UpdatePlan;
}>) {
  if (songs.length === 0) return null;
  return (
    <section className="playlist-section">
      <h3>Review guest suggestions</h3>
      <SongList songs={songs} playlist={playlist} onUpdate={onUpdate} />
    </section>
  );
}

function DjBriefHeading({
  playlist,
}: Readonly<{ playlist: CollaborativePlaylist }>) {
  return (
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
  );
}

function DjBrief({
  songs,
  playlist,
  onUpdate,
}: Readonly<{
  songs: SongSuggestion[];
  playlist: CollaborativePlaylist;
  onUpdate: UpdatePlan;
}>) {
  return (
    <section className="playlist-section">
      <DjBriefHeading playlist={playlist} />
      {songs.length ? (
        <SongList
          songs={songs}
          playlist={playlist}
          onUpdate={onUpdate}
          sortable
        />
      ) : (
        <p className="editor-hint">Approve a song to start the DJ brief.</p>
      )}
    </section>
  );
}

function RejectedSongs({
  songs,
  playlist,
  onUpdate,
}: Readonly<{
  songs: SongSuggestion[];
  playlist: CollaborativePlaylist;
  onUpdate: UpdatePlan;
}>) {
  if (songs.length === 0) return null;
  return (
    <details className="playlist-rejected">
      <summary>
        {songs.length} rejected {songs.length === 1 ? "song" : "songs"}
      </summary>
      <SongList songs={songs} playlist={playlist} onUpdate={onUpdate} />
    </details>
  );
}

export function PlaylistEditor({
  playlist,
  onUpdate,
}: Readonly<{
  playlist?: CollaborativePlaylist;
  onUpdate: UpdatePlan;
}>) {
  const editor = usePlaylistEditor(playlist, onUpdate);
  if (!playlist) return <EmptyPlaylist onUpdate={onUpdate} />;
  const votes = playlist.songs.reduce(
    (sum, song) => sum + song.voter_ids.length,
    0,
  );
  return (
    <>
      <PlaylistHeading
        playlist={playlist}
        busy={editor.remoteBusy}
        onCopy={editor.copyGuestLink}
        onPublish={() => void editor.publish()}
        onRefresh={() => void editor.refresh()}
      />
      {editor.remoteStatus && (
        <output className="editor-hint block mb-5">
          {editor.remoteStatus}
        </output>
      )}
      <PlaylistSummary
        pending={editor.pending.length}
        approved={editor.approved.length}
        votes={votes}
      />
      <PlaylistSetup playlist={playlist} editor={editor} />
      <ReviewSection
        songs={editor.pending}
        playlist={playlist}
        onUpdate={onUpdate}
      />
      <DjBrief
        songs={editor.approved}
        playlist={playlist}
        onUpdate={onUpdate}
      />
      <RejectedSongs
        songs={editor.rejected}
        playlist={playlist}
        onUpdate={onUpdate}
      />
    </>
  );
}
