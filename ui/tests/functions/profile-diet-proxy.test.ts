import { afterEach, describe, expect, it, vi } from "vitest";
import type { RecipeApiProxyContext } from "../../../functions/api/auth/routing";
import { onRequest as onHouseholdRequest } from "../../../functions/api/households/[[path]]";
import { onRequest as onPantryRequest } from "../../../functions/api/pantry/[[path]]";
import { onRequest as onBootstrapRequest } from "../../../functions/api/profile/bootstrap";
import { onRequest } from "../../../functions/api/profile/diet";
import { onRequest as onOptionsRequest } from "../../../functions/api/profile/diet/options";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("profile diet proxy", () => {
  it("forwards recipe profile bootstrap requests to the recipe API Worker", async () => {
    const fetchMock = vi.fn(async (_request: Request) => new Response("ok"));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const response = await onBootstrapRequest({
      request: new Request("https://robbiepalmer.me/api/profile/bootstrap"),
      env: { RECIPE_API_URL: "https://recipe-api.example.test" },
    });

    expect(response.status).toBe(200);
    const forwarded = fetchMock.mock.calls[0]?.[0];
    expect(forwarded).toBeInstanceOf(Request);
    if (!(forwarded instanceof Request)) {
      throw new Error("Expected profile bootstrap proxy to forward a Request");
    }
    expect(forwarded.url).toBe(
      "https://recipe-api.example.test/api/profile/bootstrap",
    );
  });

  it("forwards same-origin diet profile requests to the recipe API Worker", async () => {
    const fetchMock = vi.fn(async (_request: Request) => new Response("ok"));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const context: RecipeApiProxyContext = {
      request: new Request("https://robbiepalmer.me/api/profile/diet?fresh=1", {
        method: "PUT",
        headers: {
          authorization: "Bearer test-token",
          "cf-access-jwt-assertion": "access-token",
          "content-type": "application/json",
          host: "robbiepalmer.me",
        },
        body: JSON.stringify({ recipeMatchMode: "warn" }),
      }),
      env: { RECIPE_API_URL: "https://recipe-api.example.test" },
    };
    const response = await onRequest(context);

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
    const forwarded = fetchMock.mock.calls[0]?.[0];
    expect(forwarded).toBeInstanceOf(Request);
    if (!(forwarded instanceof Request)) {
      throw new Error("Expected profile proxy to forward a Request");
    }
    expect(forwarded.url).toBe(
      "https://recipe-api.example.test/api/profile/diet?fresh=1",
    );
    expect(forwarded.method).toBe("PUT");
    expect(forwarded.headers.has("host")).toBe(false);
    expect(forwarded.headers.get("authorization")).toBe("Bearer test-token");
    expect(forwarded.headers.get("cf-access-jwt-assertion")).toBe(
      "access-token",
    );
    expect(await forwarded.text()).toBe(
      JSON.stringify({ recipeMatchMode: "warn" }),
    );
  });

  it("rejects non-canonical preview aliases", async () => {
    const context: RecipeApiProxyContext = {
      request: new Request(
        "https://abc123.personal-site-bu5.pages.dev/api/profile/diet",
      ),
      env: {
        CF_PAGES_HOST: "personal-site-bu5.pages.dev",
        RECIPE_API_PREVIEW_ORIGIN_TEMPLATE:
          "https://recipe-api-pr-{pr}.example.test",
      },
    };
    const response = await onRequest(context);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Profile APIs are available on the canonical PR preview URL only",
    });
  });

  it("forwards diet options requests to the recipe API Worker", async () => {
    const fetchMock = vi.fn(async (_request: Request) => new Response("ok"));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const context: RecipeApiProxyContext = {
      request: new Request("https://robbiepalmer.me/api/profile/diet/options"),
      env: { RECIPE_API_URL: "https://recipe-api.example.test" },
    };
    const response = await onOptionsRequest(context);

    expect(response.status).toBe(200);
    const forwarded = fetchMock.mock.calls[0]?.[0];
    expect(forwarded).toBeInstanceOf(Request);
    if (!(forwarded instanceof Request)) {
      throw new Error("Expected diet options proxy to forward a Request");
    }
    expect(forwarded.url).toBe(
      "https://recipe-api.example.test/api/profile/diet/options",
    );
  });

  it("returns a bad gateway response when the recipe API is unreachable", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const response = await onRequest({
      request: new Request("https://robbiepalmer.me/api/profile/diet"),
      env: { RECIPE_API_URL: "https://recipe-api.example.test" },
    });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: "Failed to reach the recipe API",
    });
  });
});

describe("household proxy", () => {
  it.each([
    ["/api/households?fresh=1", "/households?fresh=1"],
    [
      "/api/households/household-1/invitations",
      "/households/household-1/invitations",
    ],
  ])("maps %s to the Worker path %s", async (sourcePath, workerPath) => {
    const fetchMock = vi.fn(async (_request: Request) => new Response("ok"));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const response = await onHouseholdRequest({
      request: new Request(`https://robbiepalmer.me${sourcePath}`, {
        method: "DELETE",
      }),
      env: { RECIPE_API_URL: "https://recipe-api.example.test" },
    });

    expect(response.status).toBe(200);
    const forwarded = fetchMock.mock.calls[0]?.[0];
    expect(forwarded).toBeInstanceOf(Request);
    if (!(forwarded instanceof Request)) {
      throw new Error("Expected household proxy to forward a Request");
    }
    expect(forwarded.url).toBe(`https://recipe-api.example.test${workerPath}`);
    expect(forwarded.method).toBe("DELETE");
  });
});

describe("pantry proxy", () => {
  it("preserves a same-origin realtime WebSocket upgrade", async () => {
    const fetchMock = vi.fn(async (_request: Request) => new Response("ok"));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const response = await onPantryRequest({
      request: new Request("https://robbiepalmer.me/api/pantry/realtime", {
        headers: { origin: "https://robbiepalmer.me", upgrade: "websocket" },
      }),
      env: { RECIPE_API_URL: "https://recipe-api.example.test" },
    });

    expect(response.status).toBe(200);
    const forwarded = fetchMock.mock.calls[0]?.[0];
    expect(forwarded).toBeInstanceOf(Request);
    if (!(forwarded instanceof Request)) {
      throw new Error("Expected pantry proxy to forward a Request");
    }
    expect(forwarded.url).toBe(
      "https://recipe-api.example.test/pantry/realtime",
    );
    expect(forwarded.headers.get("upgrade")).toBe("websocket");
    expect(forwarded.headers.get("origin")).toBe("https://robbiepalmer.me");
  });

  it("strips WebSocket-only headers from non-upgrade requests", async () => {
    const fetchMock = vi.fn(async (_request: Request) => new Response("ok"));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const response = await onPantryRequest({
      request: new Request("https://robbiepalmer.me/api/pantry/realtime", {
        method: "POST",
        headers: {
          "sec-websocket-protocol": "pantry",
          upgrade: "websocket",
        },
      }),
      env: { RECIPE_API_URL: "https://recipe-api.example.test" },
    });

    expect(response.status).toBe(200);
    const forwarded = fetchMock.mock.calls[0]?.[0];
    expect(forwarded).toBeInstanceOf(Request);
    if (!(forwarded instanceof Request)) {
      throw new Error("Expected pantry proxy to forward a Request");
    }
    expect(forwarded.headers.get("upgrade")).toBeNull();
    expect(forwarded.headers.get("sec-websocket-protocol")).toBeNull();
  });

  it("maps pantry item requests and query parameters to the Worker URL", async () => {
    const fetchMock = vi.fn(async (_request: Request) => new Response("ok"));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const response = await onPantryRequest({
      request: new Request(
        "https://robbiepalmer.me/api/pantry/items/onion?source=kitchen",
        {
          method: "PUT",
          headers: { "idempotency-key": "test-operation-id" },
        },
      ),
      env: { RECIPE_API_URL: "https://recipe-api.example.test" },
    });

    expect(response.status).toBe(200);
    const forwarded = fetchMock.mock.calls[0]?.[0];
    expect(forwarded).toBeInstanceOf(Request);
    if (!(forwarded instanceof Request)) {
      throw new Error("Expected pantry proxy to forward a Request");
    }
    expect(forwarded.url).toBe(
      "https://recipe-api.example.test/pantry/items/onion?source=kitchen",
    );
    expect(forwarded.method).toBe("PUT");
    expect(forwarded.headers.get("idempotency-key")).toBe("test-operation-id");
  });
});
