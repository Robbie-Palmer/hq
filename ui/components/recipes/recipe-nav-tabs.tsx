"use client";

import {
  BookOpenText,
  CalendarDays,
  Compass,
  History,
  Refrigerator,
  ShoppingBasket,
} from "lucide-react";
import { usePathname } from "next/navigation";
import { RecipeMobileNav } from "@/components/recipes/recipe-mobile-nav";
import { useSelectedRecipeCount } from "@/hooks/use-shopping-list";

const destinations = [
  {
    href: "/recipes",
    label: "Recipes",
    icon: BookOpenText,
  },
  {
    href: "/recipes/discover",
    label: "Discover",
    icon: Compass,
  },
  {
    href: "/recipes/planning",
    label: "Plan",
    icon: CalendarDays,
  },
  {
    href: "/recipes/shopping",
    label: "Shop",
    icon: ShoppingBasket,
  },
  {
    href: "/recipes/kitchen",
    label: "Kitchen",
    icon: Refrigerator,
  },
  {
    href: "/recipes/log",
    label: "Log",
    icon: History,
  },
] as const;

function getActiveDestinations(pathname: string | null) {
  const onShopping = pathname === "/recipes/shopping";
  const onPlanning = pathname === "/recipes/planning";
  const onKitchen = pathname === "/recipes/kitchen";
  const onLog = pathname === "/recipes/log";
  const onDiscover = pathname === "/recipes/discover";
  const onSettings = pathname?.startsWith("/recipes/settings") ?? false;
  const onNotifications =
    pathname?.startsWith("/recipes/notifications") ?? false;
  // Recipes covers the index and individual recipe pages, but not the shopping
  // or utility sections.
  const onRecipes =
    !onShopping &&
    !onPlanning &&
    !onKitchen &&
    !onLog &&
    !onDiscover &&
    !onSettings &&
    !onNotifications;

  const activeDestinations = {
    "/recipes": onRecipes,
    "/recipes/discover": onDiscover,
    "/recipes/planning": onPlanning,
    "/recipes/shopping": onShopping,
    "/recipes/kitchen": onKitchen,
    "/recipes/log": onLog,
  } satisfies Record<(typeof destinations)[number]["href"], boolean>;
  return activeDestinations;
}

export function RecipeNavTabs() {
  const pathname = usePathname();
  const count = useSelectedRecipeCount();
  const activeDestinations = getActiveDestinations(pathname);

  return (
    <>
      <nav
        aria-label="Recipe sections"
        className="hidden max-w-full items-center gap-2 overflow-x-auto pb-1 md:flex md:gap-4"
      >
        {destinations.map(({ href, label, icon: Icon }) => {
          const active = activeDestinations[href];
          return (
            <a
              key={href}
              href={href}
              aria-label={
                href === "/recipes/shopping"
                  ? `Shopping${count > 0 ? `, ${count} ${count === 1 ? "recipe" : "recipes"} selected` : ""}`
                  : undefined
              }
              aria-current={active ? "page" : undefined}
              className="rt-tab inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap py-1 text-base lg:text-lg"
              data-active={active || undefined}
            >
              <Icon aria-hidden="true" className="size-4" />
              <span>{label}</span>
              {href === "/recipes/shopping" && count > 0 && (
                <span
                  role="img"
                  aria-label={`${count} ${count === 1 ? "recipe" : "recipes"} selected`}
                  className="inline-flex size-[1.15rem] min-w-[1.15rem] items-center justify-center rounded-full bg-[var(--terracotta)] px-1 text-[0.65rem] leading-none font-semibold text-white"
                >
                  {count}
                </span>
              )}
            </a>
          );
        })}
      </nav>
      <RecipeMobileNav count={count} pathname={pathname} />
    </>
  );
}
