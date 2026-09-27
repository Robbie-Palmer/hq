"use client";

import {
  ChartNoAxesCombinedIcon,
  CircleDollarSignIcon,
  FileClockIcon,
  FileInputIcon,
  GoalIcon,
  LandmarkIcon,
  SettingsIcon,
  WaypointsIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/lib/generic/styles";

const destinations = [
  {
    href: "/assettracker",
    label: "Overview",
    icon: ChartNoAxesCombinedIcon,
  },
  {
    href: "/assettracker/accounts",
    label: "Accounts",
    icon: LandmarkIcon,
  },
  {
    href: "/assettracker/history",
    label: "History",
    icon: FileClockIcon,
  },
  {
    href: "/assettracker/cash-flow",
    label: "Cash flow",
    icon: WaypointsIcon,
  },
  {
    href: "/assettracker/planning",
    label: "Planning",
    icon: GoalIcon,
  },
  {
    href: "/assettracker/decisions",
    label: "Decisions",
    icon: CircleDollarSignIcon,
  },
  {
    href: "/assettracker/imports",
    label: "Imports",
    icon: FileInputIcon,
  },
  {
    href: "/assettracker/settings",
    label: "Settings",
    icon: SettingsIcon,
  },
] as const;

function isCurrentDestination(pathname: string, href: string): boolean {
  if (href === "/assettracker") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function AssetTrackerNavigation({
  className,
}: Readonly<{ className?: string }>) {
  const pathname = usePathname();

  return (
    <nav aria-label="Asset Tracker sections" className={className}>
      {destinations.map(({ href, label, icon: Icon }) => {
        const current = isCurrentDestination(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={current ? "page" : undefined}
            className={cn(
              "flex min-h-10 shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              current && "bg-muted text-foreground",
            )}
          >
            <Icon aria-hidden="true" className="size-4" />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function AssetTrackerShell({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <a
        href="#asset-tracker-content"
        className="sr-only z-50 rounded-md bg-background px-3 py-2 focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to content
      </a>
      <header className="border-b">
        <div className="mx-auto flex max-w-screen-2xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link
            href="/assettracker"
            className="text-lg font-semibold tracking-tight"
          >
            Asset Tracker
          </Link>
          <Link
            href="/projects/personal-finance-app"
            className="text-sm text-muted-foreground hover:text-foreground hover:underline"
          >
            About
          </Link>
        </div>
      </header>

      <AssetTrackerNavigation className="flex gap-1 overflow-x-auto border-b px-4 py-2 md:hidden" />

      <div className="mx-auto grid w-full max-w-screen-2xl flex-1 md:grid-cols-[13rem_minmax(0,1fr)]">
        <aside className="hidden border-r px-3 py-6 md:block">
          <AssetTrackerNavigation className="sticky top-6 flex flex-col gap-1" />
        </aside>
        <main
          id="asset-tracker-content"
          className="min-w-0 px-4 py-6 sm:px-6 sm:py-8"
        >
          {children}
        </main>
      </div>

      <footer className="border-t px-4 py-6">
        <p className="text-center text-sm text-muted-foreground">
          Asset Tracker keeps its current data in this browser.
        </p>
      </footer>
    </div>
  );
}
