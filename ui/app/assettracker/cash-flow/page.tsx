import type { Metadata } from "next";
import { CashFlowRoute } from "@/components/assettracker/cash-flow-route";

export const metadata: Metadata = { title: "Cash flow" };

export default function AssetTrackerCashFlowPage() {
  return <CashFlowRoute />;
}
