import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

type WorkerListener = (event: Record<string, unknown>) => void;

class MemoryCache {
  private readonly responses = new Map<string, Response>();

  async add(request: RequestInfo | URL) {
    const response = await fetch(request);
    await this.put(request, response);
  }

  async delete(request: RequestInfo | URL) {
    return this.responses.delete(this.key(request));
  }

  async keys() {
    return [...this.responses.keys()].map((url) => new Request(url));
  }

  async match(request: RequestInfo | URL) {
    return this.responses.get(this.key(request))?.clone();
  }

  async put(request: RequestInfo | URL, response: Response) {
    this.responses.set(this.key(request), response.clone());
  }

  private key(request: RequestInfo | URL) {
    const value = request instanceof Request ? request.url : String(request);
    return new URL(value, "https://recipes.example.test").href;
  }
}

function serviceWorkerHarness(fetchMock: typeof fetch) {
  const listeners = new Map<string, WorkerListener>();
  const stores = new Map<string, MemoryCache>();
  const cacheStorage = {
    delete: async (name: string) => stores.delete(name),
    keys: async () => [...stores.keys()],
    open: async (name: string) => {
      const existing = stores.get(name);
      if (existing) return existing;
      const cache = new MemoryCache();
      stores.set(name, cache);
      return cache;
    },
  };
  const workerSelf = {
    addEventListener: (type: string, listener: WorkerListener) =>
      listeners.set(type, listener),
    clients: { claim: vi.fn() },
    location: { origin: "https://recipes.example.test" },
    skipWaiting: vi.fn(),
  };
  const source = readFileSync(
    path.resolve(__dirname, "../../public/recipes-sw.js"),
    "utf8",
  );
  const loadWorker = new Function("self", "caches", "fetch", source);
  loadWorker(workerSelf, cacheStorage, fetchMock);

  return {
    async activate() {
      let pending = Promise.resolve();
      listeners.get("activate")?.({
        waitUntil: (promise: Promise<unknown>) => {
          pending = promise.then(() => undefined);
        },
      });
      await pending;
    },
    async install() {
      let pending = Promise.resolve();
      listeners.get("install")?.({
        waitUntil: (promise: Promise<unknown>) => {
          pending = promise.then(() => undefined);
        },
      });
      await pending;
    },
    async message(data: unknown, origin = "https://recipes.example.test") {
      let pending = Promise.resolve();
      listeners.get("message")?.({
        data,
        origin,
        waitUntil: (promise: Promise<unknown>) => {
          pending = promise.then(() => undefined);
        },
      });
      await pending;
    },
    async request(request: Request) {
      let response: Promise<Response> | undefined;
      listeners.get("fetch")?.({
        request,
        respondWith: (value: Promise<Response>) => {
          response = value;
        },
        waitUntil: vi.fn(),
      });
      if (!response) throw new Error("The worker did not handle the request");
      return response;
    },
    stores,
  };
}

describe("recipe service worker", () => {
  it("removes the previous shell caches when the worker updates", async () => {
    const worker = serviceWorkerHarness(vi.fn<typeof fetch>());
    worker.stores.set("recipe-shell-v4", new MemoryCache());
    worker.stores.set("recipe-assets-v4", new MemoryCache());
    worker.stores.set("recipe-shell-v5", new MemoryCache());

    await worker.activate();

    expect([...worker.stores.keys()]).toEqual(["recipe-shell-v5"]);
  });

  it("precaches the recipe shells and WebAssembly needed to render them", async () => {
    const wasmHash = "0123456789abcdef";
    const fetchMock = vi.fn<typeof fetch>(async (request) => {
      const value = request instanceof Request ? request.url : String(request);
      const url = new URL(value, "https://recipes.example.test");
      if (
        url.pathname === "/recipes" ||
        url.pathname === "/recipes/saved" ||
        url.pathname === "/recipes/offline"
      ) {
        return new Response(
          '<script src="/_next/static/chunks/recipes.js"></script>',
          { headers: { "content-type": "text/html" } },
        );
      }
      if (url.pathname.endsWith("/recipes.js")) {
        return new Response(`runtime.v(target,module,"${wasmHash}",imports)`);
      }
      if (url.pathname.endsWith(`${wasmHash}.wasm`)) {
        return new Response(new Uint8Array([0, 97, 115, 109]));
      }
      return new Response("Not found", { status: 404 });
    });
    const worker = serviceWorkerHarness(fetchMock);

    await worker.install();

    const shellKeys = await worker.stores.get("recipe-shell-v5")?.keys();
    const assetKeys = await worker.stores.get("recipe-assets-v5")?.keys();
    expect(shellKeys?.map((key) => new URL(key.url).pathname)).toEqual([
      "/recipes",
      "/recipes/saved",
      "/recipes/offline",
    ]);
    expect(assetKeys?.map((key) => new URL(key.url).pathname)).toContain(
      `/_next/static/wasm/${wasmHash}.wasm`,
    );
  });

  it("refuses to precache a React Server Components payload as a shell", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response('1:"$Sreact.fragment"', {
          headers: { "content-type": "text/x-component" },
        }),
    );
    const worker = serviceWorkerHarness(fetchMock);

    await expect(worker.install()).rejects.toThrow(
      "Could not cache HTML for /recipes",
    );
    expect(worker.stores.has("recipe-shell-v5")).toBe(false);
  });

  it("shows the offline page for unavailable tabs without treating them as recipes", async () => {
    let offline = false;
    const fetchMock = vi.fn<typeof fetch>(async (request) => {
      const value = request instanceof Request ? request.url : String(request);
      const url = new URL(value, "https://recipes.example.test");
      if (offline) throw new TypeError("offline");
      if (
        url.pathname === "/recipes" ||
        url.pathname === "/recipes/saved" ||
        url.pathname === "/recipes/offline"
      ) {
        return new Response(`<main>${url.pathname}</main>`, {
          headers: { "content-type": "text/html" },
        });
      }
      return new Response("Not found", { status: 404 });
    });
    const worker = serviceWorkerHarness(fetchMock);
    await worker.install();
    offline = true;

    const navigation = (pathname: string) =>
      ({
        destination: "document",
        method: "GET",
        mode: "navigate",
        url: `https://recipes.example.test${pathname}`,
      }) as Request;

    await expect(
      worker.request(navigation("/recipes/kitchen/")),
    ).resolves.toHaveProperty("status", 200);
    expect(
      await (await worker.request(navigation("/recipes/kitchen/"))).text(),
    ).toContain("/recipes/offline");
    expect(
      await (await worker.request(navigation("/recipes/lentil-soup/"))).text(),
    ).toContain("/recipes/saved");
    expect(
      await (
        await worker.request(navigation("/recipes/settings?section=diet"))
      ).text(),
    ).toContain("/recipes/offline");
    expect(
      await (await worker.request(navigation("/recipes"))).text(),
    ).toContain("/recipes");
  });

  it("uses an unexpired cached session to reopen the app offline", async () => {
    const sessionRequest = new Request(
      "https://recipes.example.test/api/auth/get-session",
    );
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          session: { expiresAt: "2099-01-01T00:00:00.000Z" },
          user: { id: "user-1" },
        }),
      )
      .mockRejectedValue(new TypeError("offline"));
    const worker = serviceWorkerHarness(fetchMock);

    await worker.request(sessionRequest);
    expect(await (await worker.request(sessionRequest)).json()).toMatchObject({
      user: { id: "user-1" },
    });
  });

  it("does not cache malformed sessions", async () => {
    const sessionRequest = new Request(
      "https://recipes.example.test/api/auth/get-session",
    );
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ session: null, user: { id: "user-1" } }),
      )
      .mockRejectedValue(new TypeError("offline"));
    const worker = serviceWorkerHarness(fetchMock);

    await worker.request(sessionRequest);

    await expect(worker.request(sessionRequest)).rejects.toThrow("offline");
  });

  it("shares one network request between concurrent session checks", async () => {
    const sessionRequest = new Request(
      "https://recipes.example.test/api/auth/get-session",
    );
    let resolveSession: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn<typeof fetch>(
      () =>
        new Promise<Response>((resolve) => {
          resolveSession = resolve;
        }),
    );
    const worker = serviceWorkerHarness(fetchMock);

    const first = worker.request(sessionRequest);
    const second = worker.request(sessionRequest);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    resolveSession?.(
      Response.json({
        session: { expiresAt: "2099-01-01T00:00:00.000Z" },
        user: { id: "user-1" },
      }),
    );

    await expect(first).resolves.toHaveProperty("status", 200);
    await expect(second).resolves.toHaveProperty("status", 200);
  });

  it("clears private caches when the server rejects the session", async () => {
    const sessionRequest = new Request(
      "https://recipes.example.test/api/auth/get-session",
    );
    const imageRequest = {
      destination: "image",
      method: "GET",
      url: "https://images.example.test/recipe.jpg",
    } as Request;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          session: { expiresAt: "2099-01-01T00:00:00.000Z" },
          user: { id: "user-1" },
        }),
      )
      .mockResolvedValueOnce(new Response("image"))
      .mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }));
    const worker = serviceWorkerHarness(fetchMock);

    await worker.request(sessionRequest);
    await worker.request(imageRequest);
    expect([...worker.stores.keys()]).toEqual(
      expect.arrayContaining(["recipe-session-v1", "recipe-images-v1"]),
    );

    await expect(worker.request(sessionRequest)).resolves.toHaveProperty(
      "status",
      401,
    );
    expect([...worker.stores.keys()]).not.toContain("recipe-session-v1");
    expect([...worker.stores.keys()]).not.toContain("recipe-images-v1");
  });

  it("never serves a React Server Components payload as a document", async () => {
    let navigationResponse = "install";
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing function predates the complexity limit; new violations remain prohibited.
    const fetchMock = vi.fn<typeof fetch>(async (request) => {
      const value =
        typeof request === "string" || request instanceof URL
          ? String(request)
          : request.url;
      const url = new URL(value, "https://recipes.example.test");
      if (navigationResponse === "offline") throw new TypeError("offline");
      if (
        url.pathname === "/recipes" ||
        url.pathname === "/recipes/saved" ||
        url.pathname === "/recipes/offline"
      ) {
        if (
          navigationResponse === "rsc" &&
          request instanceof Request &&
          request.headers.get("rsc") === "1"
        ) {
          return new Response('1:"$Sreact.fragment"', {
            headers: { "content-type": "text/x-component" },
          });
        }
        const label =
          navigationResponse === "rsc" ? "fresh HTML" : url.pathname;
        return new Response(`<main>${label}</main>`, {
          headers: { "content-type": "text/html" },
        });
      }
      return new Response("Not found", { status: 404 });
    });
    const worker = serviceWorkerHarness(fetchMock);
    await worker.install();
    const navigation = new Request("https://recipes.example.test/recipes", {
      headers: { accept: "text/x-component", rsc: "1" },
    });
    Object.defineProperty(navigation, "mode", { value: "navigate" });

    navigationResponse = "rsc";
    expect(await (await worker.request(navigation)).text()).toContain(
      "fresh HTML",
    );
    const retryRequest = fetchMock.mock.calls.at(-1)?.[0];
    expect(retryRequest).toBeInstanceOf(Request);
    expect((retryRequest as Request).headers.get("accept")).toBe("text/html");
    expect((retryRequest as Request).headers.has("rsc")).toBe(false);
    navigationResponse = "offline";

    expect(await (await worker.request(navigation)).text()).toContain(
      "fresh HTML",
    );
  });

  it("removes the cached session when private offline data is cleared", async () => {
    const sessionRequest = new Request(
      "https://recipes.example.test/api/auth/get-session",
    );
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          session: { expiresAt: "2099-01-01T00:00:00.000Z" },
          user: { id: "user-1" },
        }),
      )
      .mockRejectedValue(new TypeError("offline"));
    const worker = serviceWorkerHarness(fetchMock);
    await worker.request(sessionRequest);

    await worker.message(
      { type: "CLEAR_RECIPE_OFFLINE_DATA" },
      "https://malicious.example.test",
    );
    expect([...worker.stores.keys()]).toContain("recipe-session-v1");

    await worker.message({ type: "CLEAR_RECIPE_OFFLINE_DATA" });

    expect([...worker.stores.keys()]).not.toContain("recipe-session-v1");
    await expect(worker.request(sessionRequest)).rejects.toThrow("offline");
  });
});
