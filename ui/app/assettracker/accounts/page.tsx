import type { Metadata } from "next";
import { Suspense } from "react";
import { AccountsRoute } from "@/components/assettracker/accounts-route";

export const metadata: Metadata = { title: "Accounts" };

export default function AssetTrackerAccountsPage() {
  return (
    <Suspense fallback={<AccountsRouteFallback />}>
      <AccountsRoute />
    </Suspense>
  );
}

function AccountsRouteFallback() {
  return (
    <div className="space-y-2">
      <h1 className="text-3xl font-bold sm:text-4xl">Accounts</h1>
      <p className="text-lg text-muted-foreground">Loading accounts...</p>
    </div>
  );
}
