"use client";

import { Trash2Icon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  type AccountHistoryKind,
  type AccountId,
  formatAssetTrackerError,
} from "@/features/personal-finance-app/domain";
import { useAssetTracker } from "./asset-tracker-provider";

const HISTORY_LABELS: Record<AccountHistoryKind, string> = {
  balances: "balance",
  capitalFlows: "deposit/withdrawal",
};

export function ClearAccountHistoryButton({
  accountId,
  kind,
  count,
}: Readonly<{
  accountId: AccountId;
  kind: AccountHistoryKind;
  count: number;
}>) {
  const { clearAccountHistory } = useAssetTracker();
  const [confirming, setConfirming] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = HISTORY_LABELS[kind];

  async function handleClear() {
    if (!confirming) {
      setConfirming(true);
      setError(null);
      return;
    }
    setClearing(true);
    try {
      await clearAccountHistory({ accountId, kind });
      setConfirming(false);
      setError(null);
    } catch (err) {
      setError(formatAssetTrackerError(err));
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <div className="flex flex-wrap items-center gap-1">
        <Button
          type="button"
          variant={confirming ? "destructive" : "ghost"}
          size="sm"
          aria-label={
            confirming
              ? `Confirm clear ${count} ${label} records`
              : `Clear all ${label} history`
          }
          disabled={clearing}
          onClick={handleClear}
        >
          <Trash2Icon />
          {confirming ? `Clear ${count} records?` : "Clear all"}
        </Button>
        {confirming && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={clearing}
            onClick={() => setConfirming(false)}
          >
            Cancel
          </Button>
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
