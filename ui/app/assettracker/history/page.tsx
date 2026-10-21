import type { Metadata } from "next";
import { AssetTrackerHistory } from "@/features/personal-finance-app/routes/history";

export const metadata: Metadata = { title: "History" };

export default function AssetTrackerHistoryPage() {
  return <AssetTrackerHistory />;
}
