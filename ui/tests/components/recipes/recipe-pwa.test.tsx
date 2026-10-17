import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pwaMocks = vi.hoisted(() => ({
  clearOfflineRecipeSnapshots: vi.fn(),
  cacheStatus: {
    oldestSavedAt: null as number | null,
    quotaExceeded: false,
  },
}));
const authMocks = vi.hoisted(() => ({
  session: {
    data: null as { user: { id: string } } | null,
    isPending: false,
  },
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => authMocks.session,
  },
}));

vi.mock("@/lib/pwa/offline-recipe-cache", () => ({
  clearOfflineRecipeSnapshots: pwaMocks.clearOfflineRecipeSnapshots,
  getOfflineCacheStatus: () => pwaMocks.cacheStatus,
  getServerOfflineCacheStatus: () => ({
    oldestSavedAt: null,
    quotaExceeded: false,
  }),
  subscribeOfflineCacheStatus: () => () => undefined,
}));

import { QueryClientProvider } from "@tanstack/react-query";
import {
  clearOfflineRecipeData,
  RecipePwa,
} from "@/components/recipes/recipe-pwa";
import { createRecipeQueryClient } from "@/lib/query/recipe-query-client";

describe("RecipePwa", () => {
  beforeEach(() => {
    localStorage.clear();
    pwaMocks.clearOfflineRecipeSnapshots.mockResolvedValue(undefined);
    pwaMocks.cacheStatus = {
      oldestSavedAt: null,
      quotaExceeded: false,
    };
    authMocks.session = { data: null, isPending: false };
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
      "Offline. Saved data is read-only until you reconnect.",
    );
  });

  it("shows when the oldest restored snapshot was saved", async () => {
    const now = Date.now();
    pwaMocks.cacheStatus = {
      oldestSavedAt: now - 5 * 60_000,
      quotaExceeded: false,
    };
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
      "Offline. Showing saved data from 5 minutes ago.",
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
    localStorage.setItem("cooking-timers:v2:user-1", "protected");
    localStorage.setItem("recipe-shopping-list:v2:user-1", "protected");

    await clearOfflineRecipeData();

    expect(deleteCache).toHaveBeenCalledWith("recipe-session-v1");
    expect(deleteCache).toHaveBeenCalledWith("recipe-images-v2");
    expect(localStorage.getItem("cooking-timers:v2:user-1")).toBeNull();
    expect(localStorage.getItem("recipe-shopping-list:v2:user-1")).toBeNull();
  });

  it("evicts protected browser data when an authenticated account disappears", async () => {
    authMocks.session = {
      data: { user: { id: "user-1" } },
      isPending: false,
    };
    const view = renderPwa();
    await act(async () => undefined);

    authMocks.session = { data: null, isPending: false };
    view.rerender(
      <QueryClientProvider client={createRecipeQueryClient()}>
        <RecipePwa />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(pwaMocks.clearOfflineRecipeSnapshots).toHaveBeenCalled();
    });
  });
});
