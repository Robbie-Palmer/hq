import type { Metadata } from "next";
import { AssetTrackerHistory } from "@/app/_projects/personal-finance-app/routes/history";

export const metadata: Metadata = { title: "History" };

export default function AssetTrackerHistoryPage() {
  return <AssetTrackerHistory />;
}
