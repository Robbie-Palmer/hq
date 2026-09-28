import type { Metadata } from "next";
import { PlanningRoute } from "@/components/assettracker/planning-route";

export const metadata: Metadata = { title: "Planning" };

export default function AssetTrackerPlanningPage() {
  return <PlanningRoute />;
}
