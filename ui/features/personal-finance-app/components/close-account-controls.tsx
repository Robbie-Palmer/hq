"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type AccountDetailView,
  formatAssetTrackerError,
} from "@/features/personal-finance-app/domain";
import { useAssetTracker } from "./asset-tracker-provider";

const KEEP_BALANCE = "keep";

interface CloseAccountControlsProps {
  account: AccountDetailView;
}

/**
 * Two-step close flow with an optional move of the remaining balance.
 * Render with key={account.id} so the pending confirmation resets when the
 * displayed account changes.
 */
export function CloseAccountControls({
  account,
}: Readonly<CloseAccountControlsProps>) {
  const { accounts, closeAccount } = useAssetTracker();
  const [confirming, setConfirming] = useState(false);
  const [transferTargetId, setTransferTargetId] = useState(KEEP_BALANCE);
  const [error, setError] = useState<string | null>(null);

  const otherOpenAccounts = accounts.filter(
    (a) => a.isOpen && a.id !== account.id,
  );
  const hasPositiveBalance =
    account.latestBalance != null && account.latestBalance > 0;

  async function handleClose() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    try {
      await closeAccount(
        account.id,
        transferTargetId === KEEP_BALANCE ? undefined : transferTargetId,
      );
      setConfirming(false);
      setError(null);
    } catch (err) {
      setError(formatAssetTrackerError(err));
    }
  }

  let closeLabel = "Close account";
  if (confirming && transferTargetId === KEEP_BALANCE) {
    closeLabel = "Confirm close (records a zero balance today)";
  } else if (confirming) {
    closeLabel = "Confirm close & move balance";
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {hasPositiveBalance && otherOpenAccounts.length > 0 && (
          <Select value={transferTargetId} onValueChange={setTransferTargetId}>
            <SelectTrigger
              aria-label="Transfer remaining balance to"
              className="w-full sm:w-auto"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={KEEP_BALANCE}>
                Don't transfer balance
              </SelectItem>
              {otherOpenAccounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  Move balance to {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Button
          variant={confirming ? "destructive" : "outline"}
          onClick={handleClose}
        >
          {closeLabel}
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
