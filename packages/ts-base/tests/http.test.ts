import { describe, expect, it, vi } from "vitest";

import { JsonClient } from "../src/http";

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
});
