/**
 * Resolve an untrusted return target to a same-origin recipe route. URL
 * resolution also normalizes dot segments before the pathname is checked.
 */
export function safeRecipeReturnPath(
  value: string | null,
  origin: string,
): string | null {
  if (!value) return null;

  try {
    const url = new URL(value, origin);
    if (url.origin !== origin || !url.pathname.startsWith("/recipes/")) {
      return null;
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

export function recipeSaveReturnPath(
  value: string | null,
  savedSlug: string,
  origin: string,
): string | null {
  const safePath = safeRecipeReturnPath(value, origin);
  if (!safePath) return null;

  const url = new URL(safePath, origin);
  if (url.pathname === "/recipes/onboarding") {
    url.searchParams.set("authored", savedSlug);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}
