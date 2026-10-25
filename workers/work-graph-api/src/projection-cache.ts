const PROJECTION_CACHE_TTL_SECONDS = 5;
const GENERATION_CACHE_TTL_SECONDS = 31_536_000;
const GENERATION_PATH = "/.work-graph-cache/projection-generation";
const CACHE_GENERATION_QUERY = "__work_graph_cache_generation";
const CACHE_VERSION_QUERY = "__work_graph_worker_version";

export type ProjectionCacheOperation = "lookup" | "store" | "invalidate";

export interface ProjectionCacheLookup {
  key?: Request;
  response?: Response;
}

type CacheErrorReporter = (operation: ProjectionCacheOperation) => void;

const cacheablePath = (pathname: string): boolean =>
  pathname === "/api/work-items" ||
  pathname === "/api/critical-path" ||
  /^\/api\/work-items\/[^/]+\/details$/u.test(pathname);

export const isCacheableProjectionRequest = (request: Request): boolean =>
  request.method === "GET" && cacheablePath(new URL(request.url).pathname);

export const isSuccessfulMutationRequest = (
  request: Request,
  response: Response,
): boolean =>
  ["POST", "PUT", "DELETE"].includes(request.method) && response.ok;

const responseWithHeaders = (
  response: Response,
  headers: Headers,
): Response =>
  new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });

const storedResponse = (response: Response): Response => {
  const headers = new Headers(response.headers);
  headers.delete("X-Request-Id");
  headers.delete("X-Work-Graph-Cache");
  headers.set("Cache-Control", `max-age=${PROJECTION_CACHE_TTL_SECONDS}`);
  return responseWithHeaders(response, headers);
};

const clientResponse = (
  response: Response,
  cacheStatus: "hit" | "miss",
): Response => {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Work-Graph-Cache", cacheStatus);
  if (cacheStatus === "hit") headers.set("X-Request-Id", crypto.randomUUID());
  return responseWithHeaders(response, headers);
};

export class WorkGraphProjectionCache {
  readonly #cache: Cache;
  readonly #reportError: CacheErrorReporter;
  readonly #workerVersion: string;

  constructor(
    cache: Cache,
    workerVersion = "local",
    reportError: CacheErrorReporter = () => undefined,
  ) {
    this.#cache = cache;
    this.#reportError = reportError;
    this.#workerVersion = workerVersion;
  }

  #generationKey(request: Request): Request {
    const url = new URL(request.url);
    url.pathname = GENERATION_PATH;
    url.search = "";
    url.hash = "";
    return new Request(url, { method: "GET" });
  }

  async #generation(request: Request): Promise<string> {
    const key = this.#generationKey(request);
    const cached = await this.#cache.match(key);
    if (cached !== undefined) {
      const generation = await cached.text();
      if (generation !== "") return generation;
    }

    const generation = crypto.randomUUID();
    await this.#cache.put(
      key,
      new Response(generation, {
        headers: {
          "Cache-Control": `max-age=${GENERATION_CACHE_TTL_SECONDS}`,
          "Content-Type": "text/plain; charset=utf-8",
        },
      }),
    );
    return generation;
  }

  async lookup(request: Request): Promise<ProjectionCacheLookup> {
    try {
      const generation = await this.#generation(request);
      const url = new URL(request.url);
      url.searchParams.delete(CACHE_GENERATION_QUERY);
      url.searchParams.delete(CACHE_VERSION_QUERY);
      url.searchParams.sort();
      url.searchParams.set(CACHE_GENERATION_QUERY, generation);
      url.searchParams.set(CACHE_VERSION_QUERY, this.#workerVersion);
      const key = new Request(url, { method: "GET" });
      const cached = await this.#cache.match(key);
      return cached === undefined
        ? { key }
        : { key, response: clientResponse(cached, "hit") };
    } catch {
      this.#reportError("lookup");
      return {};
    }
  }

  async store(key: Request, response: Response): Promise<void> {
    try {
      await this.#cache.put(key, storedResponse(response));
    } catch {
      this.#reportError("store");
    }
  }

  markMiss(response: Response): Response {
    return clientResponse(response, "miss");
  }

  async invalidate(request: Request): Promise<void> {
    try {
      await this.#cache.put(
        this.#generationKey(request),
        new Response(crypto.randomUUID(), {
          headers: {
            "Cache-Control": `max-age=${GENERATION_CACHE_TTL_SECONDS}`,
            "Content-Type": "text/plain; charset=utf-8",
          },
        }),
      );
    } catch {
      this.#reportError("invalidate");
    }
  }
}
