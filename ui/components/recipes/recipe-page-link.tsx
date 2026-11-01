"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type ComponentPropsWithoutRef,
  createContext,
  type MouseEvent,
  type ReactNode,
  useContext,
} from "react";
import { isRecipeAppRouteSlug } from "recipe-domain/slugs";
import {
  recipePageHref,
  type SavedRecipeApiRecord,
} from "@/lib/domain/recipe/recipeDraft";

type RecipePageLinkProps = Omit<ComponentPropsWithoutRef<"a">, "href"> & {
  href: string;
};

const RecipeNavigationContext = createContext<{
  push: (href: string) => void;
} | null>(null);

const RECIPE_PATH = /^\/recipes\/([^/]+)$/;

function decodedRecipeSlug(href: string): string | null {
  const segment = RECIPE_PATH.exec(href)?.[1];
  if (!segment) return null;
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function shouldUseDocumentNavigation(event: MouseEvent<HTMLAnchorElement>) {
  return Boolean(
    event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.button !== 0 ||
      event.currentTarget.target === "_blank" ||
      event.currentTarget.hasAttribute("download"),
  );
}

export function RecipeNavigationProvider({
  children,
}: Readonly<{ children: ReactNode }>) {
  const router = useRouter();
  return (
    <RecipeNavigationContext.Provider value={router}>
      {children}
    </RecipeNavigationContext.Provider>
  );
}

/**
 * Recipe detail pages are resolved by a Cloudflare Pages Function rather than
 * Next's static route manifest. Ordinary clicks enter through the exported
 * saved-recipe screen, which replaces its visible URL with the canonical
 * runtime path. Modified/new-tab clicks keep a document navigation so
 * Cloudflare can serve the canonical URL directly.
 */
export function RecipePageLink({
  href,
  children,
  ...props
}: Readonly<RecipePageLinkProps>) {
  const router = useContext(RecipeNavigationContext);
  const slug = decodedRecipeSlug(href);
  if (slug && !isRecipeAppRouteSlug(slug)) {
    return (
      <a
        href={href}
        {...props}
        onClick={(event) => {
          props.onClick?.(event);
          if (
            !router ||
            event.defaultPrevented ||
            shouldUseDocumentNavigation(event)
          ) {
            return;
          }
          event.preventDefault();
          router.push(`/recipes/saved?slug=${encodeURIComponent(slug)}`);
        }}
      >
        {children}
      </a>
    );
  }
  return (
    <Link href={href} {...props}>
      {children}
    </Link>
  );
}

export function navigateToRecipePage(
  recipe: Pick<SavedRecipeApiRecord, "slug">,
) {
  window.location.assign(recipePageHref(recipe));
}

export function replaceWithRecipePage(
  recipe: Pick<SavedRecipeApiRecord, "slug">,
) {
  window.location.replace(recipePageHref(recipe));
}
