import { afterEach, describe, expect, it, vi } from "vitest";
import type { RecipeApiProxyContext } from "../../../functions/api/auth/routing";
import { onRequest } from "../../../functions/api/recipes/[[path]]";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("recipes proxy", () => {
  it("maps the Pages API path to the Worker recipe path", async () => {
    const fetchMock = vi.fn(async (_request: Request) => new Response("ok"));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const context: RecipeApiProxyContext = {
      request: new Request(
        "https://robbiepalmer.me/api/recipes/my-pasta?fresh=1",
        {
          headers: { cookie: "session=test" },
        },
      ),
      env: { RECIPE_API_URL: "https://recipe-api.example.test" },
    };
    const response = await onRequest(context);

    expect(response.status).toBe(200);
    const forwarded = fetchMock.mock.calls[0]?.[0];
    expect(forwarded).toBeInstanceOf(Request);
    if (!(forwarded instanceof Request)) throw new Error("Expected a Request");
    expect(forwarded.url).toBe(
      "https://recipe-api.example.test/recipes/my-pasta?fresh=1",
    );
    expect(forwarded.headers.get("cookie")).toBe("session=test");
  });

  it.each([
    "..",
    "%2e%2e",
    "%252e%252e",
    "..%2Fprivate",
    "%252Fprivate",
    "%00",
    "%2500",
    "%5C",
    "%ZZ",
  ])("rejects an unsafe path segment: %s", async (segment) => {
    const fetchMock = vi.fn(async () => new Response("ok"));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const context: RecipeApiProxyContext = {
      request: new Request(
        `https://robbiepalmer.me/api/recipes/${segment}/private`,
      ),
      env: { RECIPE_API_URL: "https://recipe-api.example.test" },
    };

    const response = await onRequest(context);

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows a literal percent sign in a path segment", async () => {
    const fetchMock = vi.fn(async (_request: Request) => new Response("ok"));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const context: RecipeApiProxyContext = {
      request: new Request("https://robbiepalmer.me/api/recipes/50%25/private"),
      env: { RECIPE_API_URL: "https://recipe-api.example.test" },
    };

    const response = await onRequest(context);

    expect(response.status).toBe(200);
    const forwarded = fetchMock.mock.calls[0]?.[0];
    expect(forwarded).toBeInstanceOf(Request);
    if (!(forwarded instanceof Request)) throw new Error("Expected a Request");
    expect(forwarded.url).toBe(
      "https://recipe-api.example.test/recipes/50%25/private",
    );
  });
});
