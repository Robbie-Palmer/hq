import { afterEach, describe, expect, it, vi } from "vitest";
import type { RecipeApiProxyContext } from "../../../functions/api/auth/routing";
import { onRequest as onHouseholdsRequest } from "../../../functions/api/households/[[path]]";
import { onRequest as onNotificationsRequest } from "../../../functions/api/notifications/[[path]]";
import { onRequest as onPantryRequest } from "../../../functions/api/pantry/[[path]]";
import { onRequest as onRecipeDraftsRequest } from "../../../functions/api/recipe-drafts/[[path]]";
import { onRequest as onRecipeImportsRequest } from "../../../functions/api/recipe-imports/[[path]]";
import { onRequest as onRecipesRequest } from "../../../functions/api/recipes/[[path]]";
import { onRequest as onShoppingListsRequest } from "../../../functions/api/shopping-lists/[[path]]";

const originalFetch = globalThis.fetch;

const leaves = [
  { segment: "households", onRequest: onHouseholdsRequest },
  { segment: "notifications", onRequest: onNotificationsRequest },
  { segment: "pantry", onRequest: onPantryRequest },
  { segment: "recipe-drafts", onRequest: onRecipeDraftsRequest },
  { segment: "recipe-imports", onRequest: onRecipeImportsRequest },
  { segment: "recipes", onRequest: onRecipesRequest },
  { segment: "shopping-lists", onRequest: onShoppingListsRequest },
] as const;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe.each(leaves)("$segment proxy leaf", ({ segment, onRequest }) => {
  const pagesPrefix = `/api/${segment}`;
  const workerPrefix = `/${segment}`;

  it.each([
    ["exact path", pagesPrefix, workerPrefix],
    ["descendant path", `${pagesPrefix}/child`, `${workerPrefix}/child`],
    ["query string", `${pagesPrefix}?fresh=1`, `${workerPrefix}?fresh=1`],
  ])("maps its %s", async (_case, sourcePath, workerPath) => {
    const fetchMock = vi.fn(async (_request: Request) => new Response("ok"));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const response = await onRequest({
      request: new Request(`https://robbiepalmer.me${sourcePath}`),
      env: { RECIPE_API_URL: "https://recipe-api.example.test" },
    } satisfies RecipeApiProxyContext);

    expect(response.status).toBe(200);
    const forwarded = fetchMock.mock.calls[0]?.[0];
    expect(forwarded).toBeInstanceOf(Request);
    if (!(forwarded instanceof Request)) throw new Error("Expected a Request");
    expect(forwarded.url).toBe(`https://recipe-api.example.test${workerPath}`);
  });

  it("rejects an adjacent prefix", async () => {
    const fetchMock = vi.fn(async (_request: Request) => new Response("ok"));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const response = await onRequest({
      request: new Request(`https://robbiepalmer.me${pagesPrefix}-foo`),
      env: { RECIPE_API_URL: "https://recipe-api.example.test" },
    } satisfies RecipeApiProxyContext);

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
