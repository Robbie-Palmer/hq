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

const browserGuestPlaylistSessionRepository: GuestPlaylistSessionRepository = {
  loadGuestId: (playlistId) =>
    window.localStorage.getItem(sessionKey(playlistId, "guest-id")),
  loadGuestName: (playlistId) =>
    window.localStorage.getItem(sessionKey(playlistId, "guest-name")) ?? "",
  saveGuestId: (playlistId, guestId) =>
    window.localStorage.setItem(sessionKey(playlistId, "guest-id"), guestId),
  saveGuestName: (playlistId, name) =>
    window.localStorage.setItem(sessionKey(playlistId, "guest-name"), name),
};

export const browserGuestPlaylistSession = createGuestPlaylistSession(
  browserGuestPlaylistSessionRepository,
  () => crypto.randomUUID(),
);
