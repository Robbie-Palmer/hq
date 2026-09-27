"use client";

import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LIQUIDITY_TIER_LABELS } from "@/lib/assettracker";
import {
  type AccountDetailView,
  accountLiquidity,
  formatAssetTrackerError,
  type LiquidityTier,
} from "@/lib/domain/assettracker";
import { useAssetTracker } from "./asset-tracker-provider";

const OPTIONS = Object.entries(LIQUIDITY_TIER_LABELS) as [
  LiquidityTier,
  string,
][];

export function AccountLiquidityEditor({
  account,
}: Readonly<{ account: AccountDetailView }>) {
  const { setAccountLiquidity } = useAssetTracker();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const liquidity = accountLiquidity(account);

  async function handleChange(value: string) {
    setSaving(true);
    try {
      await setAccountLiquidity({
        accountId: account.id,
        liquidity: value as LiquidityTier,
      });
      setError(null);
    } catch (err) {
      setError(formatAssetTrackerError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      <div>
        <h3 className="text-sm font-medium">Access to funds</h3>
        <p className="text-xs text-muted-foreground">
          Controls whether this balance counts towards cash or liquid runway.
        </p>
      </div>
      <Select value={liquidity} onValueChange={handleChange} disabled={saving}>
        <SelectTrigger
          aria-label={`Access to funds for ${account.name}`}
          className="w-full"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {OPTIONS.map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
