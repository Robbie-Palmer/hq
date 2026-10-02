import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pwaMocks = vi.hoisted(() => ({
  clearOfflineRecipeSnapshots: vi.fn(),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({ data: null, isPending: false }),
  },
}));

vi.mock("@/lib/pwa/offline-recipe-cache", () => ({
  clearOfflineRecipeSnapshots: pwaMocks.clearOfflineRecipeSnapshots,
}));

import { QueryClientProvider } from "@tanstack/react-query";
import {
  clearOfflineRecipeData,
  RecipePwa,
} from "@/components/recipes/recipe-pwa";
import { createRecipeQueryClient } from "@/lib/query/recipe-query-client";

describe("RecipePwa", () => {
  beforeEach(() => {
    pwaMocks.clearOfflineRecipeSnapshots.mockResolvedValue(undefined);
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: true,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, "onLine");
    Reflect.deleteProperty(navigator, "serviceWorker");
  });

  function renderPwa() {
    return render(
      <QueryClientProvider client={createRecipeQueryClient()}>
        <RecipePwa />
      </QueryClientProvider>,
    );
  }

  it("explains that saved recipes remain readable while offline", async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError("offline"));
    renderPwa();

    await act(async () => {
      Object.defineProperty(navigator, "onLine", {
        configurable: true,
        value: false,
      });
      window.dispatchEvent(new Event("offline"));
    });

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Offline. Saved recipes are read-only until you reconnect.",
    );
  });

  it("does not show the offline banner when requests still work", async () => {
    let resolveProbe: ((response: Response) => void) | undefined;
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveProbe = resolve;
        }),
    );
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: false,
    });

    renderPwa();

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        expect.stringMatching(/^\/robots\.txt\?online-check=/),
        {
          cache: "no-store",
          credentials: "same-origin",
          method: "HEAD",
        },
      );
    });
    await act(async () => {
      resolveProbe?.(new Response(null, { status: 204 }));
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("notifies the service worker when IndexedDB cleanup fails", async () => {
    const postMessage = vi.fn();
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        controller: { postMessage },
        ready: Promise.resolve({ active: { postMessage } }),
      },
    });
    pwaMocks.clearOfflineRecipeSnapshots.mockRejectedValue(
      new Error("IndexedDB unavailable"),
    );

    await expect(clearOfflineRecipeData()).rejects.toThrow(
      "IndexedDB unavailable",
    );
    await waitFor(() => expect(postMessage).toHaveBeenCalledTimes(2));
  });

  it("clears private caches directly when no service worker is available", async () => {
    const deleteCache = vi.fn().mockResolvedValue(true);
    vi.stubGlobal("caches", { delete: deleteCache });

    await clearOfflineRecipeData();

    expect(deleteCache).toHaveBeenCalledWith("recipe-session-v1");
    expect(deleteCache).toHaveBeenCalledWith("recipe-images-v2");
  });
});
