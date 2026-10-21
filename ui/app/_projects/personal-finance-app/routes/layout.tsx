import type { ReactNode } from "react";
import { AssetTrackerLayoutClient } from "../components/asset-tracker-layout-client";

export function AssetTrackerLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return <AssetTrackerLayoutClient>{children}</AssetTrackerLayoutClient>;
}
