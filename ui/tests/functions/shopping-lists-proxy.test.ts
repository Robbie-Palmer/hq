import { afterEach, describe, expect, it, vi } from "vitest";
import type { RecipeApiProxyContext } from "../../../functions/api/auth/routing";
import { onRequest } from "../../../functions/api/shopping-lists/[[path]]";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("shopping lists proxy", () => {
  it.each([
    ["GET", "/api/shopping-lists/current", "/shopping-lists/current"],
    ["PUT", "/api/shopping-lists/current", "/shopping-lists/current"],
    [
      "POST",
      "/api/shopping-lists/current/shares",
      "/shopping-lists/current/shares",
    ],
    ["POST", "/api/shopping-lists", "/shopping-lists"],
  ])("maps %s %s to %s", async (method, sourcePath, workerPath) => {
    const fetchMock = vi.fn(async (_request: Request) => new Response("ok"));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const response = await onRequest({
      request: new Request(`https://robbiepalmer.me${sourcePath}`, {
        method,
        headers: { cookie: "session=test" },
      }),
      env: { RECIPE_API_URL: "https://recipe-api.example.test" },
    } satisfies RecipeApiProxyContext);

    expect(response.status).toBe(200);
    const forwarded = fetchMock.mock.calls[0]?.[0];
    expect(forwarded).toBeInstanceOf(Request);
    if (!(forwarded instanceof Request)) throw new Error("Expected a Request");
    expect(forwarded.url).toBe(`https://recipe-api.example.test${workerPath}`);
    expect(forwarded.headers.get("cookie")).toBe("session=test");
  });

  it("does not forward session cookies to an insecure API origin", async () => {
    const fetchMock = vi.fn(async (_request: Request) => new Response("ok"));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const response = await onRequest({
      request: new Request(
        "https://robbiepalmer.me/api/shopping-lists/current",
        { headers: { cookie: "session=test" } },
      ),
      env: { RECIPE_API_URL: "http://recipe-api.example.test" },
    } satisfies RecipeApiProxyContext);

    expect(response.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
