"use client";

import {
  BookOpenText,
  CalendarDays,
  Compass,
  Ellipsis,
  History,
  Refrigerator,
  Settings,
  ShoppingBasket,
  UserRound,
} from "lucide-react";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";

const primary = [
  { href: "/recipes", label: "Recipes", icon: BookOpenText },
  { href: "/recipes/planning", label: "Plan", icon: CalendarDays },
  { href: "/recipes/shopping", label: "Shop", icon: ShoppingBasket },
  { href: "/recipes/kitchen", label: "Kitchen", icon: Refrigerator },
] as const;

const more = [
  {
    href: "/recipes/discover",
    label: "Discover",
    description: "Browse recipes and cooks",
    icon: Compass,
  },
  {
    href: "/recipes/log",
    label: "Cooking log",
    description: "History and outcomes",
    icon: History,
  },
  {
    href: "/recipes/profile",
    label: "Profile",
    description: "Your public cooking profile",
    icon: UserRound,
  },
  {
    href: "/recipes/settings",
    label: "Settings",
    description: "Household, diet, units, and account",
    icon: Settings,
  },
] as const;

function isActive(pathname: string | null, href: string): boolean {
  if (href === "/recipes") {
    return (
      pathname === "/recipes" || Boolean(pathname?.startsWith("/recipes/saved"))
    );
  }
  return pathname?.startsWith(href) ?? false;
}

function CountBadge({ count }: Readonly<{ count: number }>) {
  if (count === 0) return null;
  return (
    <span
      role="img"
      aria-label={`${count} ${count === 1 ? "recipe" : "recipes"} selected`}
      className="absolute top-0 left-[55%] inline-flex min-w-4 items-center justify-center rounded-full bg-[var(--terracotta)] px-1 text-[0.6rem] leading-4 font-semibold text-white"
    >
      {count}
    </span>
  );
}

function MoreDrawer({
  active,
  pathname,
}: Readonly<{ active: boolean; pathname: string | null }>) {
  return (
    <Drawer>
      <DrawerTrigger asChild>
        <button
          type="button"
          aria-current={active ? "page" : undefined}
          className="flex min-w-0 flex-col items-center gap-0.5 px-1 py-1 rt-mono text-[0.65rem] text-[var(--ink-3)] aria-[current=page]:text-[var(--terracotta-deep)]"
        >
          <Ellipsis aria-hidden="true" className="size-5" />
          <span>More</span>
        </button>
      </DrawerTrigger>
      <DrawerContent className="recipe-theme bg-[var(--card)] pb-[max(1rem,env(safe-area-inset-bottom))]">
        <DrawerHeader className="text-left">
          <DrawerTitle className="rt-display text-3xl">More.</DrawerTitle>
          <DrawerDescription>Other recipe destinations</DrawerDescription>
        </DrawerHeader>
        <div className="px-3 pb-3">
          {more.map(({ href, label, description, icon: Icon }) => (
            <DrawerClose key={href} asChild>
              <a
                href={href}
                aria-current={isActive(pathname, href) ? "page" : undefined}
                className="flex items-center gap-3 border-t border-[var(--line)] px-2 py-3 text-left"
              >
                <span className="flex size-9 items-center justify-center rounded-lg bg-[var(--paper-warm)] text-[var(--terracotta)]">
                  <Icon aria-hidden="true" className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block rt-body text-[var(--ink)]">
                    {label}
                  </span>
                  <span className="block rt-mono text-[0.65rem] text-[var(--ink-3)]">
                    {description}
                  </span>
                </span>
              </a>
            </DrawerClose>
          ))}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

export function RecipeMobileNav({
  count,
  pathname,
}: Readonly<{ count: number; pathname: string | null }>) {
  const moreActive = more.some(({ href }) => isActive(pathname, href));
  return (
    <nav
      aria-label="Primary recipe sections"
      className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-[var(--line-strong)] bg-[var(--card)] px-1 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:hidden"
    >
      {primary.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <a
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className="relative flex min-w-0 flex-col items-center gap-0.5 px-1 py-1 rt-mono text-[0.65rem] text-[var(--ink-3)] aria-[current=page]:text-[var(--terracotta-deep)]"
          >
            <Icon aria-hidden="true" className="size-5" />
            <span>{label}</span>
            {href === "/recipes/shopping" && <CountBadge count={count} />}
          </a>
        );
      })}
      <MoreDrawer active={moreActive} pathname={pathname} />
    </nav>
  );
}
