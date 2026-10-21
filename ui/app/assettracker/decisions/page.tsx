import type { Metadata } from "next";
import { AssetTrackerDecisions } from "@/app/_projects/personal-finance-app/routes/decisions";

export const metadata: Metadata = { title: "Decisions" };

export default function AssetTrackerDecisionsPage() {
  return <AssetTrackerDecisions />;
}
