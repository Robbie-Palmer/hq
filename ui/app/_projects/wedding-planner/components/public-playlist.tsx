"use client";

import {
  Heart,
  LoaderCircle,
  Music2,
  Plus,
  RefreshCw,
  ThumbsUp,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  type GuestPlaylist,
  type GuestSongSuggestion,
  guestPlaylistSchema,
  type PlaylistMoment,
} from "wedding-planner-domain";
import { browserGuestPlaylistSession } from "@/app/_projects/wedding-planner/application/guest-session";
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

interface GuestAccess {
  id: string;
  token: string;
}

interface GuestForm {
  artist: string;
  momentId: string;
  name: string;
  note: string;
  serviceUrl: string;
  title: string;
}

const initialGuestForm: GuestForm = {
  artist: "",
  momentId: "",
  name: "",
  note: "",
  serviceUrl: "",
  title: "",
};

function accessFromHash(): GuestAccess | null {
  const values = new URLSearchParams(window.location.hash.slice(1));
  const id = values.get("id");
  const token = values.get("token");
  return id && token ? { id, token } : null;
}

async function responseError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  return body?.error ?? "The playlist could not be updated.";
}

function useGuestPlaylist() {
  const [access, setAccess] = useState<GuestAccess | null>(null);
  const [playlist, setPlaylist] = useState<GuestPlaylist | null>(null);
  const [guestId, setGuestId] = useState("");
  const [form, setForm] = useState(initialGuestForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(
    async (guestAccess: GuestAccess, identity: string) => {
      setBusy(true);
      setError("");
      try {
        const response = await fetch(
          `/api/wedding-playlists/${guestAccess.id}`,
          {
            headers: {
              Authorization: `Bearer ${guestAccess.token}`,
              "X-Wedding-Guest-Id": identity,
            },
          },
        );
        if (!response.ok) throw new Error(await responseError(response));
        const loaded = guestPlaylistSchema.parse(await response.json());
        setPlaylist(loaded);
        setForm((current) => ({
          ...current,
          momentId: current.momentId || loaded.moments[0]?.id || "",
        }));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  useEffect(() => {
    const guestAccess = accessFromHash();
    if (!guestAccess) {
      setError("This guest link is incomplete. Ask the couple for a new one.");
      return;
    }
    setAccess(guestAccess);
    const session = browserGuestPlaylistSession.load(guestAccess.id);
    setGuestId(session.guestId);
    setForm((current) => ({
      ...current,
      name: session.name,
    }));
    void load(guestAccess, session.guestId);
  }, [load]);

  function changeForm(field: keyof GuestForm, value: string): void {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function suggest(): Promise<void> {
    if (!access || !playlist) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/wedding-playlists/${access.id}/suggestions`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${access.token}`,
            "Content-Type": "application/json",
            "X-Wedding-Guest-Id": guestId,
          },
          body: JSON.stringify({
            title: form.title,
            artist: form.artist,
            service_url: form.serviceUrl,
            moment_id: form.momentId,
            note: form.note,
            contributor: { name: form.name },
          }),
        },
      );
      if (!response.ok) throw new Error(await responseError(response));
      setPlaylist(guestPlaylistSchema.parse(await response.json()));
      browserGuestPlaylistSession.saveName(access.id, form.name);
      setForm((current) => ({
        ...current,
        artist: "",
        note: "",
        serviceUrl: "",
        title: "",
      }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function vote(songId: string, selected: boolean): Promise<void> {
    if (!access) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/wedding-playlists/${access.id}/votes`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${access.token}`,
            "Content-Type": "application/json",
            "X-Wedding-Guest-Id": guestId,
          },
          body: JSON.stringify({
            song_id: songId,
            selected,
          }),
        },
      );
      if (!response.ok) throw new Error(await responseError(response));
      setPlaylist(guestPlaylistSchema.parse(await response.json()));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return {
    access,
    busy,
    changeForm,
    error,
    form,
    playlist,
    refresh: () => access && guestId && load(access, guestId),
    suggest,
    vote,
  };
}

function PublicPlaylistHeader({ title }: Readonly<{ title?: string }>) {
  return (
    <header>
      <span className="brand-mark">
        <Heart size={18} fill="currentColor" />
      </span>
      <div>
        <p>Wedding playlist</p>
        <h1>{title ?? "Song requests"}</h1>
      </div>
    </header>
  );
}

function GuestSongFields({
  form,
  moments,
  onChange,
}: Readonly<{
  form: GuestForm;
  moments: PlaylistMoment[];
  onChange: (field: keyof GuestForm, value: string) => void;
}>) {
  return (
    <>
      <div className="playlist-two-fields">
        <Input
          aria-label="Song title"
          placeholder="Song title"
          required
          maxLength={160}
          value={form.title}
          onChange={(event) => onChange("title", event.target.value)}
        />
        <Input
          aria-label="Artist"
          placeholder="Artist"
          required
          maxLength={160}
          value={form.artist}
          onChange={(event) => onChange("artist", event.target.value)}
        />
      </div>
      <select
        aria-label="Preferred moment"
        value={form.momentId}
        onChange={(event) => onChange("momentId", event.target.value)}
      >
        {moments.map((moment) => (
          <option key={moment.id} value={moment.id}>
            {moment.name}
          </option>
        ))}
      </select>
      <Input
        aria-label="Spotify, Apple Music, or YouTube link"
        type="url"
        placeholder="Spotify, Apple Music, or YouTube link (optional)"
        value={form.serviceUrl}
        onChange={(event) => onChange("serviceUrl", event.target.value)}
      />
      <Textarea
        aria-label="Song note"
        placeholder="Why this one? (optional)"
        maxLength={500}
        value={form.note}
        onChange={(event) => onChange("note", event.target.value)}
      />
    </>
  );
}

function SuggestionForm({
  form,
  moments,
  busy,
  onChange,
  onSubmit,
}: Readonly<{
  form: GuestForm;
  moments: PlaylistMoment[];
  busy: boolean;
  onChange: (field: keyof GuestForm, value: string) => void;
  onSubmit: () => void;
}>) {
  return (
    <form
      className="playlist-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <Input
        aria-label="Your name"
        placeholder="Your name"
        required
        maxLength={80}
        value={form.name}
        onChange={(event) => onChange("name", event.target.value)}
      />
      <GuestSongFields form={form} moments={moments} onChange={onChange} />
      <Button type="submit" disabled={busy}>
        <Plus size={15} /> Add suggestion
      </Button>
    </form>
  );
}

function SuggestionCard({
  form,
  moments,
  busy,
  onChange,
  onSubmit,
}: Readonly<{
  form: GuestForm;
  moments: PlaylistMoment[];
  busy: boolean;
  onChange: (field: keyof GuestForm, value: string) => void;
  onSubmit: () => void;
}>) {
  return (
    <Card className="public-suggestion-card">
      <CardHeader>
        <Music2 size={25} />
        <CardTitle>Suggest a song</CardTitle>
        <CardDescription>
          Add the track you want to hear and the part of the day it suits. The
          couple will make the final DJ list.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <SuggestionForm
          form={form}
          moments={moments}
          busy={busy}
          onChange={onChange}
          onSubmit={onSubmit}
        />
      </CardContent>
    </Card>
  );
}

function GuestSongCard({
  song,
  moment,
  selected,
  busy,
  onVote,
}: Readonly<{
  song: GuestSongSuggestion;
  moment?: PlaylistMoment;
  selected: boolean;
  busy: boolean;
  onVote: (selected: boolean) => void;
}>) {
  return (
    <article>
      <div>
        <h3>{song.title}</h3>
        <p>{song.artist}</p>
        <div className="playlist-badges">
          {moment && <Badge variant="outline">{moment.name}</Badge>}
          <Badge variant="outline">
            Suggested by {song.contributors.map(({ name }) => name).join(", ")}
          </Badge>
        </div>
      </div>
      <Button
        variant={selected ? "default" : "outline"}
        disabled={busy}
        aria-pressed={selected}
        onClick={() => onVote(!selected)}
      >
        <ThumbsUp size={15} /> {song.vote_count}
      </Button>
    </article>
  );
}

function GuestSongList({
  playlist,
  busy,
  onVote,
}: Readonly<{
  playlist: GuestPlaylist;
  busy: boolean;
  onVote: (songId: string, selected: boolean) => void;
}>) {
  const songs = [...playlist.songs].sort((a, b) => b.vote_count - a.vote_count);
  return (
    <div className="public-song-list">
      {songs.map((song) => (
        <GuestSongCard
          key={song.id}
          song={song}
          moment={playlist.moments.find(({ id }) => id === song.moment_id)}
          selected={song.voted_by_you}
          busy={busy}
          onVote={(selected) => onVote(song.id, selected)}
        />
      ))}
    </div>
  );
}

function GuestPicks({
  playlist,
  busy,
  canRefresh,
  onRefresh,
  onVote,
}: Readonly<{
  playlist: GuestPlaylist;
  busy: boolean;
  canRefresh: boolean;
  onRefresh: () => void;
  onVote: (songId: string, selected: boolean) => void;
}>) {
  return (
    <section className="public-song-section">
      <div className="playlist-section-heading">
        <div>
          <h2>Guest picks</h2>
          <p>Vote once for every song you would love to hear.</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={busy || !canRefresh}
          onClick={onRefresh}
        >
          <RefreshCw size={14} /> Refresh
        </Button>
      </div>
      {playlist.songs.length ? (
        <GuestSongList playlist={playlist} busy={busy} onVote={onVote} />
      ) : (
        <p className="public-empty">No suggestions yet. Yours can be first.</p>
      )}
    </section>
  );
}

export function PublicPlaylist() {
  const guest = useGuestPlaylist();
  return (
    <div className="public-playlist">
      <PublicPlaylistHeader title={guest.playlist?.title} />
      <main>
        {guest.error && (
          <div className="editor-error" role="alert">
            {guest.error}
          </div>
        )}
        {!guest.playlist && guest.busy && (
          <div className="public-playlist-loading">
            <LoaderCircle className="animate-spin" /> Loading playlist
          </div>
        )}
        {guest.playlist && (
          <>
            <SuggestionCard
              form={guest.form}
              moments={guest.playlist.moments}
              busy={guest.busy}
              onChange={guest.changeForm}
              onSubmit={() => void guest.suggest()}
            />
            <GuestPicks
              playlist={guest.playlist}
              busy={guest.busy}
              canRefresh={Boolean(guest.access)}
              onRefresh={() => void guest.refresh()}
              onVote={(songId, selected) => void guest.vote(songId, selected)}
            />
          </>
        )}
      </main>
    </div>
  );
}
