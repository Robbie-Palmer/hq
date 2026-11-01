"use client";

import { cva } from "class-variance-authority";
import { ChevronDown, Code2, Lightbulb } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { CommandPaletteTrigger } from "@/components/command-palette-shell";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useNavbarActions } from "@/contexts/navbar-actions-context";
import { useNavbarVisibility } from "@/hooks/use-navbar-visibility";
import { siteConfig } from "@/lib/config/site-config";
import { AnimatedThemeToggler } from "./ui/animated-theme-toggler";

const headerVariants = cva(
  "sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 transition-transform duration-200 ease-in-out",
  {
    variants: {
      visible: {
        true: "translate-y-0",
        false: "-translate-y-full",
      },
    },
    defaultVariants: {
      visible: true,
    },
  },
);

const moreDestinations = [
  {
    href: "/ideas",
    label: "Ideas",
    description: "Concepts and mental models",
    icon: Lightbulb,
  },
  {
    href: "/technologies",
    label: "Technologies",
    description: "Tools, languages, and platforms",
    icon: Code2,
  },
] as const;

function MoreNavigation() {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="hidden px-2 md:inline-flex md:px-4"
        >
          More
          <ChevronDown className="size-4" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-64 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
      >
        <nav aria-label="More pages">
          {moreDestinations.map(({ href, label, description, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setOpen(false)}
              className="flex items-start gap-3 rounded-sm px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>
                <span className="block font-medium">{label}</span>
                <span className="block text-xs text-muted-foreground">
                  {description}
                </span>
              </span>
            </Link>
          ))}
        </nav>
      </PopoverContent>
    </Popover>
  );
}

export function ScrollNavbar() {
  const isVisible = useNavbarVisibility();
  const { hasActions } = useNavbarActions();

  return (
    <header
      className={headerVariants({ visible: isVisible })}
      data-site-chrome="header"
    >
      <nav className="container mx-auto px-4 py-4 max-w-7xl flex items-center justify-between gap-2">
        <div className="flex items-center gap-4">
          <div id="navbar-actions" className="lg:hidden flex items-center" />
          <Link href="/" className="text-xl font-bold hover:text-primary">
            <span className="md:hidden">RP</span>
            <span className="hidden md:inline">{siteConfig.name}</span>
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" className="px-2 md:px-4" asChild>
            <Link href="/blog">Blog</Link>
          </Button>
          <Button variant="ghost" className="px-2 md:px-4" asChild>
            <Link href="/projects">Projects</Link>
          </Button>
          <MoreNavigation />
          <Button variant="ghost" className="px-2 md:px-4" asChild>
            <Link href="/experience">
              {hasActions ? (
                <>
                  <span className="min-[500px]:hidden">Exp</span>
                  <span className="hidden min-[500px]:inline">Experience</span>
                </>
              ) : (
                <>
                  <span className="min-[420px]:hidden">Exp</span>
                  <span className="hidden min-[420px]:inline">Experience</span>
                </>
              )}
            </Link>
          </Button>
          <CommandPaletteTrigger />
          <AnimatedThemeToggler />
        </div>
      </nav>
    </header>
  );
}
