"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { PlannerShell } from "../components/planner-shell";

export function WeddingPlannerLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname();
  if (pathname === "/wedding-planner/playlist") return children;
  return <PlannerShell>{children}</PlannerShell>;
}
