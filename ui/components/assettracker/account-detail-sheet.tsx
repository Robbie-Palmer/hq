"use client";

import { Trash2Icon } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  type AccountDetailView,
  accountLiquidity,
  type CapitalFlowKind,
  capitalFlowKind,
  computeEquitySummary,
  type EquitySummary,
  effectiveExpectedReturn,
  formatAccountCurrency,
  formatAnnualRate,
  formatAssetTrackerError,
  isLiability,
  LIQUIDITY_TIER_LABELS,
  realRate,
  todayIsoDate,
  transferAmountFrom,
  transferAmountTo,
} from "@/lib/domain/assettracker";
import { AccountFlows } from "./account-flows";
import { AccountHistoryImportDrawer } from "./account-history-import-drawer";
import { AccountLiquidityEditor } from "./account-liquidity-editor";
import { AccountProjection } from "./account-projection";
import { AccountTrajectoryChart } from "./account-trajectory-chart";
import { useAssetTracker } from "./asset-tracker-provider";
import { ClearAccountHistoryButton } from "./clear-account-history-button";
import { CloseAccountControls } from "./close-account-controls";
import { EquityProjection } from "./equity-projection";
import { ExpectedReturnEditor } from "./expected-return-editor";
import { LogBalanceDrawer } from "./log-balance-drawer";
import { RecordTransferDrawer } from "./record-transfer-drawer";

interface AccountDetailSheetProps {
  accountId: string | null;
  onClose(): void;
}

const CAPITAL_FLOW_LABELS: Record<CapitalFlowKind, string> = {
  personalSaving: "From entered income",
  debtPrincipal: "Debt principal",
  external: "Outside entered income",
};

export function AccountDetailSheet({
  accountId,
  onClose,
}: Readonly<AccountDetailSheetProps>) {
  const {
    accounts,
    accountDetails,
    recurringFlows,
    inflation,
    transfers,
    netWorthData,
  } = useAssetTracker();

  const account =
    accountDetails.find((detail) => detail.id === accountId) ?? null;
  const linkedMortgages = account
    ? accountDetails.filter((d) => d.linkedAccountId === account.id && d.isOpen)
    : [];
  const equity = account ? computeEquitySummary(account, accountDetails) : null;
  const liabilityBalances = Object.fromEntries(
    accountDetails.map((d) => [d.id, d.latestBalance ?? 0]),
  );
  const hasOtherOpenAccounts = account
    ? accounts.some((a) => a.isOpen && a.id !== account.id)
    : false;

  function handleOpenChange(open: boolean) {
    if (!open) onClose();
  }

  return (
    <Sheet open={account !== null} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        {account && (
          <>
            <AccountSheetHeader account={account} />
            <div className="flex flex-col gap-6 px-4 pb-8">
              <StatsCards account={account} inflation={inflation} />
              {account.netContributed != null && (
                <CapitalPerformanceCard account={account} />
              )}
              <AccountTrajectoryChart
                account={account}
                transfers={transfers}
                netWorthData={netWorthData}
              />
              {equity && <EquityCard account={account} equity={equity} />}
              {account.isOpen && (
                <AccountProjection
                  account={account}
                  flows={recurringFlows}
                  liabilityBalances={liabilityBalances}
                  inflation={inflation}
                />
              )}
              {account.assetType === "property" &&
                linkedMortgages.length > 0 && (
                  <EquityProjection
                    property={account}
                    mortgages={linkedMortgages}
                    flows={recurringFlows}
                    liabilityBalances={liabilityBalances}
                    inflation={inflation}
                  />
                )}
              <AccountFlows account={account} />
              {!isLiability(account.assetType) && (
                <AccountLiquidityEditor account={account} />
              )}
              <ExpectedReturnEditor account={account} />
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-medium">Recorded history</h3>
                <AccountHistoryImportDrawer account={account} />
              </div>
              <BalanceHistory account={account} />
              <CapitalFlowHistory account={account} />
              <TransfersList account={account} />
              {account.isOpen && (
                <div className="flex flex-col gap-3 border-t pt-4">
                  <div className="flex flex-wrap gap-2">
                    <LogBalanceDrawer accountId={account.id} />
                    {hasOtherOpenAccounts && (
                      <RecordTransferDrawer fromAccountId={account.id} />
                    )}
                  </div>
                  {/* key resets the pending confirmation when the account changes */}
                  <CloseAccountControls key={account.id} account={account} />
                </div>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function CapitalPerformanceCard({
  account,
}: Readonly<{ account: AccountDetailView }>) {
  if (account.netContributed == null || account.gainLoss == null) return null;
  let gainClass = "";
  if (account.gainLoss > 0) {
    gainClass = "text-emerald-600 dark:text-emerald-400";
  } else if (account.gainLoss < 0) {
    gainClass = "text-destructive";
  }
  return (
    <div className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/30 p-3">
      <div>
        <p className="text-xs text-muted-foreground">Contributed capital</p>
        <p className="mt-1 font-semibold">
          {formatAccountCurrency(account.netContributed, account.currency)}
        </p>
      </div>
      <div>
        <p className="text-xs text-muted-foreground">Gain / loss</p>
        <p className={`mt-1 font-semibold ${gainClass}`}>
          {formatAccountCurrency(account.gainLoss, account.currency)}
        </p>
      </div>
    </div>
  );
}

function AccountSheetHeader({
  account,
}: Readonly<{ account: AccountDetailView }>) {
  const closedSuffix = account.closedAt ? ` · closed ${account.closedAt}` : "";
  return (
    <SheetHeader>
      <SheetTitle>{account.name}</SheetTitle>
      <SheetDescription>
        {account.provider} · opened {account.createdAt}
        {closedSuffix}
      </SheetDescription>
      <div className="flex gap-2">
        <Badge variant="secondary">{account.assetType}</Badge>
        {!isLiability(account.assetType) && (
          <Badge variant="outline">
            {LIQUIDITY_TIER_LABELS[accountLiquidity(account)]}
          </Badge>
        )}
        <Badge variant={account.isOpen ? "default" : "secondary"}>
          {account.isOpen ? "Open" : "Closed"}
        </Badge>
      </div>
    </SheetHeader>
  );
}

function StatsCards({
  account,
  inflation,
}: Readonly<{
  account: AccountDetailView;
  inflation: number;
}>) {
  const liability = isLiability(account.assetType);
  const currentRate = effectiveExpectedReturn(account, todayIsoDate());
  const balanceText =
    account.latestBalance != null
      ? formatAccountCurrency(account.latestBalance, account.currency)
      : "—";
  const cagrText = account.cagr != null ? formatAnnualRate(account.cagr) : "—";
  const gridClass = liability
    ? "grid grid-cols-2 gap-3"
    : "grid grid-cols-3 gap-3";

  return (
    <div className={gridClass}>
      <div className="rounded-lg border p-3">
        <p className="text-xs text-muted-foreground">
          {liability ? "Balance" : "Market value"}
        </p>
        <p className="mt-1 font-semibold">{balanceText}</p>
      </div>
      {/* CAGR is meaningless for a debt being paid down, so omit it */}
      {!liability && (
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">CAGR</p>
          <p className="mt-1 font-semibold">{cagrText}</p>
          <p className="text-xs text-muted-foreground">excl. contributions</p>
        </div>
      )}
      <div className="rounded-lg border p-3">
        <p className="text-xs text-muted-foreground">
          {liability ? "Interest rate" : "Expected now"}
        </p>
        <p className="mt-1 font-semibold">{formatAnnualRate(currentRate)}</p>
        <p className="text-xs text-muted-foreground">
          {formatAnnualRate(realRate(currentRate, inflation))} real
        </p>
      </div>
    </div>
  );
}

function EquityCard({
  account,
  equity,
}: Readonly<{
  account: AccountDetailView;
  equity: EquitySummary;
}>) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <p className="text-xs text-muted-foreground">
        Equity in {equity.propertyName}
      </p>
      <p className="mt-1 font-semibold">
        {formatAccountCurrency(equity.value, account.currency)}
      </p>
    </div>
  );
}

function BalanceHistory({ account }: Readonly<{ account: AccountDetailView }>) {
  const { deleteSnapshot } = useAssetTracker();
  const [error, setError] = useState<string | null>(null);
  const [deletingDate, setDeletingDate] = useState<string | null>(null);

  async function handleDelete(date: string) {
    if (deletingDate != null) return;
    setDeletingDate(date);
    try {
      await deleteSnapshot({ accountId: account.id, date });
      setError(null);
    } catch (err) {
      setError(formatAssetTrackerError(err));
    } finally {
      setDeletingDate(null);
    }
  }

  return (
    <div>
      <div className="mb-2 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-sm font-medium">Market value history</h3>
        {account.snapshots.length > 0 && (
          <ClearAccountHistoryButton
            accountId={account.id}
            kind="balances"
            count={account.snapshots.length}
          />
        )}
      </div>
      {account.snapshots.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No balances recorded yet.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {[...account.snapshots].reverse().map((snapshot) => (
            <li
              key={snapshot.date}
              className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
            >
              <span className="text-muted-foreground">{snapshot.date}</span>
              <span className="ml-auto font-mono">
                {formatAccountCurrency(snapshot.balance, account.currency)}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Delete balance from ${snapshot.date}`}
                onClick={() => handleDelete(snapshot.date)}
                disabled={deletingDate != null}
              >
                <Trash2Icon />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  );
}

function CapitalFlowHistory({
  account,
}: Readonly<{ account: AccountDetailView }>) {
  const { deleteCapitalFlow } = useAssetTracker();
  const [error, setError] = useState<string | null>(null);
  const [deletingFlowKey, setDeletingFlowKey] = useState<string | null>(null);

  async function handleDelete(date: string, kind?: CapitalFlowKind) {
    if (deletingFlowKey != null) return;
    setDeletingFlowKey(`${date}-${kind ?? "personalSaving"}`);
    try {
      await deleteCapitalFlow({ accountId: account.id, date, kind });
      setError(null);
    } catch (err) {
      setError(formatAssetTrackerError(err));
    } finally {
      setDeletingFlowKey(null);
    }
  }

  return (
    <div>
      <div className="mb-2 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-sm font-medium">Contributed capital history</h3>
        {account.capitalFlows.length > 0 && (
          <ClearAccountHistoryButton
            accountId={account.id}
            kind="capitalFlows"
            count={account.capitalFlows.length}
          />
        )}
      </div>
      {account.capitalFlows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No contributed capital recorded yet.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {[...account.capitalFlows].reverse().map((flow) => (
            <li
              key={`${flow.date}-${capitalFlowKind(flow)}`}
              className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
            >
              <span className="text-muted-foreground">{flow.date}</span>
              <Badge variant="outline" className="font-normal">
                {CAPITAL_FLOW_LABELS[capitalFlowKind(flow)]}
              </Badge>
              <span className="ml-auto font-mono">
                {flow.amount > 0 ? "+" : ""}
                {formatAccountCurrency(flow.amount, account.currency)}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Delete ${CAPITAL_FLOW_LABELS[capitalFlowKind(flow)].toLowerCase()} capital from ${flow.date}`}
                onClick={() => handleDelete(flow.date, flow.kind)}
                disabled={deletingFlowKey != null}
              >
                <Trash2Icon />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  );
}

function TransfersList({ account }: Readonly<{ account: AccountDetailView }>) {
  const { accounts, transfers } = useAssetTracker();
  const accountTransfers = transfers.filter(
    (t) => t.fromAccountId === account.id || t.toAccountId === account.id,
  );
  if (accountTransfers.length === 0) return null;

  function counterpartyName(id: string | undefined): string {
    if (id == null) return "External";
    return accounts.find((a) => a.id === id)?.name ?? id;
  }

  return (
    <div>
      <h3 className="mb-2 text-sm font-medium">Transfers</h3>
      <ul className="divide-y rounded-lg border">
        {[...accountTransfers].reverse().map((transfer) => {
          const into = transfer.toAccountId === account.id;
          const counterparty = counterpartyName(
            into ? transfer.fromAccountId : transfer.toAccountId,
          );
          return (
            <li
              key={transfer.id}
              className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
            >
              <span className="text-muted-foreground">
                {transfer.date} · {into ? "from" : "to"} {counterparty}
              </span>
              <span className="font-mono">
                {into ? "+" : "−"}
                {formatAccountCurrency(
                  into
                    ? transferAmountTo(transfer)
                    : transferAmountFrom(transfer),
                  account.currency,
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
