/* Robbie's Recipes service worker. Keep cache version changes explicit so an
 * update never mixes incompatible application shells or private data. */
const SHELL_CACHE = "recipe-shell-v5";
const ASSET_CACHE = "recipe-assets-v5";
const IMAGE_CACHE = "recipe-images-v2";
const SESSION_CACHE = "recipe-session-v1";
const SESSION_CACHE_KEY = "/recipes/__offline-session";
const MAX_RECIPE_IMAGES = 60;

const APP_SHELL_PATHS = new Set([
  "/recipes",
  "/recipes/add",
  "/recipes/cooks",
  "/recipes/discover",
  "/recipes/edit",
  "/recipes/kitchen",
  "/recipes/log",
  "/recipes/notifications",
  "/recipes/offline",
  "/recipes/onboarding",
  "/recipes/profile",
  "/recipes/saved",
  "/recipes/settings",
  "/recipes/settings/agents/approve",
  "/recipes/shopping",
]);
const REQUIRED_SHELL_PATHS = [
  "/recipes",
  "/recipes/saved",
  "/recipes/offline",
];
let inFlightSessionRequest;

function isSuccessful(response) {
  return response.ok || response.type === "opaque";
}

function isHtmlResponse(response) {
  return (
    response.headers.get("content-type")?.split(";", 1)[0]?.trim() ===
    "text/html"
  );
}

function documentRequest(url) {
  return new Request(new URL(url, self.location.origin), {
    cache: "reload",
    credentials: "same-origin",
    headers: { accept: "text/html" },
  });
}

function isSessionRequest(url, request) {
  return (
    request.method === "GET" &&
    (url.pathname === "/api/auth/get-session" ||
      url.pathname === "/api/auth/session")
  );
}

function isSignOutRequest(url, request) {
  return request.method === "POST" && url.pathname === "/api/auth/sign-out";
}

function isVersionedAsset(url, request) {
  return (
    url.origin === self.location.origin &&
    (url.pathname.startsWith("/_next/static/") ||
      url.pathname.startsWith("/recipes/icons/") ||
      url.pathname === "/recipes/manifest.webmanifest" ||
      request.destination === "font" ||
      request.destination === "style" ||
      request.destination === "script")
  );
}

function isRecipeImage(url, request) {
  return (
    request.destination === "image" && url.hostname === "imagedelivery.net"
  );
}

async function responseForStorage(response) {
  if (response.type === "opaque") return response.clone();
  const headers = new Headers(response.headers);
  headers.delete("set-cookie");
  headers.delete("set-cookie2");
  return new Response(await response.clone().arrayBuffer(), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function deletePrivateCaches() {
  await Promise.all([caches.delete(SESSION_CACHE), caches.delete(IMAGE_CACHE)]);
}

function sessionUserId(value) {
  return value &&
    typeof value === "object" &&
    value.user &&
    typeof value.user === "object" &&
    typeof value.user.id === "string"
    ? value.user.id
    : null;
}

function sessionIsExpired(value) {
  const expiresAt = value?.session?.expiresAt;
  if (typeof expiresAt !== "string") return false;
  const expiry = Date.parse(expiresAt);
  return Number.isFinite(expiry) && expiry <= Date.now();
}

async function activateSession(response) {
  try {
    const value = await response.clone().json();
    const userId = sessionUserId(value);
    if (
      !userId ||
      !value.session ||
      typeof value.session !== "object" ||
      Array.isArray(value.session) ||
      sessionIsExpired(value)
    ) {
      await deletePrivateCaches();
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function fetchSession(request) {
  const cache = await caches.open(SESSION_CACHE);
  const cacheKey = new Request(
    new URL(SESSION_CACHE_KEY, self.location.origin),
  );
  try {
    const response = await fetch(request);
    if (response.ok) {
      if (await activateSession(response)) {
        await cache.put(cacheKey, await responseForStorage(response));
      }
      return response;
    }
    if (response.status === 401 || response.status === 403) {
      await deletePrivateCaches();
      return response;
    }
    if (response.status < 500) return response;
    const cached = await cache.match(cacheKey);
    if (!cached || !(await activateSession(cached))) return response;
    return cached;
  } catch (error) {
    const cached = await cache.match(cacheKey);
    if (!cached || !(await activateSession(cached))) throw error;
    return cached;
  }
}

async function handleSessionRequest(request) {
  if (!inFlightSessionRequest) {
    const pendingRequest = fetchSession(request);
    inFlightSessionRequest = pendingRequest;
    void pendingRequest.then(
      () => {
        if (inFlightSessionRequest === pendingRequest) {
          inFlightSessionRequest = undefined;
        }
      },
      () => {
        if (inFlightSessionRequest === pendingRequest) {
          inFlightSessionRequest = undefined;
        }
      },
    );
  }
  return (await inFlightSessionRequest).clone();
}

async function handleSignOut(request) {
  const response = await fetch(request);
  if (response.ok) await deletePrivateCaches();
  return response;
}

function documentAssetUrls(html, baseUrl) {
  const urls = new Set();
  const attributePattern = /(?:href|src)=["']([^"']+)["']/g;
  for (const match of html.matchAll(attributePattern)) {
    const value = match[1];
    if (!value) continue;
    const url = new URL(value, baseUrl);
    if (
      url.origin === self.location.origin &&
      (url.pathname.startsWith("/_next/static/") ||
        url.pathname.startsWith("/recipes/icons/"))
    ) {
      urls.add(url.href);
    }
  }
  return [...urls];
}

function scriptWasmUrls(script) {
  return [
    ...new Set(
      [...script.matchAll(/\.v\([^,]+,[^,]+,"([a-f0-9]{16})"/g)].map(
        (match) =>
          new URL(
            `/_next/static/wasm/${match[1]}.wasm`,
            self.location.origin,
          ).href,
      ),
    ),
  ];
}

async function cacheShellAsset(url, cache) {
  if (await cache.match(url)) return;
  const response = await fetch(url, { cache: "reload" });
  if (!response.ok) return;
  await cache.put(url, response.clone());
  if (!new URL(url).pathname.endsWith(".js")) return;

  await Promise.allSettled(
    scriptWasmUrls(await response.text()).map(async (wasmUrl) => {
      const wasmResponse = await fetch(wasmUrl, { cache: "reload" });
      if (wasmResponse.ok) await cache.put(wasmUrl, wasmResponse);
    }),
  );
}

async function cacheShellDocument(path) {
  const response = await fetch(documentRequest(path));
  if (!response.ok || !isHtmlResponse(response)) {
    throw new Error(`Could not cache HTML for ${path}`);
  }
  const shell = await caches.open(SHELL_CACHE);
  await shell.put(path, response.clone());
  const html = await response.text();
  const assets = await caches.open(ASSET_CACHE);
  await Promise.allSettled(
    documentAssetUrls(html, new URL(path, self.location.origin)).map((url) =>
      cacheShellAsset(url, assets),
    ),
  );
}

async function cacheAppShell() {
  for (const path of REQUIRED_SHELL_PATHS) await cacheShellDocument(path);
  const assets = await caches.open(ASSET_CACHE);
  await Promise.allSettled([
    assets.add("/recipes/manifest.webmanifest"),
    assets.add("/recipes/icons/recipe-app.svg"),
    assets.add("/recipes/icons/recipe-app-180.png"),
    assets.add("/recipes/icons/recipe-app-192.png"),
    assets.add("/recipes/icons/recipe-app-512.png"),
  ]);
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (isSuccessful(response)) {
    await cache.put(request, response.clone());
  }
  return response;
}

async function trimCache(cache, maximumEntries) {
  const keys = await cache.keys();
  await Promise.all(
    keys.slice(0, Math.max(0, keys.length - maximumEntries)).map((key) =>
      cache.delete(key),
    ),
  );
}

async function cacheRecipeImage(request) {
  const cache = await caches.open(IMAGE_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (isSuccessful(response)) {
    await cache.put(request, response.clone());
    await trimCache(cache, MAX_RECIPE_IMAGES);
  }
  return response;
}

function offlineShellPath(pathname) {
  let pathEnd = pathname.length;
  while (pathEnd > 1 && pathname[pathEnd - 1] === "/") pathEnd -= 1;
  const normalizedPathname = pathname.slice(0, pathEnd);
  if (normalizedPathname === "/recipes") return "/recipes";
  if (normalizedPathname === "/recipes/saved") return "/recipes/saved";
  if (APP_SHELL_PATHS.has(normalizedPathname)) return "/recipes/offline";
  if (/^\/recipes\/[^/]+$/.test(normalizedPathname)) {
    return "/recipes/saved";
  }
  return "/recipes/offline";
}

async function offlineShellResponse(cache, pathname) {
  return (
    (await cache.match(offlineShellPath(pathname))) ??
    (await cache.match("/recipes"))
  );
}

function unavailableDocumentResponse() {
  return new Response(
    "<!doctype html><title>Recipes unavailable</title><p>This page could not be loaded.</p>",
    {
      status: 503,
      headers: { "content-type": "text/html; charset=utf-8" },
    },
  );
}

async function handleNavigation(request) {
  const url = new URL(request.url);
  const shell = await caches.open(SHELL_CACHE);
  try {
    let response = await fetch(request);
    if (response.status < 500 && !isHtmlResponse(response)) {
      response = await fetch(documentRequest(url));
    }
    if (
      response.ok &&
      isHtmlResponse(response) &&
      APP_SHELL_PATHS.has(url.pathname)
    ) {
      await shell.put(url.pathname, response.clone());
    }
    if (response.status < 500 && isHtmlResponse(response)) return response;
    return (
      (await offlineShellResponse(shell, url.pathname)) ??
      (isHtmlResponse(response) ? response : unavailableDocumentResponse())
    );
  } catch {
    return (
      (await offlineShellResponse(shell, url.pathname)) ??
      unavailableDocumentResponse()
    );
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(cacheAppShell().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  const currentCaches = new Set([
    SHELL_CACHE,
    ASSET_CACHE,
    IMAGE_CACHE,
    SESSION_CACHE,
  ]);
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter(
              (name) =>
                name.startsWith("recipe-") && !currentCaches.has(name),
            )
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.origin !== self.location.origin) return;
  if (event.data?.type === "CLEAR_RECIPE_OFFLINE_DATA") {
    event.waitUntil(deletePrivateCaches());
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (isSignOutRequest(url, request)) {
    event.respondWith(handleSignOut(request));
    return;
  }
  if (isSessionRequest(url, request)) {
    event.respondWith(handleSessionRequest(request));
    return;
  }
  if (request.mode === "navigate" && url.pathname.startsWith("/recipes")) {
    event.respondWith(handleNavigation(request));
    return;
  }
  if (isVersionedAsset(url, request)) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
    return;
  }
  if (isRecipeImage(url, request)) {
    event.respondWith(cacheRecipeImage(request));
  }
});
