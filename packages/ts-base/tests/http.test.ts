import { describe, expect, it, vi } from "vitest";

import { fetchWithRetry, JsonClient } from "../src/http";

describe("fetchWithRetry", () => {
  it("retries transient responses and network failures", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce(new Response("ok"));

    await expect(
      fetchWithRetry("https://example.com/resource", { fetch }),
    ).resolves.toBeInstanceOf(Response);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("returns non-retryable responses without another request", async () => {
    const response = new Response("missing", { status: 404 });
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response);

    await expect(
      fetchWithRetry("https://example.com/missing", { fetch }),
    ).resolves.toBe(response);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("requires at least one attempt", async () => {
    await expect(
      fetchWithRetry("https://example.com/resource", { attempts: 0 }),
    ).rejects.toThrow("Fetch attempts must be a positive integer");
  });
});

describe("JsonClient", () => {
  it("retries retryable responses using an injected wait", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    const wait = vi.fn().mockResolvedValue(undefined);
    const client = new JsonClient("https://example.com", {}, {
      fetch,
      random: () => 0,
      wait,
      retries: 2,
    });

    await expect(client.request("GET", "/resource")).resolves.toEqual({
      ok: true,
    });
    expect(wait).toHaveBeenCalledWith(1_000);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not retry ordinary client errors", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response("missing", { status: 404 }));
    const client = new JsonClient("https://example.com", {}, {
      fetch,
      retries: 3,
    });

    await expect(client.request("GET", "/missing")).rejects.toThrow(
      "GET /missing failed (404)",
    );
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("does not retry non-idempotent requests by default", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response("unavailable", { status: 503 }));
    const client = new JsonClient("https://example.com", {}, {
      fetch,
      retries: 3,
    });

    await expect(client.request("POST", "/resource")).rejects.toThrow(
      "POST /resource failed (503)",
    );
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("retries non-idempotent requests when explicitly requested", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    const client = new JsonClient("https://example.com", {}, {
      fetch,
      random: () => 0,
      wait: vi.fn().mockResolvedValue(undefined),
    });

    await expect(
      client.request("POST", "/resource", { retries: 2 }),
    ).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("honors Retry-After seconds and dates without the backoff cap", async () => {
    const retryAt = Date.parse("2026-09-28T20:02:00Z");
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response("rate limited", {
          status: 429,
          headers: { "Retry-After": "120" },
        }),
      )
      .mockResolvedValueOnce(
        new Response("rate limited", {
          status: 429,
          headers: { "Retry-After": new Date(retryAt).toUTCString() },
        }),
      )
      .mockResolvedValueOnce(Response.json({ ok: true }));
    const wait = vi.fn().mockResolvedValue(undefined);
    const client = new JsonClient("https://example.com", {}, {
      fetch,
      now: () => retryAt - 60_000,
      random: () => 0,
      wait,
      retries: 3,
    });

    await expect(client.request("GET", "/resource")).resolves.toEqual({
      ok: true,
    });
    expect(wait).toHaveBeenNthCalledWith(1, 120_000);
    expect(wait).toHaveBeenNthCalledWith(2, 60_000);
  });
});
