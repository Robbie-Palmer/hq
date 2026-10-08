"use client";

import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatAnnualRate, todayIsoDate } from "@/lib/assettracker";
import {
  type AccountDetailView,
  formatAssetTrackerError,
} from "@/lib/domain/assettracker";
import { useAssetTracker } from "./asset-tracker-provider";

interface ExpectedReturnEditorProps {
  account: AccountDetailView;
}

export function ExpectedReturnEditor({
  account,
}: Readonly<ExpectedReturnEditorProps>) {
  const { setExpectedReturn } = useAssetTracker();
  const [ratePercent, setRatePercent] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(todayIsoDate());
  const [error, setError] = useState<string | null>(null);

  const changes = account.expectedReturnChanges ?? [];

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      await setExpectedReturn({
        accountId: account.id,
        rate: Number(ratePercent) / 100,
        effectiveFrom,
      });
      setRatePercent("");
      setEffectiveFrom(todayIsoDate());
    } catch (err) {
      setError(formatAssetTrackerError(err));
    }
  }

  return (
    <div>
      <h3 className="mb-2 text-sm font-medium">Expected return changes</h3>
      <p className="mb-2 text-xs text-muted-foreground">
        Rates change — record a new expected return from a given date and
        projections will use it from then on.
      </p>
      {changes.length > 0 && (
        <ul className="mb-2 divide-y rounded-lg border">
          <li className="flex justify-between px-3 py-2 text-sm">
            <span className="text-muted-foreground">
              From {account.createdAt}
            </span>
            <span className="font-mono">
              {formatAnnualRate(account.expectedAnnualReturn)}
            </span>
          </li>
          {changes.map((change) => (
            <li
              key={change.date}
              className="flex justify-between px-3 py-2 text-sm"
            >
              <span className="text-muted-foreground">From {change.date}</span>
              <span className="font-mono">{formatAnnualRate(change.rate)}</span>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={`return-rate-${account.id}`}
            className="text-xs font-medium"
          >
            New rate (%)
          </label>
          <Input
            id={`return-rate-${account.id}`}
            type="number"
            inputMode="decimal"
            step="0.1"
            min="-99"
            required
            placeholder="e.g. 4.5"
            className="w-28"
            value={ratePercent}
            onChange={(e) => setRatePercent(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={`return-from-${account.id}`}
            className="text-xs font-medium"
          >
            Effective from
          </label>
          <Input
            id={`return-from-${account.id}`}
            type="date"
            required
            className="w-40"
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
          />
        </div>
        <Button type="submit" variant="outline" size="sm">
          Set rate
        </Button>
      </form>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  );
}
