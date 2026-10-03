"use client";

import {
  BookOpenText,
  Compass,
  History,
  Refrigerator,
  ShoppingBasket,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSelectedRecipeCount } from "@/hooks/use-shopping-list";

const destinations = [
  {
    href: "/recipes",
    label: "Recipes",
    icon: BookOpenText,
  },
  {
    href: "/recipes/shopping",
    label: "Shopping",
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
  {
    href: "/recipes/discover",
    label: "Discover",
    icon: Compass,
  },
] as const;

export function RecipeNavTabs() {
  const pathname = usePathname();
  const count = useSelectedRecipeCount();

  const onShopping = pathname === "/recipes/shopping";
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
    !onKitchen &&
    !onLog &&
    !onDiscover &&
    !onSettings &&
    !onNotifications;

  const activeDestinations = {
    "/recipes": onRecipes,
    "/recipes/shopping": onShopping,
    "/recipes/kitchen": onKitchen,
    "/recipes/log": onLog,
    "/recipes/discover": onDiscover,
  } satisfies Record<(typeof destinations)[number]["href"], boolean>;

  return (
    <nav
      aria-label="Recipe sections"
      className="flex max-w-full items-center gap-2 overflow-x-auto pb-1 md:gap-4"
    >
      {destinations.map(({ href, label, icon: Icon }) => {
        const active = activeDestinations[href];
        return (
          <Link
            key={href}
            href={href}
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
          </Link>
        );
      })}
    </nav>
  );
}
