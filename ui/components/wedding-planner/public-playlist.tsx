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
  type CollaborativePlaylist,
  collaborativePlaylistSchema,
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

interface GuestAccess {
  id: string;
  token: string;
}

function accessFromHash(): GuestAccess | null {
  const values = new URLSearchParams(window.location.hash.slice(1));
  const id = values.get("id");
  const token = values.get("token");
  return id && token ? { id, token } : null;
}

function guestIdentity(playlistId: string): string {
  const key = `wedding-playlist:${playlistId}:guest-id`;
  const current = window.localStorage.getItem(key);
  if (current) return current;
  const created = crypto.randomUUID();
  window.localStorage.setItem(key, created);
  return created;
}

async function responseError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  return body?.error ?? "The playlist could not be updated.";
}

export function PublicPlaylist() {
  const [access, setAccess] = useState<GuestAccess | null>(null);
  const [playlist, setPlaylist] = useState<CollaborativePlaylist | null>(null);
  const [guestId, setGuestId] = useState("");
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [serviceUrl, setServiceUrl] = useState("");
  const [momentId, setMomentId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (guestAccess: GuestAccess) => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/wedding-playlists/${guestAccess.id}`, {
        headers: { Authorization: `Bearer ${guestAccess.token}` },
      });
      if (!response.ok) throw new Error(await responseError(response));
      const loaded = collaborativePlaylistSchema.parse(await response.json());
      setPlaylist(loaded);
      setMomentId((current) => current || loaded.moments[0]?.id || "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const guestAccess = accessFromHash();
    if (!guestAccess) {
      setError("This guest link is incomplete. Ask the couple for a new one.");
      return;
    }
    setAccess(guestAccess);
    setGuestId(guestIdentity(guestAccess.id));
    setName(
      window.localStorage.getItem(
        `wedding-playlist:${guestAccess.id}:guest-name`,
      ) ?? "",
    );
    void load(guestAccess);
  }, [load]);

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
          },
          body: JSON.stringify({
            title,
            artist,
            service_url: serviceUrl,
            moment_id: momentId,
            note,
            contributor: { id: guestId, name },
          }),
        },
      );
      if (!response.ok) throw new Error(await responseError(response));
      setPlaylist(collaborativePlaylistSchema.parse(await response.json()));
      window.localStorage.setItem(
        `wedding-playlist:${access.id}:guest-name`,
        name,
      );
      setTitle("");
      setArtist("");
      setServiceUrl("");
      setNote("");
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
          },
          body: JSON.stringify({
            song_id: songId,
            voter_id: guestId,
            selected,
          }),
        },
      );
      if (!response.ok) throw new Error(await responseError(response));
      setPlaylist(collaborativePlaylistSchema.parse(await response.json()));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="public-playlist">
      <header>
        <span className="brand-mark">
          <Heart size={18} fill="currentColor" />
        </span>
        <div>
          <p>Wedding playlist</p>
          <h1>{playlist?.title ?? "Song requests"}</h1>
        </div>
      </header>
      <main>
        {error && (
          <div className="editor-error" role="alert">
            {error}
          </div>
        )}
        {!playlist && busy && (
          <div className="public-playlist-loading">
            <LoaderCircle className="animate-spin" /> Loading playlist
          </div>
        )}
        {playlist && (
          <>
            <Card className="public-suggestion-card">
              <CardHeader>
                <Music2 size={25} />
                <CardTitle>Suggest a song</CardTitle>
                <CardDescription>
                  Add the track you want to hear and the part of the day it
                  suits. The couple will make the final DJ list.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form
                  className="playlist-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void suggest();
                  }}
                >
                  <Input
                    aria-label="Your name"
                    placeholder="Your name"
                    required
                    maxLength={80}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                  <div className="playlist-two-fields">
                    <Input
                      aria-label="Song title"
                      placeholder="Song title"
                      required
                      maxLength={160}
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                    />
                    <Input
                      aria-label="Artist"
                      placeholder="Artist"
                      required
                      maxLength={160}
                      value={artist}
                      onChange={(event) => setArtist(event.target.value)}
                    />
                  </div>
                  <select
                    aria-label="Preferred moment"
                    value={momentId}
                    onChange={(event) => setMomentId(event.target.value)}
                  >
                    {playlist.moments.map((moment) => (
                      <option key={moment.id} value={moment.id}>
                        {moment.name}
                      </option>
                    ))}
                  </select>
                  <Input
                    aria-label="Spotify, Apple Music, or YouTube link"
                    type="url"
                    placeholder="Spotify, Apple Music, or YouTube link (optional)"
                    value={serviceUrl}
                    onChange={(event) => setServiceUrl(event.target.value)}
                  />
                  <Textarea
                    aria-label="Song note"
                    placeholder="Why this one? (optional)"
                    maxLength={500}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                  />
                  <Button type="submit" disabled={busy}>
                    <Plus size={15} /> Add suggestion
                  </Button>
                </form>
              </CardContent>
            </Card>

            <section className="public-song-section">
              <div className="playlist-section-heading">
                <div>
                  <h2>Guest picks</h2>
                  <p>Vote once for every song you would love to hear.</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy || !access}
                  onClick={() => access && void load(access)}
                >
                  <RefreshCw size={14} /> Refresh
                </Button>
              </div>
              {playlist.songs.length ? (
                <div className="public-song-list">
                  {[...playlist.songs]
                    .sort((a, b) => b.voter_ids.length - a.voter_ids.length)
                    .map((song) => {
                      const selected = song.voter_ids.includes(guestId);
                      const moment = playlist.moments.find(
                        ({ id }) => id === song.moment_id,
                      );
                      return (
                        <article key={song.id}>
                          <div>
                            <h3>{song.title}</h3>
                            <p>{song.artist}</p>
                            <div className="playlist-badges">
                              {moment && (
                                <Badge variant="outline">{moment.name}</Badge>
                              )}
                              <Badge variant="outline">
                                Suggested by{" "}
                                {song.contributors
                                  .map(({ name: contributor }) => contributor)
                                  .join(", ")}
                              </Badge>
                            </div>
                          </div>
                          <Button
                            variant={selected ? "default" : "outline"}
                            disabled={busy}
                            aria-pressed={selected}
                            onClick={() => void vote(song.id, !selected)}
                          >
                            <ThumbsUp size={15} /> {song.voter_ids.length}
                          </Button>
                        </article>
                      );
                    })}
                </div>
              ) : (
                <p className="public-empty">
                  No suggestions yet. Yours can be first.
                </p>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
