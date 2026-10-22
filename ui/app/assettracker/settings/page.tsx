import type { Metadata } from "next";
import { AssetTrackerSettings } from "@/app/_projects/personal-finance-app/routes/settings";

export const metadata: Metadata = { title: "Settings" };

export default function AssetTrackerSettingsPage() {
  return <AssetTrackerSettings />;
}
