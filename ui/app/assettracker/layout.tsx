import type { Metadata } from "next";
import { AssetTrackerLayoutClient } from "@/components/assettracker/asset-tracker-layout-client";

export const metadata: Metadata = {
  title: {
    default: "Asset Tracker",
    template: "%s | Asset Tracker",
  },
  description: "Track and manage your assets",
};

export default function AssetTrackerLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <AssetTrackerLayoutClient>{children}</AssetTrackerLayoutClient>;
}
