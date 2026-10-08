"use client";

import { usePathname } from "next/navigation";
import { ThemeProvider as NextThemesProvider } from "next-themes";
import type * as React from "react";

export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  const pathname = usePathname();
  const isWeddingPlanner =
    pathname === "/wedding-planner" || pathname.startsWith("/wedding-planner/");

  return (
    <NextThemesProvider
      {...props}
      forcedTheme={isWeddingPlanner ? "light" : props.forcedTheme}
    >
      {children}
    </NextThemesProvider>
  );
}
