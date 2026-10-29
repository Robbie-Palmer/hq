export interface GuestPlaylistSessionRepository {
  loadGuestId(playlistId: string): string | null;
  loadGuestName(playlistId: string): string;
  saveGuestId(playlistId: string, guestId: string): void;
  saveGuestName(playlistId: string, name: string): void;
}

export function createGuestPlaylistSession(
  repository: GuestPlaylistSessionRepository,
  createId: () => string,
) {
  return {
    load(playlistId: string) {
      let guestId = repository.loadGuestId(playlistId);
      if (!guestId) {
        guestId = createId();
        repository.saveGuestId(playlistId, guestId);
      }
      return { guestId, name: repository.loadGuestName(playlistId) };
    },
    saveName(playlistId: string, name: string) {
      repository.saveGuestName(playlistId, name);
    },
  };
}

function sessionKey(playlistId: string, field: "guest-id" | "guest-name") {
  return `wedding-playlist:${playlistId}:${field}`;
}

const memorySession = new Map<string, string>();

function loadSessionValue(key: string): string | null {
  try {
    const stored = window.localStorage.getItem(key);
    if (stored !== null) memorySession.set(key, stored);
    return stored ?? memorySession.get(key) ?? null;
  } catch {
    return memorySession.get(key) ?? null;
  }
}

function saveSessionValue(key: string, value: string): void {
  memorySession.set(key, value);
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // The in-memory value keeps the guest session stable for this page load.
  }
}

const browserGuestPlaylistSessionRepository: GuestPlaylistSessionRepository = {
  loadGuestId: (playlistId) =>
    loadSessionValue(sessionKey(playlistId, "guest-id")),
  loadGuestName: (playlistId) =>
    loadSessionValue(sessionKey(playlistId, "guest-name")) ?? "",
  saveGuestId: (playlistId, guestId) =>
    saveSessionValue(sessionKey(playlistId, "guest-id"), guestId),
  saveGuestName: (playlistId, name) =>
    saveSessionValue(sessionKey(playlistId, "guest-name"), name),
};

export const browserGuestPlaylistSession = createGuestPlaylistSession(
  browserGuestPlaylistSessionRepository,
  () => crypto.randomUUID(),
);
