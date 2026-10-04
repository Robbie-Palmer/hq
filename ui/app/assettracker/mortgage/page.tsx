import type { Metadata } from "next";
import { MortgageRoute } from "@/components/assettracker/mortgage-route";

export const metadata: Metadata = { title: "Mortgage planning" };

export default function AssetTrackerMortgagePage() {
  return <MortgageRoute />;
}
