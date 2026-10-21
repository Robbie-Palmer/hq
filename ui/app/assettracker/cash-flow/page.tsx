import type { Metadata } from "next";
import { AssetTrackerCashFlow } from "@/features/personal-finance-app/routes/cash-flow";

export const metadata: Metadata = { title: "Cash flow" };

export default function AssetTrackerCashFlowPage() {
  return <AssetTrackerCashFlow />;
}
