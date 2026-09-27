import type { Metadata } from "next";
import { AssetTrackerRoutePlaceholder } from "@/components/assettracker/asset-tracker-route-placeholder";

export const metadata: Metadata = { title: "Decisions" };

export default function AssetTrackerDecisionsPage() {
  return (
    <AssetTrackerRoutePlaceholder
      title="Decisions"
      description="Recorded financial decisions and their later outcomes will live here. No decision records exist yet."
    />
  );
}
