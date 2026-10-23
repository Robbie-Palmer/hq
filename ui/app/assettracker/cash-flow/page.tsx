import type { Metadata } from "next";
import { AssetTrackerCashFlow } from "@/app/_projects/personal-finance-app/routes/cash-flow";

export const metadata: Metadata = { title: "Cash flow" };

export default function AssetTrackerCashFlowPage() {
  return <AssetTrackerCashFlow />;
}
