import { afterEach, describe, expect, it, vi } from "vitest";

describe("wakeLock", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(navigator, "wakeLock");
  });

  it("reacquires after browser release and visibility changes", async () => {
    let visibilityState: DocumentVisibilityState = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(
      () => visibilityState,
    );

    const releaseListeners: Array<() => void> = [];
    const sentinels = Array.from({ length: 3 }, () => ({
      addEventListener: vi.fn((event: string, listener: () => void) => {
        if (event === "release") releaseListeners.push(listener);
      }),
      release: vi.fn().mockResolvedValue(undefined),
    }));
    const request = vi
      .fn()
      .mockResolvedValueOnce(sentinels[0])
      .mockResolvedValueOnce(sentinels[1])
      .mockResolvedValueOnce(sentinels[2]);
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: { request },
    });

    vi.resetModules();
    const { releaseWakeLock, retainWakeLock } = await import(
      "@/lib/cooking/wakeLock"
    );

    retainWakeLock("test");
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));

    visibilityState = "hidden";
    releaseListeners[0]?.();
    visibilityState = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));

    releaseListeners[1]?.();
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(3));

    releaseWakeLock("test");
  });
});
