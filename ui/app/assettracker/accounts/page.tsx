import type { Metadata } from "next";
import { AssetTrackerRoutePlaceholder } from "@/components/assettracker/asset-tracker-route-placeholder";

export const metadata: Metadata = { title: "Accounts" };

export default function AssetTrackerAccountsPage() {
  return (
    <AssetTrackerRoutePlaceholder
      title="Accounts"
      description="Review each asset and liability, then record balances, transfers, expected flows, and account history."
    />
  );
}
