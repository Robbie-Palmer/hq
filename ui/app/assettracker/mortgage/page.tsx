import type { Metadata } from "next";
import { AssetTrackerMortgage } from "@/app/_projects/personal-finance-app/routes/mortgage";

export const metadata: Metadata = { title: "Mortgage planning" };

export default function AssetTrackerMortgagePage() {
  return <AssetTrackerMortgage />;
}
