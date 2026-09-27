import type { Metadata } from "next";
import { AssetTrackerRoutePlaceholder } from "@/components/assettracker/asset-tracker-route-placeholder";

export const metadata: Metadata = { title: "Cash flow" };

export default function AssetTrackerCashFlowPage() {
  return (
    <AssetTrackerRoutePlaceholder
      title="Cash flow"
      description="Understand upcoming and recurring money movement across the household and its accounts."
    />
  );
}
