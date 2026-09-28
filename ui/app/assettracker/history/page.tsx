import type { Metadata } from "next";
import { HistoryRoute } from "@/components/assettracker/history-route";

export const metadata: Metadata = { title: "History" };

export default function AssetTrackerHistoryPage() {
  return <HistoryRoute />;
}
