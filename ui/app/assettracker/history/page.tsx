import type { Metadata } from "next";
import { AssetTrackerRoutePlaceholder } from "@/components/assettracker/asset-tracker-route-placeholder";

export const metadata: Metadata = { title: "History" };

export default function AssetTrackerHistoryPage() {
  return (
    <AssetTrackerRoutePlaceholder
      title="History"
      description="Inspect how net worth, contributed capital, and asset allocation changed over time."
    />
  );
}
