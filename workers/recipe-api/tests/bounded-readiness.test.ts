import { describe, expect, it, vi } from "vitest";
import { retryBoundedReadiness } from "../src/preview-readiness";

describe("bounded preview readiness", () => {
  it("retries with bounded linear delays", async () => {
    const operation = vi
      .fn<(attempt: number) => Promise<string>>()
      .mockRejectedValueOnce(new Error("first socket timed out"))
      .mockRejectedValueOnce(new Error("second socket closed"))
      .mockResolvedValueOnce("ready");
    const wait = vi.fn(async () => undefined);

    await expect(
      retryBoundedReadiness("Realtime subscription", operation, {
        wait,
        warn: vi.fn(),
      }),
    ).resolves.toBe("ready");

    expect(operation).toHaveBeenCalledTimes(3);
    expect(wait.mock.calls).toEqual([[1_000], [2_000]]);
  });

  it("reports each failed attempt after exhausting the bound", async () => {
    const operation = vi.fn(async (attempt: number) => {
      throw new Error(`socket failure ${attempt}`);
    });

    await expect(
      retryBoundedReadiness("Realtime subscription", operation, {
        attempts: 2,
        delayMs: 0,
        wait: async () => undefined,
        warn: vi.fn(),
      }),
    ).rejects.toThrow(
      "Realtime subscription failed after 2 attempts (attempt 1: socket failure 1; attempt 2: socket failure 2)",
    );
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("rejects invalid retry bounds before running the operation", async () => {
    const operation = vi.fn(async () => "ready");

    await expect(
      retryBoundedReadiness("Realtime subscription", operation, {
        attempts: 0,
      }),
    ).rejects.toThrow("Readiness attempts must be a positive integer");
    expect(operation).not.toHaveBeenCalled();

    await expect(
      retryBoundedReadiness("Realtime subscription", operation, {
        delayMs: -1,
      }),
    ).rejects.toThrow("Readiness delay must be a non-negative integer");
    expect(operation).not.toHaveBeenCalled();
  });

  it("uses the default timer when no wait function is injected", async () => {
    vi.useFakeTimers();
    try {
      const operation = vi
        .fn<(attempt: number) => Promise<string>>()
        .mockRejectedValueOnce(new Error("warming"))
        .mockResolvedValueOnce("ready");

      const readiness = retryBoundedReadiness(
        "Realtime subscription",
        operation,
        { warn: vi.fn() },
      );
      await vi.advanceTimersByTimeAsync(1_000);

      await expect(readiness).resolves.toBe("ready");
    } finally {
      vi.useRealTimers();
    }
  });
});
