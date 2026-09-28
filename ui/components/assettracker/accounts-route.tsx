"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { AccountDetailSheet } from "./account-detail-sheet";
import { AccountHistoryImportDrawer } from "./account-history-import-drawer";
import { AccountsTable } from "./accounts-table";
import { AddAccountDrawer } from "./add-account-drawer";
import { useAssetTracker } from "./asset-tracker-provider";
import { LogBalanceDrawer } from "./log-balance-drawer";
import { RecordTransferDrawer } from "./record-transfer-drawer";

const ACCOUNTS_PATH = "/assettracker/accounts";

export function AccountsRoute() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { accountDetails } = useAssetTracker();
  const requestedAccountId = searchParams.get("account");
  const selectedAccount =
    accountDetails.find((account) => account.id === requestedAccountId) ?? null;
  const requestedUnknownAccount =
    requestedAccountId !== null && selectedAccount === null;

  function closeAccountDetail() {
    router.replace(ACCOUNTS_PATH, { scroll: false });
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-4xl font-bold mb-2">Accounts</h1>
          <p className="text-lg text-muted-foreground">
            Review assets and liabilities, record balances, and maintain each
            account's history and expected flows.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <AccountHistoryImportDrawer />
          <LogBalanceDrawer />
          <RecordTransferDrawer />
          <AddAccountDrawer />
        </div>
      </div>

      {requestedUnknownAccount && (
        <div
          role="alert"
          className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-sm"
        >
          <p className="font-medium">Account not found</p>
          <p className="mt-1 text-muted-foreground">
            The account in this URL is not available in the current browser.
          </p>
          <button
            type="button"
            className="mt-2 font-medium underline underline-offset-4"
            onClick={closeAccountDetail}
          >
            Show all accounts
          </button>
        </div>
      )}

      {accountDetails.length === 0 ? (
        <div className="rounded-lg border border-dashed px-6 py-12 text-center">
          <h2 className="text-lg font-semibold">No accounts yet</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Add an account to start recording balances and money movement.
          </p>
          <div className="mt-4 flex justify-center">
            <AddAccountDrawer />
          </div>
        </div>
      ) : (
        <AccountsTable
          accounts={accountDetails}
          initialShowClosed={selectedAccount?.isOpen === false}
        />
      )}

      <AccountDetailSheet
        accountId={selectedAccount?.id ?? null}
        onClose={closeAccountDetail}
      />
    </div>
  );
}
