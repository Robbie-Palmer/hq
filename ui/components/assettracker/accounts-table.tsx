"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ASSET_TYPE_LABELS,
  formatAccountCurrency,
  formatAnnualRate,
  formatTotalBalances,
  LIQUIDITY_TIER_LABELS,
  todayIsoDate,
} from "@/lib/assettracker";
import {
  type AccountDetailView,
  type AssetType,
  accountLiquidity,
  type BalanceSnapshotView,
  isLiability,
} from "@/lib/domain/assettracker";
import { LogBalanceDrawer } from "./log-balance-drawer";

const STALE_AFTER_DAYS = 30;
const COLUMN_COUNT = 10;

const ASSET_TYPE_VARIANT: Record<
  AssetType,
  "default" | "secondary" | "outline" | "destructive"
> = {
  cash: "default",
  stocks: "secondary",
  bonds: "secondary",
  reits: "secondary",
  crypto: "outline",
  property: "secondary",
  mortgage: "destructive",
  debt: "destructive",
};

interface AccountsTableProps {
  accounts: AccountDetailView[];
  ownerLabels: Readonly<Record<string, string>>;
  initialShowClosed?: boolean;
}

export function AccountsTable({
  accounts,
  ownerLabels,
  initialShowClosed = false,
}: Readonly<AccountsTableProps>) {
  const [showClosed, setShowClosed] = useState(initialShowClosed);
  const openAccounts = accounts.filter((account) => account.isOpen);
  const closedAccounts = accounts.filter((account) => !account.isOpen);
  const visibleAccounts = showClosed ? accounts : openAccounts;
  const assets = visibleAccounts.filter((a) => !isLiability(a.assetType));
  const liabilities = visibleAccounts.filter((a) => isLiability(a.assetType));

  return (
    <div className="space-y-2">
      {closedAccounts.length > 0 && (
        <div className="flex items-center justify-end">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-expanded={showClosed}
            onClick={() => setShowClosed((shown) => !shown)}
          >
            {showClosed
              ? "Hide closed accounts"
              : `Show closed accounts (${closedAccounts.length})`}
          </Button>
        </div>
      )}
      <div className="overflow-hidden rounded-lg border">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left p-3 font-medium">Account</th>
                <th className="text-left p-3 font-medium">Provider</th>
                <th className="text-left p-3 font-medium">Owner</th>
                <th className="text-left p-3 font-medium">Type</th>
                <th className="text-left p-3 font-medium">Access</th>
                <th className="text-left p-3 font-medium">Trend</th>
                <th className="text-right p-3 font-medium">Balance</th>
                <th className="text-right p-3 font-medium">CAGR</th>
                <th className="text-right p-3 font-medium">Expected Return</th>
                <th className="text-left p-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              <AccountsSection
                label="Assets"
                accounts={assets}
                ownerLabels={ownerLabels}
              />
              <AccountsSection
                label="Liabilities"
                accounts={liabilities}
                ownerLabels={ownerLabels}
              />
            </tbody>
            <tfoot>
              <tr className="bg-muted/50">
                <td colSpan={6} className="p-3 font-semibold">
                  {showClosed ? "Open-account net worth" : "Net worth"}
                </td>
                <td className="p-3 text-right font-mono font-semibold">
                  {formatTotalBalances(openAccounts)}
                </td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}

function AccountsSection({
  label,
  accounts,
  ownerLabels,
}: Readonly<{
  label: string;
  accounts: AccountDetailView[];
  ownerLabels: Readonly<Record<string, string>>;
}>) {
  if (accounts.length === 0) return null;
  return (
    <>
      <tr className="border-b bg-muted/20">
        <td
          colSpan={COLUMN_COUNT}
          className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          {label}
        </td>
      </tr>
      {accounts.map((account) => (
        <AccountRow
          key={account.id}
          account={account}
          ownerLabel={ownerLabels[account.id] ?? "Unknown owner"}
        />
      ))}
      <tr className="border-b">
        <td colSpan={6} className="p-3 text-sm text-muted-foreground">
          {label} total
        </td>
        <td className="p-3 text-right font-mono text-muted-foreground">
          {formatTotalBalances(accounts)}
        </td>
        <td colSpan={3} />
      </tr>
    </>
  );
}

function AccountRow({
  account,
  ownerLabel,
}: Readonly<{
  account: AccountDetailView;
  ownerLabel: string;
}>) {
  return (
    <tr className="border-b hover:bg-muted/30">
      <td className="p-3 font-medium">
        <Link
          href={`/assettracker/accounts?account=${encodeURIComponent(account.id)}`}
          className="font-medium hover:underline"
        >
          {account.name}
        </Link>
        <StaleBalanceNudge account={account} />
      </td>
      <td className="p-3 text-muted-foreground">{account.provider}</td>
      <td className="whitespace-nowrap p-3 text-muted-foreground">
        {ownerLabel}
      </td>
      <td className="p-3">
        <Badge variant={ASSET_TYPE_VARIANT[account.assetType]}>
          {ASSET_TYPE_LABELS[account.assetType]}
        </Badge>
      </td>
      <td className="p-3 text-muted-foreground">
        {isLiability(account.assetType)
          ? "—"
          : LIQUIDITY_TIER_LABELS[accountLiquidity(account)]}
      </td>
      <td className="p-3">
        <Sparkline snapshots={account.snapshots} />
      </td>
      <td className="p-3 text-right font-mono">
        {account.latestBalance != null
          ? formatAccountCurrency(account.latestBalance, account.currency)
          : "-"}
      </td>
      <td className="p-3 text-right font-mono">
        {account.cagr != null ? formatAnnualRate(account.cagr) : "—"}
      </td>
      <td className="p-3 text-right font-mono">
        {(account.expectedAnnualReturn * 100).toFixed(1)}%
      </td>
      <td className="p-3">
        <Badge variant={account.isOpen ? "default" : "secondary"}>
          {account.isOpen ? "Open" : "Closed"}
        </Badge>
      </td>
    </tr>
  );
}

/**
 * The retention loop for a manual-entry tracker: surface how stale each
 * balance is and make the fix one tap away (a prefilled log-balance drawer).
 */
function StaleBalanceNudge({
  account,
}: Readonly<{ account: AccountDetailView }>) {
  if (!account.isOpen) return null;
  let message: string | null = null;
  if (account.latestSnapshotDate == null) {
    message = "No balance yet — log one";
  } else {
    const days = Math.floor(
      (Date.parse(todayIsoDate()) - Date.parse(account.latestSnapshotDate)) /
        86_400_000,
    );
    if (days >= STALE_AFTER_DAYS) {
      message = `Updated ${days}d ago — log now`;
    }
  }
  if (message == null) return null;
  return (
    <LogBalanceDrawer
      accountId={account.id}
      trigger={
        <button
          type="button"
          className="mt-0.5 block text-left text-xs font-normal text-amber-600 hover:underline dark:text-amber-500"
        >
          {message}
        </button>
      }
    />
  );
}

const SPARK_WIDTH = 72;
const SPARK_HEIGHT = 22;

function Sparkline({
  snapshots,
}: Readonly<{ snapshots: BalanceSnapshotView[] }>) {
  if (snapshots.length < 2) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const values = snapshots.map((s) => s.balance);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = max - min || 1;
  const step = SPARK_WIDTH / (values.length - 1);
  const points = values
    .map((value, i) => {
      const x = i * step;
      const y =
        SPARK_HEIGHT - 2 - ((value - min) / spread) * (SPARK_HEIGHT - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      width={SPARK_WIDTH}
      height={SPARK_HEIGHT}
      viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`}
      className="text-muted-foreground"
      aria-hidden="true"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
