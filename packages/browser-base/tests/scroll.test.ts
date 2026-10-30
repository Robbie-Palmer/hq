import { afterEach, describe, expect, it, vi } from "vitest";
import { smoothScrollTo } from "../src/scroll";

type FrameCallback = (time: number) => void;

describe("smoothScrollTo", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("resolves without scheduling a frame when the element is absent", async () => {
    const requestAnimationFrame = vi.fn();
    vi.stubGlobal("document", { getElementById: () => null });
    vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);

    await expect(smoothScrollTo("missing").promise).resolves.toBeUndefined();
    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });

  it("animates to the offset position and resolves", async () => {
    const frames: FrameCallback[] = [];
    const scrollTo = vi.fn();
    vi.stubGlobal("document", {
      getElementById: () => ({
        getBoundingClientRect: () => ({ top: 120 }),
      }),
    });
    vi.stubGlobal("window", { scrollX: 4, scrollY: 20, scrollTo });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameCallback) => {
      frames.push(callback);
      return frames.length;
    });

    const { promise } = smoothScrollTo("target", {
      duration: 100,
      offset: 10,
    });
    frames.shift()?.(1_000);
    frames.shift()?.(1_100);

    await expect(promise).resolves.toBeUndefined();
    expect(scrollTo).toHaveBeenNthCalledWith(1, 4, 20);
    expect(scrollTo).toHaveBeenLastCalledWith(4, 130);
  });

  it("cancels the scheduled animation", async () => {
    const cancelAnimationFrame = vi.fn();
    vi.stubGlobal("document", {
      getElementById: () => ({
        getBoundingClientRect: () => ({ top: 100 }),
      }),
    });
    vi.stubGlobal("window", { scrollX: 0, scrollY: 0 });
    vi.stubGlobal("requestAnimationFrame", () => 42);
    vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrame);

    const { cancel, promise } = smoothScrollTo("target");
    cancel();

    await expect(promise).resolves.toBeUndefined();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(42);
  });
});
