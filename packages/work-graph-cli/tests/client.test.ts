import { describe, expect, it, vi } from "vitest";
import { WorkGraphClient, type Fetch } from "../src/client.js";

const API_URL = new URL("https://work.example.test/");
const config = { apiUrl: API_URL, accessHeaders: {} };

const retryableResponse = (
  requestId: string,
  code = "database_capacity",
  retryAfter = "1",
): Response =>
  new Response(
    JSON.stringify({
      error: {
        code,
        message: "The Work Graph database is at connection capacity. Retry it.",
        requestId,
      },
    }),
    {
      status: 503,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": retryAfter,
        "X-Request-Id": requestId,
      },
    },
  );

const successResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

describe("Work Graph retry policy", () => {
  it("recovers a safe read with server-guided exponential jitter", async () => {
    const delays: number[] = [];
    const fetch = vi
      .fn<Fetch>()
      .mockResolvedValueOnce(retryableResponse("request-1"))
      .mockResolvedValueOnce(successResponse({ id: "ticket-1" }));
    const client = new WorkGraphClient(config, fetch, {
      random: () => 0.5,
      sleep: async (delayMs) => {
        delays.push(delayMs);
      },
    });

    await expect(client.getWorkItem("ticket-1")).resolves.toEqual({
      id: "ticket-1",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(delays).toEqual([1_125]);
  });

  it("returns the final server error and request ID after exhausting retries", async () => {
    let requestNumber = 0;
    const fetch = vi.fn<Fetch>(async () => {
      requestNumber += 1;
      return retryableResponse(`request-${requestNumber}`);
    });
    const client = new WorkGraphClient(config, fetch, {
      random: () => 0,
      sleep: async () => undefined,
    });

    await expect(client.getWorkItem("ticket-1")).rejects.toMatchObject({
      code: "database_capacity",
      message: "The Work Graph database is at connection capacity. Retry it.",
      requestId: "request-3",
      status: 503,
    });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("does not retry a mutation without an idempotency key", async () => {
    const fetch = vi.fn<Fetch>(async () => retryableResponse("request-1"));
    const client = new WorkGraphClient(config, fetch, {
      sleep: async () => undefined,
    });

    await expect(
      client.claim({ workerId: "agent-a", leaseDurationSeconds: 900 }),
    ).rejects.toMatchObject({ code: "database_capacity" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not let a global idempotency header make lease claims retryable", async () => {
    const fetch = vi.fn<Fetch>(async () => retryableResponse("request-1"));
    const client = new WorkGraphClient(
      {
        apiUrl: API_URL,
        accessHeaders: { "idempotency-key": crypto.randomUUID() },
      },
      fetch,
      { sleep: async () => undefined },
    );

    await expect(
      client.claim({ workerId: "agent-a", leaseDurationSeconds: 900 }),
    ).rejects.toMatchObject({ code: "database_capacity" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("replays an idempotent mutation without duplicating its effect", async () => {
    const committedKeys = new Set<string>();
    const requests: Array<{ body: string; idempotencyKey: string | null }> = [];
    let effectCount = 0;
    const fetch = vi.fn<Fetch>(async (input) => {
      const request = input instanceof Request ? input : new Request(input);
      const idempotencyKey = request.headers.get("idempotency-key");
      const body = await request.text();
      requests.push({ body, idempotencyKey });
      if (idempotencyKey !== null && !committedKeys.has(idempotencyKey)) {
        committedKeys.add(idempotencyKey);
        effectCount += 1;
        return retryableResponse("request-1");
      }
      return successResponse({ id: "ticket-1" });
    });
    const client = new WorkGraphClient(config, fetch, {
      random: () => 0,
      sleep: async () => undefined,
    });

    await expect(
      client.createWorkItem({ id: "ticket-1", title: "Retry safely" }),
    ).resolves.toEqual({ id: "ticket-1" });
    expect(effectCount).toBe(1);
    expect(requests).toHaveLength(2);
    expect(requests[0]).toEqual(requests[1]);
    expect(requests[0]?.idempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
  });

  it("preserves the last retryable response when backoff reaches the deadline", async () => {
    const fetch = vi.fn<Fetch>(async () =>
      retryableResponse("request-before-timeout"),
    );
    const client = new WorkGraphClient(config, fetch, {
      maxElapsedMs: 1_000,
      now: () => 0,
      random: () => 0,
    });

    await expect(client.getWorkItem("ticket-1")).rejects.toMatchObject({
      code: "database_capacity",
      requestId: "request-before-timeout",
      status: 503,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("honors a future HTTP-date Retry-After value", async () => {
    const now = Date.UTC(2026, 8, 26, 8, 0, 0);
    const delays: number[] = [];
    const fetch = vi
      .fn<Fetch>()
      .mockResolvedValueOnce(
        retryableResponse(
          "request-1",
          "database_capacity",
          new Date(now + 2_000).toUTCString(),
        ),
      )
      .mockResolvedValueOnce(successResponse({ id: "ticket-1" }));
    const client = new WorkGraphClient(config, fetch, {
      now: () => now,
      random: () => 0,
      sleep: async (delayMs) => {
        delays.push(delayMs);
      },
    });

    await expect(client.getWorkItem("ticket-1")).resolves.toEqual({
      id: "ticket-1",
    });
    expect(delays).toEqual([2_000]);
  });

  it.each(["invalid", "Sat, 26 Sep 2026 07:59:59 GMT", "120"])(
    "uses exponential backoff for unusable Retry-After %s",
    async (retryAfter) => {
      const now = Date.UTC(2026, 8, 26, 8, 0, 0);
      const delays: number[] = [];
      const fetch = vi
        .fn<Fetch>()
        .mockResolvedValueOnce(
          retryableResponse("request-1", "database_capacity", retryAfter),
        )
        .mockResolvedValueOnce(successResponse({ id: "ticket-1" }));
      const client = new WorkGraphClient(config, fetch, {
        now: () => now,
        random: () => 0,
        sleep: async (delayMs) => {
          delays.push(delayMs);
        },
      });

      await expect(client.getWorkItem("ticket-1")).resolves.toEqual({
        id: "ticket-1",
      });
      expect(delays).toEqual([250]);
    },
  );

  it("preserves the server response when a later attempt times out", async () => {
    const fetch = vi
      .fn<Fetch>()
      .mockResolvedValueOnce(retryableResponse("request-before-timeout"))
      .mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"));
    const client = new WorkGraphClient(config, fetch, {
      random: () => 0,
      sleep: async () => undefined,
    });

    await expect(client.getWorkItem("ticket-1")).rejects.toMatchObject({
      code: "database_capacity",
      requestId: "request-before-timeout",
      status: 503,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
