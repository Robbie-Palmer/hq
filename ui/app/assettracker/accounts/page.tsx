import type { Metadata } from "next";
import { AssetTrackerAccounts } from "@/app/_projects/personal-finance-app/routes/accounts";

export const metadata: Metadata = { title: "Accounts" };

export default function AssetTrackerAccountsPage() {
  return <AssetTrackerAccounts />;
}
