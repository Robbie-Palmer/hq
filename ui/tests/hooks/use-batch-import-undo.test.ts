import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBatchImportUndo } from "@/hooks/use-batch-import-undo";

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock("@/lib/api/http", () => ({ apiRequest: mocks.apiRequest }));
beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("batch undo", () => {
  it("polls a running undo after confirmation and stops at completion", async () => {
    vi.useFakeTimers();
    mocks.apiRequest.mockResolvedValue({ state: "running", items: [] });
    const { result, unmount } = renderHook(() => useBatchImportUndo("batch-1"));
    await act(async () => {
      await result.current.check();
    });
    expect(result.current.preview?.state).toBe("running");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(mocks.apiRequest).toHaveBeenCalledTimes(2);
    mocks.apiRequest.mockResolvedValue({ state: "completed", items: [] });
    await act(async () => {
      await result.current.start();
    });
    expect(mocks.apiRequest).toHaveBeenCalledWith(
      "/api/recipe-import-batches/batch-1/undo",
      { method: "PUT", json: { state: "started" } },
    );
    const calls = mocks.apiRequest.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(mocks.apiRequest).toHaveBeenCalledTimes(calls);
    unmount();
  });
  it("keeps the preview when confirmation fails and supports retry", async () => {
    mocks.apiRequest.mockResolvedValue({ state: "preview", items: [] });
    const { result } = renderHook(() => useBatchImportUndo("batch-1"));
    await act(async () => {
      await result.current.check();
    });
    mocks.apiRequest.mockRejectedValueOnce(new Error("Request failed"));
    await act(async () => {
      await result.current.start();
    });
    expect(result.current.error).toBe("Request failed");
    expect(result.current.preview?.state).toBe("preview");
    expect(result.current.busy).toBe(false);
    await act(async () => {
      await result.current.start();
    });
    expect(result.current.error).toBeNull();
  });
  it("reports polling failures and clears the interval on unmount", async () => {
    mocks.apiRequest.mockResolvedValue({ state: "running", items: [] });
    const { result, unmount } = renderHook(() => useBatchImportUndo("batch-1"));
    await act(async () => {
      await result.current.check();
    });
    mocks.apiRequest.mockRejectedValue(new Error("Offline"));
    await waitFor(() => expect(result.current.error).toBe("Offline"), {
      timeout: 3000,
    });
    unmount();
  });
});
