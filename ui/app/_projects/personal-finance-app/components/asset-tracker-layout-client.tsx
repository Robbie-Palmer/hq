"use client";

import type { ReactNode } from "react";
import { AssetTrackerProvider } from "./asset-tracker-provider";
import { AssetTrackerShell } from "./asset-tracker-shell";

export function AssetTrackerLayoutClient({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <AssetTrackerProvider>
      <AssetTrackerShell>{children}</AssetTrackerShell>
    </AssetTrackerProvider>
  );
}
