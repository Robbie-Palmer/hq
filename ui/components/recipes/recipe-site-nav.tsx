"use client";

import { usePathname } from "next/navigation";
import { RecipeNavTabs } from "@/components/recipes/recipe-nav-tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { authClient } from "@/lib/auth-client";

const publicTabs = [
  { href: "/recipes/discover", label: "Discover", match: "/recipes/discover" },
  { href: "/recipes/cooks", label: "Cooks", match: "/recipes/cooks" },
  { href: "/recipes#how-it-works", label: "How it works", match: null },
] as const;

export function RecipeSiteNav() {
  const pathname = usePathname();
  const { data: session, isPending } = authClient.useSession();

  if (isPending) {
    return (
      <div className="flex max-w-full items-center gap-3 overflow-hidden sm:gap-4">
        <Skeleton className="h-6 w-20" />
        <Skeleton className="h-6 w-16" />
        <Skeleton className="h-6 w-24" />
        <output aria-label="Loading recipe navigation" className="sr-only">
          Loading recipe navigation…
        </output>
      </div>
    );
  }

  if (session) return <RecipeNavTabs />;

  return (
    <nav
      aria-label="Recipe sections"
      className="flex max-w-full items-center gap-3 overflow-x-auto pb-1 sm:gap-4"
    >
      {publicTabs.map((tab) => (
        <a
          key={tab.label}
          href={tab.href}
          className="rt-tab whitespace-nowrap text-base lg:text-lg"
          data-active={
            tab.match && pathname?.startsWith(tab.match) ? true : undefined
          }
        >
          {tab.label}
        </a>
      ))}
    </nav>
  );
}
