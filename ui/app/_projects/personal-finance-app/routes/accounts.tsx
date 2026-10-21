import { Suspense } from "react";
import { AccountsRoute } from "../components/accounts-route";

export function AssetTrackerAccounts() {
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
