"use client";

import { type ComponentProps, type SubmitEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { todayIsoDate } from "@/lib/assettracker";
import {
  type AccountDetailView,
  effectiveExpectedReturn,
  formatAssetTrackerError,
} from "@/lib/domain/assettracker";
import { useAssetTracker } from "./asset-tracker-provider";

function useMortgageTermDraft(account: AccountDetailView) {
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

  async function submit(event: SubmitEvent<HTMLFormElement>) {
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

  return {
    error,
    firstPaymentDate,
    interestRatePercent,
    remainingTermYears,
    saved,
    saving,
    setFirstPaymentDate,
    setInterestRatePercent,
    setRemainingTermYears,
    submit,
  };
}

function MortgageTermInput({
  id,
  label,
  onChange,
  placeholder,
  value,
  ...numberProps
}: Readonly<{
  id: string;
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  value: string;
}> &
  Pick<
    ComponentProps<typeof Input>,
    "inputMode" | "max" | "min" | "step" | "type"
  >) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium" htmlFor={id}>
        {label}
      </label>
      <Input
        id={id}
        required
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        {...numberProps}
      />
    </div>
  );
}

function MortgageTermsIntro() {
  return (
    <div>
      <h3 className="text-sm font-medium">Mortgage modelling</h3>
      <p className="text-xs text-muted-foreground">
        The calculator needs the current interest rate, next payment date, and
        remaining term. It uses the latest recorded balance.
      </p>
    </div>
  );
}

export function MortgageTermsEditor({
  account,
}: Readonly<{ account: AccountDetailView }>) {
  const draft = useMortgageTermDraft(account);

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <MortgageTermsIntro />
      <form
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
        onSubmit={draft.submit}
      >
        <MortgageTermInput
          id={`mortgage-interest-rate-${account.id}`}
          label="Current interest rate (%)"
          type="number"
          inputMode="decimal"
          min="0.01"
          max="100"
          step="0.01"
          placeholder="e.g. 4.25"
          value={draft.interestRatePercent}
          onChange={draft.setInterestRatePercent}
        />
        <MortgageTermInput
          id={`mortgage-next-payment-${account.id}`}
          label="Next payment date"
          type="date"
          value={draft.firstPaymentDate}
          onChange={draft.setFirstPaymentDate}
        />
        <MortgageTermInput
          id={`mortgage-remaining-term-${account.id}`}
          label="Remaining term in years"
          type="number"
          inputMode="decimal"
          min="0.1"
          step="0.1"
          placeholder="e.g. 18.5"
          value={draft.remainingTermYears}
          onChange={draft.setRemainingTermYears}
        />
        <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-3">
          <Button type="submit" size="sm" disabled={draft.saving}>
            Save mortgage terms
          </Button>
          {draft.saved && (
            <p className="text-xs text-muted-foreground">Terms saved.</p>
          )}
        </div>
      </form>
      {draft.error != null && (
        <p className="text-sm text-destructive">{draft.error}</p>
      )}
    </section>
  );
}
