import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  captureException: vi.fn(),
  reload: vi.fn(),
}));

vi.mock("posthog-js", () => ({
  default: { captureException: mocks.captureException },
}));

function chunkLoadError(): Error {
  const error = new Error("Loading chunk 4684 failed.");
  error.name = "ChunkLoadError";
  return error;
}

async function loadRecovery() {
  vi.resetModules();
  return import("@/lib/browser/stale-chunk-recovery");
}

describe("recoverFromStaleChunk", () => {
  beforeEach(() => {
    sessionStorage.clear();
    mocks.captureException.mockReset();
    mocks.reload.mockReset();
    vi.stubGlobal("location", { reload: mocks.reload });
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("reloads once and reports the original error", async () => {
    const { recoverFromStaleChunk } = await loadRecovery();
    const error = chunkLoadError();

    expect(recoverFromStaleChunk(error)).toBe(true);
    expect(recoverFromStaleChunk(chunkLoadError())).toBe(true);

    expect(mocks.reload).toHaveBeenCalledTimes(1);
    expect(mocks.captureException).toHaveBeenCalledWith(error, {
      stale_chunk_recovery: "reload",
    });
  });

  it("ignores errors that are not chunk load failures", async () => {
    const { recoverFromStaleChunk } = await loadRecovery();

    expect(recoverFromStaleChunk(new Error("invalid chart"))).toBe(false);
    expect(mocks.reload).not.toHaveBeenCalled();
  });

  it("does not reload while offline", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const { recoverFromStaleChunk } = await loadRecovery();

    expect(recoverFromStaleChunk(chunkLoadError())).toBe(false);
    expect(mocks.reload).not.toHaveBeenCalled();
  });

  it("does not reload again when the reload did not fix the chunk", async () => {
    vi.useFakeTimers({ now: 1_000_000, toFake: ["Date"] });
    (await loadRecovery()).recoverFromStaleChunk(chunkLoadError());

    vi.setSystemTime(1_030_000);
    const afterReload = await loadRecovery();
    expect(afterReload.recoverFromStaleChunk(chunkLoadError())).toBe(false);

    vi.setSystemTime(1_100_000);
    const laterDeploy = await loadRecovery();
    expect(laterDeploy.recoverFromStaleChunk(chunkLoadError())).toBe(true);

    expect(mocks.reload).toHaveBeenCalledTimes(2);
  });
});
