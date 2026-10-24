import { describe, expect, it, vi } from "vitest";
import {
  type PreviewRetryResponse,
  requestWithTransientRetries,
} from "../../e2e/preview/transient-request";

function response(
  status: number,
  headers: Record<string, string> = {},
): PreviewRetryResponse {
  return {
    dispose: vi.fn(async () => undefined),
    headers: () => headers,
    status: () => status,
  };
}

describe("preview transient request retries", () => {
  it("retries transient responses and disposes superseded attempts", async () => {
    const first = response(503);
    const second = response(200);
    const request = vi
      .fn<
        (timeoutMs: number, attempt: number) => Promise<PreviewRetryResponse>
      >()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const wait = vi.fn(async () => undefined);

    await expect(
      requestWithTransientRetries("GET /ready", request, {
        wait,
        warn: vi.fn(),
      }),
    ).resolves.toBe(second);

    expect(request).toHaveBeenNthCalledWith(1, 15_000, 1);
    expect(request).toHaveBeenNthCalledWith(2, 15_000, 2);
    expect(first.dispose).toHaveBeenCalledOnce();
    expect(second.dispose).not.toHaveBeenCalled();
    expect(wait).toHaveBeenCalledWith(500);
  });

  it("retries transport errors and reports every failed attempt", async () => {
    const request = vi
      .fn<
        (timeoutMs: number, attempt: number) => Promise<PreviewRetryResponse>
      >()
      .mockRejectedValueOnce(new Error("request timed out"))
      .mockRejectedValueOnce(new Error("socket reset"))
      .mockRejectedValueOnce(new Error("upstream unavailable"));

    await expect(
      requestWithTransientRetries("POST /safe-setup", request, {
        wait: async () => undefined,
        warn: vi.fn(),
      }),
    ).rejects.toThrow(
      "POST /safe-setup failed after 3 attempts (attempt 1: request timed out; attempt 2: socket reset; attempt 3: upstream unavailable)",
    );
  });

  it("does not retry deterministic HTTP failures", async () => {
    const badRequest = response(400);
    const request = vi.fn(async () => badRequest);

    await expect(
      requestWithTransientRetries("POST /invalid", request, {
        wait: vi.fn(),
        warn: vi.fn(),
      }),
    ).resolves.toBe(badRequest);

    expect(request).toHaveBeenCalledOnce();
    expect(badRequest.dispose).not.toHaveBeenCalled();
  });

  it("bounds retry-after delays and returns the final response for diagnostics", async () => {
    const first = response(429, { "retry-after": "60" });
    const second = response(503);
    const request = vi
      .fn<
        (timeoutMs: number, attempt: number) => Promise<PreviewRetryResponse>
      >()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const wait = vi.fn(async () => undefined);
    const warn = vi.fn();

    await expect(
      requestWithTransientRetries("GET /limited", request, {
        attempts: 2,
        wait,
        warn,
      }),
    ).resolves.toBe(second);

    expect(wait).toHaveBeenCalledWith(5_000);
    expect(warn).toHaveBeenLastCalledWith(
      "GET /limited exhausted transient retries (attempt 1: HTTP 429; attempt 2: HTTP 503)",
    );
  });

  it("validates attempt bounds before making a request", async () => {
    const request = vi.fn(async () => response(200));

    await expect(
      requestWithTransientRetries("GET /ready", request, { attempts: 0 }),
    ).rejects.toThrow("Preview request attempts must be a positive integer");
    expect(request).not.toHaveBeenCalled();
  });

  it("uses the default timer when no wait function is injected", async () => {
    vi.useFakeTimers();
    try {
      const request = vi
        .fn<
          (timeoutMs: number, attempt: number) => Promise<PreviewRetryResponse>
        >()
        .mockResolvedValueOnce(response(503))
        .mockResolvedValueOnce(response(200));

      const result = requestWithTransientRetries("GET /ready", request, {
        warn: vi.fn(),
      });
      await vi.advanceTimersByTimeAsync(500);

      await expect(result).resolves.toMatchObject({
        status: expect.any(Function),
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
