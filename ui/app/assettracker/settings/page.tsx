import type { Metadata } from "next";
import { AssetTrackerRoutePlaceholder } from "@/components/assettracker/asset-tracker-route-placeholder";

export const metadata: Metadata = { title: "Settings" };

export default function AssetTrackerSettingsPage() {
  return (
    <AssetTrackerRoutePlaceholder
      title="Settings"
      description="Manage household assumptions, portable exports, demo restoration, and locally stored data."
    />
  );
}
