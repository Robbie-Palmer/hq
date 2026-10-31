"use client";

import {
  BedDouble,
  ChevronDown,
  ClipboardCheck,
  Download,
  Heart,
  LayoutDashboard,
  Music2,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useRef } from "react";
import { cn } from "@/lib/generic/styles";

const destinations = [
  {
    href: "/wedding-planner/readiness",
    label: "Readiness",
    icon: LayoutDashboard,
  },
  { href: "/wedding-planner/guests", label: "Guests", icon: Users },
  {
    href: "/wedding-planner/accommodation",
    label: "Accommodation",
    icon: BedDouble,
  },
  { href: "/wedding-planner/seating", label: "Seating", icon: ClipboardCheck },
  { href: "/wedding-planner/music", label: "Music", icon: Music2 },
  { href: "/wedding-planner/exports", label: "Exports", icon: Download },
] as const;

const accommodationSteps = [
  { href: "/wedding-planner/accommodation", label: "Beds" },
  { href: "/wedding-planner/accommodation/sharing", label: "Sharing" },
  { href: "/wedding-planner/accommodation/inventory", label: "Inventory" },
  { href: "/wedding-planner/accommodation/rooms", label: "Rooms & costs" },
  { href: "/wedding-planner/accommodation/result", label: "Room plan" },
] as const;

function isCurrent(pathname: string, href: string): boolean {
  if (href === "/wedding-planner/accommodation") {
    return pathname === href || pathname.startsWith(`${href}/`);
  }
  return pathname === href;
}

function PlannerNavigation({
  className,
  onNavigate,
}: Readonly<{ className?: string; onNavigate?: () => void }>) {
  const pathname = usePathname();
  return (
    <nav aria-label="Wedding planner sections" className={className}>
      {destinations.map(({ href, label, icon: Icon }) => {
        const current = isCurrent(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={current ? "page" : undefined}
            className={cn("wedding-nav-link", current && "active")}
            onClick={onNavigate}
          >
            <Icon aria-hidden="true" size={18} />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function AccommodationNavigation() {
  const pathname = usePathname();
  if (!pathname.startsWith("/wedding-planner/accommodation")) return null;
  return (
    <nav aria-label="Accommodation workflow" className="accommodation-nav">
      {accommodationSteps.map(({ href, label }) => {
        const current = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={current ? "step" : undefined}
            className={current ? "active" : undefined}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

function MobileNavigation() {
  const pathname = usePathname();
  const details = useRef<HTMLDetailsElement>(null);
  const current =
    destinations.find(({ href }) => isCurrent(pathname, href)) ??
    destinations[0];
  const Icon = current.icon;
  return (
    <details ref={details} className="wedding-mobile-nav">
      <summary>
        <Icon aria-hidden="true" size={18} />
        <span>{current.label}</span>
        <small>Sections</small>
        <ChevronDown aria-hidden="true" size={18} />
      </summary>
      <PlannerNavigation
        onNavigate={() => details.current?.removeAttribute("open")}
      />
    </details>
  );
}

export function PlannerShell({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="editor-app">
      <a href="#wedding-planner-content" className="wedding-skip-link">
        Skip to planner content
      </a>
      <header className="editor-header">
        <Link href="/wedding-planner/readiness" className="editor-brand">
          <span className="brand-mark">
            <Heart aria-hidden="true" size={18} fill="currentColor" />
          </span>
          <span>
            Wedding planner <small>Rooms, tables &amp; music</small>
          </span>
        </Link>
        <Link href="/projects/wedding-planner" className="wedding-about-link">
          About
        </Link>
      </header>
      <MobileNavigation />
      <AccommodationNavigation />
      <div className="wedding-shell">
        <aside className="wedding-sidebar">
          <PlannerNavigation />
        </aside>
        {children}
      </div>
      <footer className="wedding-footer">
        Private planning data stays in this browser.
      </footer>
    </div>
  );
}
