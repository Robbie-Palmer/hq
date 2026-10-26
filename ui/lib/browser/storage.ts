export type BrowserStorageKind = "localStorage" | "sessionStorage";

function browserStorage(kind: BrowserStorageKind): Storage | null {
  try {
    return globalThis[kind] ?? null;
  } catch {
    return null;
  }
}

export function readBrowserStorage(
  kind: BrowserStorageKind,
  key: string,
): string | null {
  try {
    return browserStorage(kind)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeBrowserStorage(
  kind: BrowserStorageKind,
  key: string,
  value: string,
): boolean {
  try {
    const storage = browserStorage(kind);
    if (!storage) return false;
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeBrowserStorage(
  kind: BrowserStorageKind,
  key: string,
): boolean {
  try {
    const storage = browserStorage(kind);
    if (!storage) return false;
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function readBrowserStorageJson<T>(
  kind: BrowserStorageKind,
  key: string,
  accepts: (value: unknown) => value is T,
): T | null {
  const raw = readBrowserStorage(kind, key);
  if (raw === null) return null;

  try {
    const value: unknown = JSON.parse(raw);
    return accepts(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeBrowserStorageJson(
  kind: BrowserStorageKind,
  key: string,
  value: unknown,
): boolean {
  try {
    return writeBrowserStorage(kind, key, JSON.stringify(value));
  } catch {
    return false;
  }
}
