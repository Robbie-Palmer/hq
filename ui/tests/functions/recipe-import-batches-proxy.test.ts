import { afterEach, describe, expect, it, vi } from "vitest";
import { onRequest } from "../../../functions/api/recipe-import-batches/[[path]]";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("recipe import batch proxy", () => {
  it("forwards resource paths, mutation methods, and JSON without rewriting actions", async () => {
    const fetcher = vi.fn(
      async (_request: Request) =>
        new Response("{}", { headers: { "content-type": "application/json" } }),
    );
    globalThis.fetch = fetcher as unknown as typeof fetch;
    const body = JSON.stringify({ state: "started" });
    await onRequest({
      request: new Request(
        "https://robbiepalmer.me/api/recipe-import-batches/batch-1/execution",
        {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            cookie: "session=test",
            origin: "https://robbiepalmer.me",
          },
          body,
        },
      ),
      env: { RECIPE_API_URL: "https://recipe-api.example.test" },
    });
    const forwarded = fetcher.mock.calls[0]?.[0];
    expect(forwarded?.url).toBe(
      "https://recipe-api.example.test/recipe-import-batches/batch-1/execution",
    );
    expect(forwarded?.method).toBe("PUT");
    expect(await forwarded?.text()).toBe(body);
    expect(forwarded?.headers.get("cookie")).toBe("session=test");
  });
});
