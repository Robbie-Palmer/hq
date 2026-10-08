"use client";

import {
  ChartNoAxesCombinedIcon,
  ChevronDownIcon,
  CircleDollarSignIcon,
  FileClockIcon,
  FileInputIcon,
  GoalIcon,
  HouseIcon,
  LandmarkIcon,
  type LucideIcon,
  ReceiptTextIcon,
  SettingsIcon,
  WaypointsIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useRef } from "react";
import { cn } from "@/lib/generic/styles";
import { useAssetTracker } from "./asset-tracker-provider";
import {
  AssetTrackerLoadingState,
  AssetTrackerLocalDataError,
} from "./asset-tracker-route-state";
import { HouseholdScopeControl } from "./household-scope-control";

interface Destination {
  href: string;
  label: string;
  icon: LucideIcon;
}

interface DestinationGroup {
  label: string;
  destinations: readonly Destination[];
}

const overviewDestination: Destination = {
  href: "/assettracker",
  label: "Overview",
  icon: ChartNoAxesCombinedIcon,
};

const destinationGroups: readonly DestinationGroup[] = [
  {
    label: "Portfolio",
    destinations: [
      overviewDestination,
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
    ],
  },
  {
    label: "Forward look",
    destinations: [
      {
        href: "/assettracker/planning",
        label: "FI planning",
        icon: GoalIcon,
      },
      {
        href: "/assettracker/mortgage",
        label: "Mortgage",
        icon: HouseIcon,
      },
      {
        href: "/assettracker/decisions",
        label: "Decisions",
        icon: CircleDollarSignIcon,
      },
      {
        href: "/assettracker/tax",
        label: "UK tax",
        icon: ReceiptTextIcon,
      },
    ],
  },
  {
    label: "Data",
    destinations: [
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
    ],
  },
];

const destinations = destinationGroups.flatMap((group) => group.destinations);

function isCurrentDestination(pathname: string, href: string): boolean {
  if (href === "/assettracker") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function AssetTrackerNavigation({
  className,
  onNavigate,
  showGroupLabels = false,
}: Readonly<{
  className?: string;
  onNavigate?(): void;
  showGroupLabels?: boolean;
}>) {
  const pathname = usePathname();

  return (
    <nav aria-label="Asset Tracker sections" className={className}>
      {destinationGroups.map((group, groupIndex) => (
        <div
          key={group.label}
          className={cn(groupIndex > 0 && "mt-4 border-t pt-4")}
        >
          {showGroupLabels && (
            <p className="mb-1 px-3 text-xs font-medium text-muted-foreground">
              {group.label}
            </p>
          )}
          <div className="grid gap-1">
            {group.destinations.map(({ href, label, icon: Icon }) => {
              const current = isCurrentDestination(pathname, href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={current ? "page" : undefined}
                  className={cn(
                    "flex min-h-11 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    current && "bg-muted text-foreground",
                  )}
                  onClick={onNavigate}
                >
                  <Icon aria-hidden="true" className="size-4" />
                  <span>{label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

function AssetTrackerMobileNavigation() {
  const pathname = usePathname();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const current =
    destinations.find((destination) =>
      isCurrentDestination(pathname, destination.href),
    ) ?? overviewDestination;
  const CurrentIcon = current.icon;

  return (
    <details ref={detailsRef} className="group border-b md:hidden">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-4 py-2 font-medium marker:content-none [&::-webkit-details-marker]:hidden">
        <CurrentIcon aria-hidden="true" className="size-4" />
        <span className="flex-1">{current.label}</span>
        <span className="text-sm text-muted-foreground">Sections</span>
        <ChevronDownIcon
          aria-hidden="true"
          className="size-4 transition-transform group-open:rotate-180"
        />
      </summary>
      <AssetTrackerNavigation
        className="border-t px-4 py-3"
        showGroupLabels
        onNavigate={() => detailsRef.current?.removeAttribute("open")}
      />
    </details>
  );
}

export function AssetTrackerShell({
  children,
}: Readonly<{ children: ReactNode }>) {
  const { localDataError, localDataStatus, retryLocalData } = useAssetTracker();
  let content = children;
  if (localDataStatus === "loading") {
    content = <AssetTrackerLoadingState />;
  } else if (localDataStatus === "error" && localDataError) {
    content = (
      <AssetTrackerLocalDataError
        message={localDataError}
        onRetry={retryLocalData}
      />
    );
  }

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
            className="inline-flex min-h-11 items-center text-lg font-semibold tracking-tight"
          >
            Asset Tracker
          </Link>
          <div className="flex items-center gap-2">
            <HouseholdScopeControl />
            <Link
              href="/projects/personal-finance-app"
              className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground hover:underline"
            >
              About
            </Link>
          </div>
        </div>
      </header>

      <AssetTrackerMobileNavigation />

      <div className="mx-auto grid w-full max-w-screen-2xl flex-1 md:grid-cols-[13rem_minmax(0,1fr)]">
        <aside className="hidden border-r px-3 py-6 md:block">
          <AssetTrackerNavigation className="sticky top-6" showGroupLabels />
        </aside>
        <main
          id="asset-tracker-content"
          aria-busy={localDataStatus === "loading"}
          className="min-w-0 px-4 py-6 sm:px-6 sm:py-8"
        >
          {content}
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
