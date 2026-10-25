import { describe, expect, it, vi } from "vitest";
import {
  isCacheableProjectionRequest,
  isSuccessfulMutationRequest,
  WorkGraphProjectionCache,
} from "../src/projection-cache";

const keyFor = (request: RequestInfo): string =>
  request instanceof Request ? request.url : request.toString();

const memoryCache = () => {
  const entries = new Map<string, Response>();
  const cache = {
    match: vi.fn(async (request: RequestInfo) =>
      entries.get(keyFor(request))?.clone(),
    ),
    put: vi.fn(async (request: RequestInfo, response: Response) => {
      entries.set(keyFor(request), response.clone());
    }),
  } as unknown as Cache;
  return { cache, entries };
};

describe("Given the Work Graph projection cache", () => {
  it.each([
    "/api/work-items",
    "/api/work-items?stage=ready",
    "/api/critical-path?rootWorkItemId=outcome",
    "/api/work-items/ticket/details",
  ])("recognizes cacheable GET %s", (path) => {
    expect(
      isCacheableProjectionRequest(
        new Request(`https://work.example.test${path}`),
      ),
    ).toBe(true);
  });

  it.each([
    ["POST", "/api/work-items"],
    ["GET", "/api/work-items/ticket"],
    ["GET", "/api/work-items/ticket/evidence"],
    ["GET", "/health"],
  ])("does not cache %s %s", (method, path) => {
    expect(
      isCacheableProjectionRequest(
        new Request(`https://work.example.test${path}`, { method }),
      ),
    ).toBe(false);
  });

  it("stores a miss and serves canonical query variants from cache", async () => {
    const { cache, entries } = memoryCache();
    const projections = new WorkGraphProjectionCache(cache, "version-1");
    const firstRequest = new Request(
      "https://work.example.test/api/work-items?stage=ready&limit=10",
    );
    const lookup = await projections.lookup(firstRequest);
    expect(lookup.response).toBeUndefined();
    expect(lookup.key).toBeDefined();

    const origin = Response.json(
      { items: [{ id: "ticket" }], nextCursor: null },
      { headers: { "X-Request-Id": "origin-request" } },
    );
    await projections.store(lookup.key!, origin);

    const cachedEntry = entries.get(lookup.key!.url);
    expect(cachedEntry?.headers.get("cache-control")).toBe("max-age=5");
    expect(cachedEntry?.headers.get("x-request-id")).toBeNull();

    const hit = await projections.lookup(
      new Request(
        "https://work.example.test/api/work-items?limit=10&stage=ready",
      ),
    );
    expect(hit.response?.headers.get("x-work-graph-cache")).toBe("hit");
    expect(hit.response?.headers.get("cache-control")).toBe("no-store");
    expect(hit.response?.headers.get("x-request-id")).toBeTruthy();
    expect(await hit.response?.json()).toEqual({
      items: [{ id: "ticket" }],
      nextCursor: null,
    });

    const miss = projections.markMiss(
      new Response("fresh", { headers: { "X-Request-Id": "fresh-request" } }),
    );
    expect(miss.headers.get("x-work-graph-cache")).toBe("miss");
    expect(miss.headers.get("cache-control")).toBe("no-store");
    expect(miss.headers.get("x-request-id")).toBe("fresh-request");
  });

  it("separates entries by Worker version", async () => {
    const { cache } = memoryCache();
    const request = new Request(
      "https://work.example.test/api/critical-path",
    );
    const firstVersion = new WorkGraphProjectionCache(cache, "version-1");
    const firstLookup = await firstVersion.lookup(request);
    await firstVersion.store(firstLookup.key!, new Response("version one"));

    const secondVersion = new WorkGraphProjectionCache(cache, "version-2");
    const secondLookup = await secondVersion.lookup(request);

    expect(secondLookup.response).toBeUndefined();
    expect(secondLookup.key?.url).not.toBe(firstLookup.key?.url);
  });

  it("rotates the generation after a successful mutation", async () => {
    const { cache } = memoryCache();
    const projections = new WorkGraphProjectionCache(cache, "version-1");
    const request = new Request(
      "https://work.example.test/api/work-items/ticket/details",
    );
    const firstLookup = await projections.lookup(request);
    await projections.store(firstLookup.key!, new Response("before mutation"));
    expect((await projections.lookup(request)).response).toBeDefined();

    await projections.invalidate(
      new Request("https://work.example.test/api/work-items/ticket/notes", {
        method: "POST",
      }),
    );
    const afterMutation = await projections.lookup(request);

    expect(afterMutation.response).toBeUndefined();
    expect(afterMutation.key?.url).not.toBe(firstLookup.key?.url);
  });

  it("replaces an empty cached generation", async () => {
    const { cache, entries } = memoryCache();
    entries.set(
      "https://work.example.test/.work-graph-cache/projection-generation",
      new Response(""),
    );
    const projections = new WorkGraphProjectionCache(cache, "version-1");

    const lookup = await projections.lookup(
      new Request("https://work.example.test/api/work-items"),
    );

    expect(lookup.key?.url).toContain("__work_graph_cache_generation=");
  });

  it("fails open and reports cache operation failures", async () => {
    const report = vi.fn();
    const failingCache = {
      match: vi.fn(async () => Promise.reject(new Error("match failed"))),
      put: vi.fn(async () => Promise.reject(new Error("put failed"))),
    } as unknown as Cache;
    const projections = new WorkGraphProjectionCache(
      failingCache,
      "version-1",
      report,
    );
    const request = new Request(
      "https://work.example.test/api/work-items",
    );

    await expect(projections.lookup(request)).resolves.toEqual({});
    await expect(
      projections.store(request, new Response("value")),
    ).resolves.toBeUndefined();
    await expect(projections.invalidate(request)).resolves.toBeUndefined();
    expect(report.mock.calls).toEqual([
      ["lookup"],
      ["store"],
      ["invalidate"],
    ]);

    const withoutReporter = new WorkGraphProjectionCache(failingCache);
    await expect(withoutReporter.lookup(request)).resolves.toEqual({});
  });

  it.each([
    ["POST", 201, true],
    ["PUT", 200, true],
    ["DELETE", 204, true],
    ["GET", 200, false],
    ["POST", 409, false],
  ])(
    "classifies %s responses with status %i as mutation=%s",
    (method, status, expected) => {
      expect(
        isSuccessfulMutationRequest(
          new Request("https://work.example.test/api/work-items", { method }),
          new Response(null, { status }),
        ),
      ).toBe(expected);
    },
  );
});
