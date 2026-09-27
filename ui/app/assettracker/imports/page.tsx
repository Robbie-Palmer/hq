import type { Metadata } from "next";
import { AssetTrackerRoutePlaceholder } from "@/components/assettracker/asset-tracker-route-placeholder";

export const metadata: Metadata = { title: "Imports" };

export default function AssetTrackerImportsPage() {
  return (
    <AssetTrackerRoutePlaceholder
      title="Imports"
      description="Bring account balances, income history, and portable Asset Tracker data into the household model."
    />
  );
}
