import type { Metadata } from "next";
import { AssetTrackerTax } from "@/features/personal-finance-app/routes/tax";

export const metadata: Metadata = { title: "UK tax position" };

export default function AssetTrackerTaxPage() {
  return <AssetTrackerTax />;
}
