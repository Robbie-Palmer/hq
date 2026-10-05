import posthog from "posthog-js";

// Each Cloudflare Pages deploy serves only its own hashed chunks. A page that
// loaded before a deploy keeps the old webpack runtime, so its next lazy
// import asks for a chunk file that no longer exists. A reload fetches the
// current document and runtime, which resolve the chunk again.
const LAST_RELOAD_KEY = "stale-chunk-reload-at";
const RELOAD_GUARD_MS = 60_000;

let reloadRequested = false;

export function isChunkLoadError(error: unknown): boolean {
  return error instanceof Error && error.name === "ChunkLoadError";
}

function reloadedRecently(): boolean {
  const lastReload = Number(sessionStorage.getItem(LAST_RELOAD_KEY));
  return Date.now() - lastReload < RELOAD_GUARD_MS;
}

/**
 * Reloads the page once when a lazy chunk fails to load. Returns false when a
 * reload cannot help (offline, or a reload already failed to fix the chunk), so
 * the caller can show its own error.
 */
export function recoverFromStaleChunk(error: unknown): boolean {
  if (!isChunkLoadError(error)) return false;
  if (reloadRequested) return true;
  if (!navigator.onLine) return false;

  try {
    if (reloadedRecently()) return false;
    sessionStorage.setItem(LAST_RELOAD_KEY, String(Date.now()));
  } catch {
    // Without storage there is no loop guard, so do not reload.
    return false;
  }

  reloadRequested = true;
  posthog.captureException(error, { stale_chunk_recovery: "reload" });
  window.location.reload();
  return true;
}
