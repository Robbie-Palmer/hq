import type { Metadata } from "next";
import { AssetTrackerDecisions } from "@/features/personal-finance-app/routes/decisions";

export const metadata: Metadata = { title: "Decisions" };

export default function AssetTrackerDecisionsPage() {
  return <AssetTrackerDecisions />;
}
