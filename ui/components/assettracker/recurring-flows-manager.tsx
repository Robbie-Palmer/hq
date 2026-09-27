"use client";

import { useEffect, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AccountFlows } from "./account-flows";
import { useAssetTracker } from "./asset-tracker-provider";

export function RecurringFlowsManager() {
  const { accountDetails } = useAssetTracker();
  const openAccounts = accountDetails.filter((account) => account.isOpen);
  const [accountId, setAccountId] = useState(openAccounts[0]?.id ?? "");
  const selectedAccount =
    openAccounts.find((account) => account.id === accountId) ??
    openAccounts[0] ??
    null;
  const openAccountIds = openAccounts.map((account) => account.id).join(",");

  useEffect(() => {
    if (selectedAccount !== null && selectedAccount.id !== accountId) {
      setAccountId(selectedAccount.id);
    }
  }, [accountId, selectedAccount]);

  if (selectedAccount === null) {
    return (
      <section className="rounded-lg border p-4">
        <h2 className="font-semibold">Recurring flows</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Add an open account before creating an expected flow.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-4 rounded-lg border p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="font-semibold">Recurring flows</h2>
          <p className="text-sm text-muted-foreground">
            Choose an account to manage the expected money entering and leaving
            it.
          </p>
        </div>
        <div className="w-full sm:w-64">
          <label
            htmlFor="recurring-flow-account"
            className="text-sm font-medium"
          >
            Account
          </label>
          <Select
            key={openAccountIds}
            value={selectedAccount.id}
            onValueChange={setAccountId}
          >
            <SelectTrigger id="recurring-flow-account" className="mt-1 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {openAccounts.map((account) => (
                <SelectItem key={account.id} value={account.id}>
                  {account.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <AccountFlows account={selectedAccount} />
    </section>
  );
}
