import { afterEach, describe, expect, it, vi } from "vitest";
import type { RecipeApiProxyContext } from "../../../functions/api/auth/routing";
import { onRequest } from "../../../functions/api/profile/agent-mutations/[[path]]";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("agent mutations proxy", () => {
  it.each([
    ["GET", "/api/profile/agent-mutations?limit=20"],
    ["GET", "/api/profile/agent-mutations/change-1/undo-preview"],
    ["POST", "/api/profile/agent-mutations/change-1/undo"],
  ])("forwards %s %s to the recipe API", async (method, sourcePath) => {
    const fetchMock = vi.fn(async (_request: Request) => new Response("ok"));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const response = await onRequest({
      request: new Request(`https://robbiepalmer.me${sourcePath}`, {
        method,
        headers: { cookie: "session=test" },
        body: method === "POST" ? JSON.stringify({}) : undefined,
      }),
      env: { RECIPE_API_URL: "https://recipe-api.example.test" },
    } satisfies RecipeApiProxyContext);

    expect(response.status).toBe(200);
    const forwarded = fetchMock.mock.calls[0]?.[0];
    expect(forwarded).toBeInstanceOf(Request);
    if (!(forwarded instanceof Request)) throw new Error("Expected a Request");
    expect(forwarded.method).toBe(method);
    expect(forwarded.url).toBe(`https://recipe-api.example.test${sourcePath}`);
    expect(forwarded.headers.get("cookie")).toBe("session=test");
  });
});
