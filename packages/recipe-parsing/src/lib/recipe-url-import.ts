import ipaddr from "ipaddr.js";

const MAX_RECIPE_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 10_000;

export class RecipeUrlImportError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 413 | 415 | 422 | 502 | 504,
  ) {
    super(message);
    this.name = "RecipeUrlImportError";
  }
}

function isNonPublicIp(hostname: string): boolean {
  if (!ipaddr.isValid(hostname)) return false;
  return ipaddr.process(hostname).range() !== "unicast";
}

export function validateRecipeUrl(value: string | URL): URL {
  let url: URL;
  try {
    url = value instanceof URL ? value : new URL(value);
  } catch {
    throw new RecipeUrlImportError("Enter a valid recipe page URL", 400);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new RecipeUrlImportError("Recipe URLs must use http or https", 400);
  }
  if (url.username || url.password) {
    throw new RecipeUrlImportError("Recipe URLs must not contain credentials", 400);
  }
  if (
    (url.protocol === "http:" && url.port && url.port !== "80") ||
    (url.protocol === "https:" && url.port && url.port !== "443")
  ) {
    throw new RecipeUrlImportError("Recipe URLs must use a standard web port", 400);
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    !hostname ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    isNonPublicIp(hostname)
  ) {
    throw new RecipeUrlImportError("That recipe URL cannot be accessed", 400);
  }
  return url;
}

async function readLimitedText(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_RECIPE_PAGE_BYTES
  ) {
    throw new RecipeUrlImportError("The recipe page is too large to import", 413);
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RECIPE_PAGE_BYTES) {
      await reader.cancel();
      throw new RecipeUrlImportError("The recipe page is too large to import", 413);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function redirectUrl(
  response: Response,
  currentUrl: URL,
  redirectCount: number,
): URL | undefined {
  if (response.status < 300 || response.status >= 400) return undefined;
  const location = response.headers.get("location");
  if (!location) {
    throw new RecipeUrlImportError(
      "The recipe page returned a redirect without a destination",
      502,
    );
  }
  if (redirectCount === MAX_REDIRECTS) {
    throw new RecipeUrlImportError(
      "The recipe page redirected too many times",
      502,
    );
  }
  return validateRecipeUrl(new URL(location, currentUrl));
}

function validateRecipePageResponse(response: Response): void {
  if (!response.ok) {
    throw new RecipeUrlImportError("The recipe page could not be fetched", 502);
  }
  const contentType = response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (
    contentType !== "text/html" &&
    contentType !== "application/xhtml+xml"
  ) {
    throw new RecipeUrlImportError(
      "The URL does not point to an HTML page",
      415,
    );
  }
}

function rethrowFetchError(error: unknown): never {
  if (error instanceof RecipeUrlImportError) throw error;
  if (error instanceof Error && error.name === "TimeoutError") {
    throw new RecipeUrlImportError(
      "The recipe page took too long to respond",
      504,
    );
  }
  throw new RecipeUrlImportError("The recipe page could not be fetched", 502);
}

export async function fetchRecipePage(
  rawUrl: string,
  fetcher: typeof fetch = fetch,
): Promise<{ html: string; url: string }> {
  let url = validateRecipeUrl(rawUrl);
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);

  try {
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
      // Cloudflare owns DNS resolution and egress enforcement for Workers fetch.
      // Literal and redirect targets are checked here; protection from a hostname
      // resolving to a private address relies on Cloudflare's network boundary.
      const response = await fetcher(url, {
        headers: {
          accept: "text/html,application/xhtml+xml",
          "user-agent": "RecipeImporter/1.0 (+https://robbiepalmer.me/recipes)",
        },
        redirect: "manual",
        signal,
      });
      const nextUrl = redirectUrl(response, url, redirect);
      if (nextUrl) {
        url = nextUrl;
        continue;
      }
      validateRecipePageResponse(response);
      return { html: await readLimitedText(response), url: url.toString() };
    }
  } catch (error) {
    rethrowFetchError(error);
  }

  throw new RecipeUrlImportError("The recipe page could not be fetched", 502);
}
