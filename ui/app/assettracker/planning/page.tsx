import type { Metadata } from "next";
import { AssetTrackerPlanning } from "@/app/_projects/personal-finance-app/routes/planning";

export const metadata: Metadata = { title: "Financial independence" };

export default function AssetTrackerPlanningPage() {
  return <AssetTrackerPlanning />;
}
