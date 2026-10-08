const RECIPE_APP_ROUTE_SLUGS = new Set([
  "add",
  "cooks",
  "discover",
  "edit",
  "kitchen",
  "log",
  "notifications",
  "offline",
  "onboarding",
  "profile",
  "saved",
  "settings",
  "shopping",
]);

export const LOWERCASE_KEBAB_CASE_PATTERN =
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const RECIPE_SLUG_MAX_LENGTH = 120;

export function isRecipeAppRouteSlug(slug: string): boolean {
  return RECIPE_APP_ROUTE_SLUGS.has(slug);
}

export function isRecipeSlug(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= RECIPE_SLUG_MAX_LENGTH &&
    LOWERCASE_KEBAB_CASE_PATTERN.test(value)
  );
}

export function recipeSlugFromPathname(pathname: string): string | null {
  const match = /^\/recipes\/([^/]+)\/?$/.exec(pathname);
  const slug = match?.[1];
  return isRecipeSlug(slug) && !isRecipeAppRouteSlug(slug) ? slug : null;
}

export function normalizeSlug(text: string): string {
  if (!text) return "";
  return text
    .toLowerCase()
    .replaceAll("++", "plusplus")
    .replaceAll("#", "sharp")
    .replaceAll(".", "dot")
    .replace(/\s+/g, "-") // Spaces to hyphens
    .replace(/[^a-z0-9-]+/g, "") // Remove remaining special chars
    .replace(/-{2,}/g, "-") // Collapse consecutive hyphens
    .replace(/(^-|-$)/g, ""); // Remove leading/trailing hyphens
}
