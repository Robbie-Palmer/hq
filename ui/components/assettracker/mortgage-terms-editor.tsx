"use client";

import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { todayIsoDate } from "@/lib/assettracker";
import {
  type AccountDetailView,
  effectiveExpectedReturn,
  formatAssetTrackerError,
} from "@/lib/domain/assettracker";
import { useAssetTracker } from "./asset-tracker-provider";

export function MortgageTermsEditor({
  account,
}: Readonly<{ account: AccountDetailView }>) {
  const { setMortgageTerms } = useAssetTracker();
  const today = todayIsoDate();
  const [firstPaymentDate, setFirstPaymentDate] = useState(
    account.mortgageTerms?.firstPaymentDate ?? today,
  );
  const [remainingTermYears, setRemainingTermYears] = useState(
    account.mortgageTerms == null
      ? ""
      : String(account.mortgageTerms.remainingTermMonths / 12),
  );
  const currentInterestRate = effectiveExpectedReturn(account, today);
  const [interestRatePercent, setInterestRatePercent] = useState(
    currentInterestRate > 0 ? String(currentInterestRate * 100) : "",
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await setMortgageTerms({
        accountId: account.id,
        firstPaymentDate,
        remainingTermMonths: Math.round(Number(remainingTermYears) * 12),
        annualInterestRate: Number(interestRatePercent) / 100,
        interestRateEffectiveFrom: today,
      });
      setSaved(true);
    } catch (cause) {
      setError(formatAssetTrackerError(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <div>
        <h3 className="text-sm font-medium">Mortgage modelling</h3>
        <p className="text-xs text-muted-foreground">
          The calculator needs the current interest rate, next payment date, and
          remaining term. It uses the latest recorded balance.
        </p>
      </div>
      <form
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
        onSubmit={submit}
      >
        <div className="space-y-1.5">
          <label
            className="text-xs font-medium"
            htmlFor={`mortgage-interest-rate-${account.id}`}
          >
            Current interest rate (%)
          </label>
          <Input
            id={`mortgage-interest-rate-${account.id}`}
            type="number"
            inputMode="decimal"
            min="0.01"
            max="100"
            step="0.01"
            required
            placeholder="e.g. 4.25"
            value={interestRatePercent}
            onChange={(event) => setInterestRatePercent(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <label
            className="text-xs font-medium"
            htmlFor={`mortgage-next-payment-${account.id}`}
          >
            Next payment date
          </label>
          <Input
            id={`mortgage-next-payment-${account.id}`}
            type="date"
            required
            value={firstPaymentDate}
            onChange={(event) => setFirstPaymentDate(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <label
            className="text-xs font-medium"
            htmlFor={`mortgage-remaining-term-${account.id}`}
          >
            Remaining term in years
          </label>
          <Input
            id={`mortgage-remaining-term-${account.id}`}
            type="number"
            inputMode="decimal"
            min="0.1"
            step="0.1"
            required
            placeholder="e.g. 18.5"
            value={remainingTermYears}
            onChange={(event) => setRemainingTermYears(event.target.value)}
          />
        </div>
        <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-3">
          <Button type="submit" size="sm" disabled={saving}>
            Save mortgage terms
          </Button>
          {saved && (
            <p className="text-xs text-muted-foreground">Terms saved.</p>
          )}
        </div>
      </form>
      {error != null && <p className="text-sm text-destructive">{error}</p>}
    </section>
  );
}
