import type { Metadata } from "next";
import { TaxPositionRoute } from "@/components/assettracker/tax-position-route";

export const metadata: Metadata = { title: "UK tax position" };

export default function AssetTrackerTaxPage() {
  return <TaxPositionRoute />;
}
