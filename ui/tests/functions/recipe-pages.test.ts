import { afterEach, describe, expect, it, vi } from "vitest";
import { onRequest } from "../../../functions/recipes/[[path]]";

type Context = Parameters<typeof onRequest>[0];
const originalFetch = globalThis.fetch;

class TestHtmlRewriterElement {
  constructor(private readonly element: Element) {}

  append(content: string, options: { html: true }): void {
    if (options.html) this.element.insertAdjacentHTML("beforeend", content);
  }

  remove(): void {
    this.element.remove();
  }

  setAttribute(name: string, value: string): void {
    this.element.setAttribute(name, value);
  }

  setInnerContent(content: string): void {
    this.element.textContent = content;
  }
}

class TestHtmlRewriter {
  private readonly handlers: Array<{
    selector: string;
    element: (element: TestHtmlRewriterElement) => void;
  }> = [];

  on(
    selector: string,
    handlers: { element(element: TestHtmlRewriterElement): void },
  ): TestHtmlRewriter {
    this.handlers.push({ selector, element: handlers.element });
    return this;
  }

  transform(response: Response): Response {
    const handlers = this.handlers;
    const body = new ReadableStream({
      async start(controller) {
        const document = new DOMParser().parseFromString(
          await response.text(),
          "text/html",
        );
        for (const handler of handlers) {
          for (const element of document.querySelectorAll(handler.selector)) {
            handler.element(new TestHtmlRewriterElement(element));
          }
        }
        controller.enqueue(
          new TextEncoder().encode(document.documentElement.outerHTML),
        );
        controller.close();
      },
    });
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }
}

vi.stubGlobal("HTMLRewriter", TestHtmlRewriter);

const payload = {
  version: 1,
  source: "Simmer @lentils{200%g} for ~{20%minutes}.",
  recipe: {
    title: "Lentil Soup",
    description: "A useful soup.",
    date: "2026-07-22",
    cuisine: ["Irish"],
    servings: 4,
    prepTime: 10 as number | undefined,
    cookTime: 20 as number | undefined,
    tags: ["soup"],
    image: undefined as string | undefined,
    imageAlt: undefined as string | undefined,
    canonical: undefined as string | undefined,
    ingredientGroups: [
      {
        name: undefined as string | undefined,
        items: [
          {
            ingredient: "red-lentils",
            amount: 200 as number | undefined,
            unit: "g" as string | undefined,
            preparation: undefined as string | undefined,
            note: undefined as string | undefined,
          },
        ],
      },
    ],
    instructions: ["Simmer the lentils."],
    cookware: ["pot"],
    cookBody: "Simmer @lentils{200%g} for ~{20%minutes}.",
  },
};

function context(
  url: string,
  headers?: HeadersInit,
  assetFetch: typeof fetch = vi.fn() as unknown as typeof fetch,
  method = "GET",
): Context {
  return {
    request: new Request(url, { headers, method }),
    env: {
      RECIPE_API_URL: "https://recipe-api.example.test",
      ASSETS: { fetch: assetFetch },
    },
    next: vi.fn(async () => new Response("next")),
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("dynamic recipe pages", () => {
  it.each(["log", "offline"])(
    "leaves the %s app route to the static site",
    async (route) => {
      const appContext = context(`https://robbiepalmer.me/recipes/${route}`);

      expect(await (await onRequest(appContext)).text()).toBe("next");
      expect(appContext.next).toHaveBeenCalledOnce();
    },
  );

  it("serves the canonical recipe URL as Markdown when negotiated", async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json({
        slug: "lentil-soup",
        title: "Lentil Soup",
        description: "A useful soup.",
        body: JSON.stringify(payload),
        visibility: "public",
      }),
    ) as typeof fetch;

    const response = await onRequest(
      context("https://robbiepalmer.me/recipes/lentil-soup", {
        accept: "text/markdown",
      }),
    );

    expect(response.headers.get("content-type")).toContain("text/markdown");
    expect(await response.text()).toContain("# Lentil Soup");
  });

  it("serves database-backed JSON-LD and Cooklang twins", async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json({
        slug: "lentil-soup",
        title: "Lentil Soup",
        description: "A useful soup.",
        body: JSON.stringify(payload),
        visibility: "public",
      }),
    ) as typeof fetch;

    const jsonResponse = await onRequest(
      context("https://robbiepalmer.me/recipes/lentil-soup.json"),
    );
    const cookResponse = await onRequest(
      context("https://robbiepalmer.me/recipes/lentil-soup.cook"),
    );

    expect(await jsonResponse.json()).toMatchObject({
      "@type": "Recipe",
      name: "Lentil Soup",
      recipeIngredient: ["200g red lentils"],
    });
    expect(await cookResponse.text()).toContain('title: "Lentil Soup"');
  });

  it("includes optional ingredient and Cooklang metadata", async () => {
    const detailedPayload = structuredClone(payload);
    detailedPayload.recipe.prepTime = undefined;
    detailedPayload.recipe.cookTime = undefined;
    detailedPayload.recipe.cuisine = [];
    detailedPayload.recipe.image = "recipes/soup-2026-07-22";
    detailedPayload.recipe.imageAlt = "A bowl of soup";
    detailedPayload.recipe.canonical = "https://example.test/soup";
    detailedPayload.recipe.ingredientGroups = [
      {
        name: "Soup",
        items: [
          {
            ingredient: "red-lentils",
            amount: undefined,
            unit: undefined,
            preparation: "rinsed",
            note: "well drained",
          },
        ],
      },
    ];
    globalThis.fetch = vi.fn(async () =>
      Response.json({
        slug: "lentil-soup",
        title: "Lentil Soup",
        description: "A useful soup.",
        body: JSON.stringify(detailedPayload),
        visibility: "public",
      }),
    ) as typeof fetch;

    const markdownResponse = await onRequest(
      context("https://robbiepalmer.me/recipes/lentil-soup.md"),
    );
    const markdown = await markdownResponse.text();
    expect(markdown).toContain("### Soup");
    expect(markdown).toContain("- red lentils (rinsed) – well drained");
    expect(markdown).not.toContain("Prep time:");
    expect(markdown).not.toContain("Cuisine:");

    const cookResponse = await onRequest(
      context("https://robbiepalmer.me/recipes/lentil-soup.cook"),
    );
    const cooklang = await cookResponse.text();
    expect(cooklang).toContain('image: "recipes/soup-2026-07-22"');
    expect(cooklang).toContain('imageAlt: "A bowl of soup"');
    expect(cooklang).toContain('canonical: "https://example.test/soup"');
    expect(cooklang).not.toContain("prepTime:");
  });

  it("serves an indexable HTML shell with recipe-specific metadata", async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json({
        slug: "lentil-soup",
        title: "Lentil Soup",
        description: "A useful soup.",
        body: JSON.stringify(payload),
        visibility: "public",
      }),
    ) as typeof fetch;
    const assetFetch = vi.fn(
      async () =>
        new Response(
          "<html><head><title>Saved Recipe</title><META content='Saved' name='description'><META content='noindex, nofollow' name='robots'><LINK href='https://robbiepalmer.me' rel='canonical'></head><body></body></html>",
        ),
    ) as typeof fetch;

    const response = await onRequest(
      context(
        "https://robbiepalmer.me/recipes/lentil-soup",
        { accept: "text/html" },
        assetFetch,
      ),
    );
    const html = await response.text();

    expect(html).toContain("<title>Lentil Soup</title>");
    const document = new DOMParser().parseFromString(html, "text/html");
    const canonicalLinks = document.querySelectorAll('link[rel="canonical"]');
    expect(canonicalLinks).toHaveLength(1);
    expect(canonicalLinks[0]?.getAttribute("href")).toBe(
      "https://robbiepalmer.me/recipes/lentil-soup",
    );
    expect(html).toContain('type="application/ld+json"');
    expect(html).not.toContain("noindex");
  });

  it.each(["private", "household"] as const)(
    "serves an authorized %s recipe at its canonical path without indexing it",
    async (visibility) => {
      const apiFetch = vi.fn(async (request: Request) => {
        expect(request.url).toBe(
          "https://recipe-api.example.test/recipes/lentil-soup",
        );
        expect(request.headers.get("cookie")).toBe(
          "better-auth.session_token=valid",
        );
        return Response.json({
          slug: "lentil-soup",
          title: "Lentil Soup",
          description: "A useful soup.",
          body: JSON.stringify(payload),
          visibility,
        });
      });
      globalThis.fetch = apiFetch as unknown as typeof fetch;
      const assetFetch = vi.fn(
        async () =>
          new Response(
            '<html><head><title>Saved Recipe</title><meta name="description" content="Saved"><meta name="robots" content="noindex, nofollow"></head><body></body></html>',
          ),
      ) as typeof fetch;

      const response = await onRequest(
        context(
          "https://robbiepalmer.me/recipes/lentil-soup",
          {
            accept: "text/html",
            cookie: "better-auth.session_token=valid",
          },
          assetFetch,
        ),
      );
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(html).toContain("<title>Lentil Soup</title>");
      expect(html).toContain('name="robots" content="noindex, nofollow"');
      expect(html).not.toContain('rel="canonical"');
      expect(html).not.toContain('type="application/ld+json"');
    },
  );

  it("returns 404 when the visitor cannot read the requested recipe", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("Not found", { status: 404 }),
    ) as typeof fetch;
    const assetFetch = vi.fn() as unknown as typeof fetch;

    const response = await onRequest(
      context(
        "https://robbiepalmer.me/recipes/private-soup",
        { accept: "text/html" },
        assetFetch,
      ),
    );

    expect(response.status).toBe(404);
    expect(assetFetch).not.toHaveBeenCalled();
  });

  it("escapes HTML metadata and preserves the static asset response", async () => {
    const escapedPayload = structuredClone(payload);
    escapedPayload.recipe.title =
      '</title><script>alert("metadata injection")</script>';
    escapedPayload.recipe.description = "";
    globalThis.fetch = vi.fn(async () =>
      Response.json({
        slug: "lentil-soup",
        title: escapedPayload.recipe.title,
        description: 'Stored "description" & <detail>',
        body: JSON.stringify(escapedPayload),
        visibility: "public",
      }),
    ) as typeof fetch;
    const assetFetchMock = vi.fn(
      async (_request: Request) =>
        new Response(
          '<html><head><title>Saved Recipe</title><meta name="description" content="Saved"><meta name="robots" content="noindex"></head><body></body></html>',
          {
            status: 201,
            headers: {
              "content-length": "999",
              "content-encoding": "gzip",
              etag: '"shell-v1"',
              "last-modified": "Wed, 22 Jul 2026 12:00:00 GMT",
              "x-asset": "saved-recipe",
            },
          },
        ),
    );
    const assetFetch = assetFetchMock as unknown as typeof fetch;

    const response = await onRequest(
      context(
        "https://robbiepalmer.me/recipes/lentil-soup",
        {
          accept: "text/html",
          "if-none-match": '"recipe-v1"',
          "if-modified-since": "Wed, 22 Jul 2026 12:00:00 GMT",
        },
        assetFetch,
      ),
    );
    const html = await response.text();

    expect(response.status).toBe(201);
    expect(response.headers.get("x-asset")).toBe("saved-recipe");
    expect(response.headers.has("content-length")).toBe(false);
    expect(response.headers.has("content-encoding")).toBe(false);
    expect(response.headers.has("etag")).toBe(false);
    expect(response.headers.has("last-modified")).toBe(false);
    const shellRequest = assetFetchMock.mock.calls[0]?.[0] as Request;
    expect(shellRequest.headers.has("if-none-match")).toBe(false);
    expect(shellRequest.headers.has("if-modified-since")).toBe(false);
    const rewrittenDocument = new DOMParser().parseFromString(
      html,
      "text/html",
    );
    expect(rewrittenDocument.querySelector("title")?.textContent).toBe(
      '</title><script>alert("metadata injection")</script>',
    );
    expect(
      rewrittenDocument.querySelector(
        'script:not([type="application/ld+json"])',
      ),
    ).toBeNull();
    expect(
      rewrittenDocument
        .querySelector('meta[name="description"]')
        ?.getAttribute("content"),
    ).toBe('Stored "description" & <detail>');
    expect(html).toContain(
      String.raw`\u003c/title>\u003cscript>alert(\"metadata injection\")\u003c/script>`,
    );
  });

  it("rewrites HEAD headers and returns asset failures unchanged", async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json({
        slug: "lentil-soup",
        title: "Lentil Soup",
        description: null,
        body: JSON.stringify(payload),
        visibility: "public",
      }),
    ) as typeof fetch;
    const failedAsset = new Response("asset unavailable", { status: 503 });
    const failedResponse = await onRequest(
      context(
        "https://robbiepalmer.me/recipes/lentil-soup",
        undefined,
        vi.fn(async () => failedAsset) as typeof fetch,
      ),
    );
    expect(failedResponse).toBe(failedAsset);

    globalThis.fetch = vi.fn(async () =>
      Response.json({
        slug: "lentil-soup",
        title: "Lentil Soup",
        description: null,
        body: JSON.stringify(payload),
        visibility: "private",
      }),
    ) as typeof fetch;
    const headAsset = new Response(null, { headers: { etag: "cached" } });
    const headResponse = await onRequest(
      context(
        "https://robbiepalmer.me/recipes/lentil-soup",
        undefined,
        vi.fn(async () => headAsset) as typeof fetch,
        "HEAD",
      ),
    );
    expect(headResponse.status).toBe(200);
    expect(headResponse.headers.get("cache-control")).toBe("private, no-store");
    expect(headResponse.headers.has("etag")).toBe(false);
  });

  it("returns not found when the public recipe cannot be decoded", async () => {
    const noApiContext = context(
      "https://robbiepalmer.me/recipes/lentil-soup.md",
    );
    delete noApiContext.env.RECIPE_API_URL;
    expect((await onRequest(noApiContext)).status).toBe(404);

    const apiResponses = [
      new Response("unavailable", { status: 503 }),
      Response.json({ body: null }),
      Response.json({ body: "{" }),
      Response.json({ body: JSON.stringify({ ...payload, version: 2 }) }),
    ];
    for (const apiResponse of apiResponses) {
      globalThis.fetch = vi.fn(async () => apiResponse) as typeof fetch;
      const response = await onRequest(
        context("https://robbiepalmer.me/recipes/lentil-soup.json"),
      );
      expect(response.status).toBe(404);
    }

    const requestSignals: AbortSignal[] = [];
    globalThis.fetch = vi.fn(async (_input, init) => {
      if (init?.signal) requestSignals.push(init.signal);
      throw new Error("network unavailable");
    }) as typeof fetch;
    expect(
      (
        await onRequest(
          context("https://robbiepalmer.me/recipes/lentil-soup.md"),
        )
      ).status,
    ).toBe(404);
    expect(requestSignals[0]).toBeInstanceOf(AbortSignal);

    globalThis.fetch = vi.fn(
      async () =>
        new Response("not JSON", {
          headers: { "content-type": "application/json" },
        }),
    ) as typeof fetch;
    expect(
      (
        await onRequest(
          context("https://robbiepalmer.me/recipes/lentil-soup.md"),
        )
      ).status,
    ).toBe(404);
  });

  it.each([
    "https://robbiepalmer.me/recipes/onboarding",
    "https://robbiepalmer.me/recipes/edit?slug=lentil-soup",
  ])("leaves named application route %s to its static page", async (url) => {
    const requestContext = context(url);
    const response = await onRequest(requestContext);

    expect(await response.text()).toBe("next");
    expect(requestContext.next).toHaveBeenCalledOnce();
  });

  it.each([
    "https://robbiepalmer.me/recipes",
    "https://robbiepalmer.me/recipes/folder/lentil-soup",
    "https://robbiepalmer.me/recipes/Invalid-Slug",
  ])("passes non-recipe path %s to the next handler", async (url) => {
    const requestContext = context(url);
    const response = await onRequest(requestContext);

    expect(await response.text()).toBe("next");
    expect(requestContext.next).toHaveBeenCalledOnce();
  });
});
