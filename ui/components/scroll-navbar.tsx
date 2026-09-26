"use client";

import { cva } from "class-variance-authority";
import Link from "next/link";
import { CommandPaletteTrigger } from "@/components/command-palette-shell";
import { Button } from "@/components/ui/button";
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

export function ScrollNavbar() {
  const isVisible = useNavbarVisibility();
  const { hasActions } = useNavbarActions();

  return (
    <header className={headerVariants({ visible: isVisible })}>
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
          <Button
            variant="ghost"
            className="hidden px-2 md:inline-flex md:px-4"
            asChild
          >
            <Link href="/ideas">Ideas</Link>
          </Button>
          <Button variant="ghost" className="px-2 md:px-4" asChild>
            <Link href="/experience">
              {hasActions ? (
                <>
                  <span className="min-[500px]:hidden">Exp</span>
                  <span className="hidden min-[500px]:inline">Experience</span>
                </>
              ) : (
                <>
                  <span className="min-[375px]:hidden">Exp</span>
                  <span className="hidden min-[375px]:inline">Experience</span>
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
