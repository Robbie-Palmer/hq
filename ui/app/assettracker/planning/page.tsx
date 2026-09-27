import type { Metadata } from "next";
import { AssetTrackerRoutePlaceholder } from "@/components/assettracker/asset-tracker-route-placeholder";

export const metadata: Metadata = { title: "Planning" };

export default function AssetTrackerPlanningPage() {
  return (
    <AssetTrackerRoutePlaceholder
      title="Planning"
      description="Explore financial independence, runway, planned spending, and account projections."
    />
  );
}
