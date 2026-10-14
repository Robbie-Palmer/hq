"use client";

import { type SubmitEvent, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCurrency, todayIsoDate } from "@/lib/assettracker";
import {
  annualOrdinarySpending,
  type Currency,
  equalSharedOwnership,
  formatAssetTrackerError,
  type Ownership,
  personalOwnership,
  type SpendingBaseline,
  SUPPORTED_CURRENCIES,
} from "@/lib/domain/assettracker";
import { useAssetTracker } from "./asset-tracker-provider";

const HOUSEHOLD_OWNER = "household";

function sourceLabel(baseline: SpendingBaseline): string {
  return baseline.source.kind === "manual" ? "Manual" : "Reconciled";
}

function numberValue(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : Number.NaN;
}

function amountForPeriod(annualAmount: number, period: "monthly" | "annual") {
  return period === "monthly" ? annualAmount / 12 : annualAmount;
}

function initialBaselineAmount(
  baseline: SpendingBaseline | undefined,
  field:
    | "annualEssentialSpending"
    | "annualDiscretionarySpending"
    | "annualDebtCashFlow",
): string {
  return baseline == null
    ? ""
    : String(amountForPeriod(baseline[field], "monthly"));
}

function baselineSaveLabel(
  saving: boolean,
  hasActiveBaseline: boolean,
): string {
  if (saving) return "Saving…";
  return hasActiveBaseline ? "Save new version" : "Save baseline";
}

function AnnualComparison({
  label,
  selected,
  reconciled,
  currency,
}: Readonly<{
  label: string;
  selected: number | null;
  reconciled: number | null;
  currency: Currency;
}>) {
  return (
    <div className="rounded-md bg-muted/40 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-medium">
        {selected == null
          ? "Unavailable"
          : `${formatCurrency(Math.round(selected), currency)}/yr`}
      </p>
      {reconciled != null && (
        <p className="mt-1 text-xs text-muted-foreground">
          History {formatCurrency(Math.round(reconciled), currency)}/yr
        </p>
      )}
    </div>
  );
}

function VersionHistory({
  baselines,
}: Readonly<{ baselines: SpendingBaseline[] }>) {
  if (baselines.length === 0) return null;
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-medium">Saved versions</h4>
      <ul className="divide-y rounded-md border px-3">
        {baselines.map((baseline) => (
          <li
            key={baseline.id}
            className="flex flex-wrap items-center gap-2 py-2 text-xs"
          >
            <span className="font-medium">v{baseline.version}</span>
            <Badge variant="outline">{sourceLabel(baseline)}</Badge>
            <span>{baseline.effectiveDate}</span>
            <span className="text-muted-foreground">
              {formatCurrency(
                Math.round(annualOrdinarySpending(baseline)),
                baseline.currency,
              )}
              /yr ordinary,{" "}
              {formatCurrency(
                Math.round(baseline.annualDebtCashFlow),
                baseline.currency,
              )}
              /yr debt
            </span>
            <Badge
              className="ml-auto"
              variant={baseline.status === "active" ? "secondary" : "outline"}
            >
              {baseline.status === "active" ? "Active" : "Superseded"}
            </Badge>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SpendingBaselineManager() {
  const {
    baseCurrency,
    financialIndependence,
    household,
    saveSpendingBaseline,
    spendingBaselines,
    valuationDate,
  } = useAssetTracker();
  const active = spendingBaselines.find(({ status }) => status === "active");
  const [period, setPeriod] = useState<"monthly" | "annual">("monthly");
  const [essential, setEssential] = useState(() =>
    initialBaselineAmount(active, "annualEssentialSpending"),
  );
  const [discretionary, setDiscretionary] = useState(() =>
    initialBaselineAmount(active, "annualDiscretionarySpending"),
  );
  const [debt, setDebt] = useState(() =>
    initialBaselineAmount(active, "annualDebtCashFlow"),
  );
  const [currency, setCurrency] = useState<Currency>(
    active?.currency ?? baseCurrency,
  );
  const [effectiveDate, setEffectiveDate] = useState(
    active?.effectiveDate ?? valuationDate ?? todayIsoDate(),
  );
  const [owner, setOwner] = useState(HOUSEHOLD_OWNER);
  const [sourceNotes, setSourceNotes] = useState(active?.sourceNotes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sortedBaselines = useMemo(
    () =>
      spendingBaselines.toSorted((left, right) => right.version - left.version),
    [spendingBaselines],
  );
  const {
    reconciledAnnualExpenditure,
    reconciledAnnualCurrentExpenditure,
    spendingBasis,
  } = financialIndependence;

  if (household.activeScope.kind === "member") {
    return (
      <section className="rounded-lg border p-4 sm:p-6">
        <h3 className="font-semibold">Spending baseline</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Switch the account scope to Household to review or replace the
          versioned spending baseline.
        </p>
      </section>
    );
  }

  function ownership(): Ownership {
    return owner === HOUSEHOLD_OWNER
      ? equalSharedOwnership(household.members)
      : personalOwnership(owner);
  }

  function changePeriod(next: "monthly" | "annual") {
    if (next === period) return;
    const multiplier = next === "annual" ? 12 : 1 / 12;
    const convert = (value: string) =>
      value.trim() === "" ? "" : String(Number(value) * multiplier);
    setEssential(convert(essential));
    setDiscretionary(convert(discretionary));
    setDebt(convert(debt));
    setPeriod(next);
  }

  async function handleSave(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = [essential, discretionary, debt].map(numberValue);
    if (values.some((value) => !Number.isFinite(value))) {
      setError("Enter zero or a positive amount for each spending category.");
      return;
    }
    const [essentialAmount = 0, discretionaryAmount = 0, debtAmount = 0] =
      values;
    const annualMultiplier = period === "monthly" ? 12 : 1;
    setSaving(true);
    setError(null);
    try {
      await saveSpendingBaseline({
        annualEssentialSpending: essentialAmount * annualMultiplier,
        annualDiscretionarySpending: discretionaryAmount * annualMultiplier,
        annualDebtCashFlow: debtAmount * annualMultiplier,
        currency,
        effectiveDate,
        ownership: ownership(),
        source: { kind: "manual" },
        sourceNotes: sourceNotes.trim() || undefined,
      });
    } catch (caught) {
      setError(formatAssetTrackerError(caught));
    } finally {
      setSaving(false);
    }
  }

  async function adoptReconciledHistory() {
    const first = financialIndependence.periods[0];
    const last = financialIndependence.periods.at(-1);
    if (
      first == null ||
      last == null ||
      reconciledAnnualExpenditure == null ||
      reconciledAnnualCurrentExpenditure == null
    ) {
      return;
    }
    const retainedEssential = Math.min(
      spendingBasis.annualEssentialSpending ?? 0,
      reconciledAnnualExpenditure,
    );
    setSaving(true);
    setError(null);
    try {
      await saveSpendingBaseline({
        annualEssentialSpending: retainedEssential,
        annualDiscretionarySpending:
          reconciledAnnualExpenditure - retainedEssential,
        annualDebtCashFlow: Math.max(
          reconciledAnnualCurrentExpenditure - reconciledAnnualExpenditure,
          0,
        ),
        currency: baseCurrency,
        effectiveDate: last.endDate,
        ownership: active?.ownership ?? ownership(),
        source: {
          kind: "reconciled",
          periodStartDate: first.startDate,
          periodEndDate: last.endDate,
        },
        sourceNotes: "Median of the latest usable balance-sheet periods",
      });
    } catch (caught) {
      setError(formatAssetTrackerError(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-4 rounded-lg border p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">Spending baseline</h3>
            <Badge
              variant={
                spendingBasis.kind === "manual" ? "secondary" : "outline"
              }
            >
              {spendingBasis.kind === "manual" ? "Manual" : "Reconciled"}
            </Badge>
            {spendingBasis.version != null && (
              <Badge variant="outline">v{spendingBasis.version}</Badge>
            )}
          </div>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Forecasts use this record until you save another version. Ordinary
            spending excludes debt principal. Transfers, commitments, and
            scenario changes stay separate.
          </p>
        </div>
        {spendingBasis.effectiveDate != null && (
          <p className="text-xs text-muted-foreground">
            Effective {spendingBasis.effectiveDate}
          </p>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <AnnualComparison
          label="Ordinary spending"
          selected={
            spendingBasis.annualEssentialSpending == null ||
            spendingBasis.annualDiscretionarySpending == null
              ? financialIndependence.representativeAnnualExpenditure
              : spendingBasis.annualEssentialSpending +
                spendingBasis.annualDiscretionarySpending
          }
          reconciled={reconciledAnnualExpenditure}
          currency={baseCurrency}
        />
        <AnnualComparison
          label="Debt cash flow"
          selected={spendingBasis.annualDebtCashFlow}
          reconciled={
            reconciledAnnualExpenditure == null ||
            reconciledAnnualCurrentExpenditure == null
              ? null
              : Math.max(
                  reconciledAnnualCurrentExpenditure -
                    reconciledAnnualExpenditure,
                  0,
                )
          }
          currency={baseCurrency}
        />
        <AnnualComparison
          label="Current cash requirement"
          selected={
            financialIndependence.representativeAnnualCurrentExpenditure
          }
          reconciled={reconciledAnnualCurrentExpenditure}
          currency={baseCurrency}
        />
      </div>

      {active != null && reconciledAnnualExpenditure != null && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-dashed p-3">
          <p className="min-w-0 flex-1 text-sm text-muted-foreground">
            Usable history is now available. Saving it creates a new version and
            keeps the previous baseline in version history.
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={() => void adoptReconciledHistory()}
          >
            Use reconciled history
          </Button>
        </div>
      )}

      <form className="space-y-4" onSubmit={handleSave}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1.5 text-xs font-medium">
            <label htmlFor="spending-baseline-period">Amount period</label>
            <Select value={period} onValueChange={changePeriod}>
              <SelectTrigger
                id="spending-baseline-period"
                aria-label="Spending amount period"
                className="w-full"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="monthly">Monthly</SelectItem>
                <SelectItem value="annual">Annual</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 text-xs font-medium">
            <label htmlFor="spending-baseline-currency">Currency</label>
            <Select
              value={currency}
              onValueChange={(value) => setCurrency(value as Currency)}
            >
              <SelectTrigger
                id="spending-baseline-currency"
                aria-label="Spending baseline currency"
                className="w-full"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUPPORTED_CURRENCIES.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label
            className="space-y-1.5 text-xs font-medium"
            htmlFor="spending-baseline-effective-date"
          >
            <span>Effective date</span>
            <Input
              id="spending-baseline-effective-date"
              aria-label="Spending baseline effective date"
              type="date"
              value={effectiveDate}
              onChange={(event) => setEffectiveDate(event.target.value)}
              required
            />
          </label>
          <label
            className="space-y-1.5 text-xs font-medium"
            htmlFor="spending-baseline-essential"
          >
            <span>Essential spending</span>
            <Input
              id="spending-baseline-essential"
              aria-label="Essential spending"
              type="number"
              min="0"
              step="any"
              value={essential}
              onChange={(event) => setEssential(event.target.value)}
              required
            />
          </label>
          <label
            className="space-y-1.5 text-xs font-medium"
            htmlFor="spending-baseline-discretionary"
          >
            <span>Discretionary spending</span>
            <Input
              id="spending-baseline-discretionary"
              aria-label="Discretionary spending"
              type="number"
              min="0"
              step="any"
              value={discretionary}
              onChange={(event) => setDiscretionary(event.target.value)}
              required
            />
          </label>
          <label
            className="space-y-1.5 text-xs font-medium"
            htmlFor="spending-baseline-debt"
          >
            <span>Debt cash flow</span>
            <Input
              id="spending-baseline-debt"
              aria-label="Debt cash flow"
              type="number"
              min="0"
              step="any"
              value={debt}
              onChange={(event) => setDebt(event.target.value)}
              required
            />
          </label>
          <div className="space-y-1.5 text-xs font-medium">
            <label htmlFor="spending-baseline-owner">Household ownership</label>
            <Select value={owner} onValueChange={setOwner}>
              <SelectTrigger
                id="spending-baseline-owner"
                aria-label="Spending baseline owner"
                className="w-full"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={HOUSEHOLD_OWNER}>Household</SelectItem>
                {household.members.map((member) => (
                  <SelectItem key={member.id} value={member.id}>
                    {member.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label
            className="space-y-1.5 text-xs font-medium sm:col-span-2"
            htmlFor="spending-baseline-source-notes"
          >
            <span>Source notes</span>
            <Input
              id="spending-baseline-source-notes"
              aria-label="Spending baseline source notes"
              value={sourceNotes}
              onChange={(event) => setSourceNotes(event.target.value)}
              placeholder="Budget, statement, estimate, or other source"
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={saving}>
            {baselineSaveLabel(saving, active != null)}
          </Button>
          <p className="text-xs text-muted-foreground">
            Put interest and fees in ordinary spending. Put principal and other
            debt repayment in debt cash flow.
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      </form>

      <VersionHistory baselines={sortedBaselines} />
    </section>
  );
}
