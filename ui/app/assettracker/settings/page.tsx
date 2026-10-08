import type { Metadata } from "next";
import { SettingsRoute } from "@/components/assettracker/settings-route";

export const metadata: Metadata = { title: "Settings" };

export default function AssetTrackerSettingsPage() {
  return <SettingsRoute />;
}
