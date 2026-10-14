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

function initialBaselineAmount(
  baseline: SpendingBaseline | undefined,
  field:
    | "annualEssentialSpending"
    | "annualDiscretionarySpending"
    | "annualDebtCashFlow",
): string {
  if (baseline == null) return "";
  return String(baseline[field] / 12);
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

function useSpendingBaselineModel() {
  const tracker = useAssetTracker();
  const active = tracker.spendingBaselines.find(
    ({ status }) => status === "active",
  );
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
    active?.currency ?? tracker.baseCurrency,
  );
  const [effectiveDate, setEffectiveDate] = useState(
    active?.effectiveDate ?? tracker.valuationDate ?? todayIsoDate(),
  );
  const [owner, setOwner] = useState(HOUSEHOLD_OWNER);
  const [sourceNotes, setSourceNotes] = useState(active?.sourceNotes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const baselines = useMemo(
    () =>
      tracker.spendingBaselines.toSorted(
        (left, right) => right.version - left.version,
      ),
    [tracker.spendingBaselines],
  );
  const ownership = () =>
    owner === HOUSEHOLD_OWNER
      ? equalSharedOwnership(tracker.household.members)
      : personalOwnership(owner);

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

  async function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = [essential, discretionary, debt].map(numberValue);
    if (values.some((value) => !Number.isFinite(value))) {
      setError("Enter zero or a positive amount for each spending category.");
      return;
    }
    const [essentialAmount = 0, discretionaryAmount = 0, debtAmount = 0] =
      values;
    const multiplier = period === "monthly" ? 12 : 1;
    setSaving(true);
    setError(null);
    try {
      await tracker.saveSpendingBaseline({
        annualEssentialSpending: essentialAmount * multiplier,
        annualDiscretionarySpending: discretionaryAmount * multiplier,
        annualDebtCashFlow: debtAmount * multiplier,
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
    const { financialIndependence } = tracker;
    const first = financialIndependence.periods[0];
    const last = financialIndependence.periods.at(-1);
    const ordinary = financialIndependence.reconciledAnnualExpenditure;
    const current = financialIndependence.reconciledAnnualCurrentExpenditure;
    if (first == null || last == null || ordinary == null || current == null) {
      return;
    }
    const retainedEssential = Math.min(
      financialIndependence.spendingBasis.annualEssentialSpending ?? 0,
      ordinary,
    );
    setSaving(true);
    setError(null);
    try {
      await tracker.saveSpendingBaseline({
        annualEssentialSpending: retainedEssential,
        annualDiscretionarySpending: ordinary - retainedEssential,
        annualDebtCashFlow: Math.max(current - ordinary, 0),
        currency: tracker.baseCurrency,
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

  return {
    ...tracker,
    active,
    baselines,
    period,
    essential,
    discretionary,
    debt,
    currency,
    effectiveDate,
    owner,
    sourceNotes,
    saving,
    error,
    changePeriod,
    setEssential,
    setDiscretionary,
    setDebt,
    setCurrency,
    setEffectiveDate,
    setOwner,
    setSourceNotes,
    save,
    adoptReconciledHistory,
  };
}

type SpendingBaselineModel = ReturnType<typeof useSpendingBaselineModel>;

function MemberScopeMessage() {
  return (
    <section className="rounded-lg border p-4 sm:p-6">
      <h3 className="font-semibold">Spending baseline</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Switch the account scope to Household to review or replace the versioned
        spending baseline.
      </p>
    </section>
  );
}

function BaselineHeader({ model }: Readonly<{ model: SpendingBaselineModel }>) {
  const { spendingBasis } = model.financialIndependence;
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold">Spending baseline</h3>
          <Badge
            variant={spendingBasis.kind === "manual" ? "secondary" : "outline"}
          >
            {spendingBasis.kind === "manual" ? "Manual" : "Reconciled"}
          </Badge>
          {spendingBasis.version != null && (
            <Badge variant="outline">v{spendingBasis.version}</Badge>
          )}
        </div>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Forecasts use this record until you save another version. Ordinary
          spending excludes debt principal. Transfers, commitments, and scenario
          changes stay separate.
        </p>
      </div>
      {spendingBasis.effectiveDate != null && (
        <p className="text-xs text-muted-foreground">
          Effective {spendingBasis.effectiveDate}
        </p>
      )}
    </div>
  );
}

function selectedOrdinarySpending(model: SpendingBaselineModel): number | null {
  const { spendingBasis } = model.financialIndependence;
  if (
    spendingBasis.annualEssentialSpending == null ||
    spendingBasis.annualDiscretionarySpending == null
  ) {
    return model.financialIndependence.representativeAnnualExpenditure;
  }
  return (
    spendingBasis.annualEssentialSpending +
    spendingBasis.annualDiscretionarySpending
  );
}

function reconciledDebtCashFlow(model: SpendingBaselineModel): number | null {
  const ordinary = model.financialIndependence.reconciledAnnualExpenditure;
  const current =
    model.financialIndependence.reconciledAnnualCurrentExpenditure;
  return ordinary == null || current == null
    ? null
    : Math.max(current - ordinary, 0);
}

function BaselineComparisonGrid({
  model,
}: Readonly<{ model: SpendingBaselineModel }>) {
  const finance = model.financialIndependence;
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <AnnualComparison
        label="Ordinary spending"
        selected={selectedOrdinarySpending(model)}
        reconciled={finance.reconciledAnnualExpenditure}
        currency={model.baseCurrency}
      />
      <AnnualComparison
        label="Debt cash flow"
        selected={finance.spendingBasis.annualDebtCashFlow}
        reconciled={reconciledDebtCashFlow(model)}
        currency={model.baseCurrency}
      />
      <AnnualComparison
        label="Current cash requirement"
        selected={finance.representativeAnnualCurrentExpenditure}
        reconciled={finance.reconciledAnnualCurrentExpenditure}
        currency={model.baseCurrency}
      />
    </div>
  );
}

function ReconciledHistoryPrompt({
  model,
}: Readonly<{ model: SpendingBaselineModel }>) {
  if (
    model.active == null ||
    model.financialIndependence.reconciledAnnualExpenditure == null
  ) {
    return null;
  }
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-dashed p-3">
      <p className="min-w-0 flex-1 text-sm text-muted-foreground">
        Usable history is now available. Saving it creates a new version and
        keeps the previous baseline in version history.
      </p>
      <Button
        type="button"
        variant="outline"
        disabled={model.saving}
        onClick={() => void model.adoptReconciledHistory()}
      >
        Use reconciled history
      </Button>
    </div>
  );
}

function PeriodField({ model }: Readonly<{ model: SpendingBaselineModel }>) {
  return (
    <div className="space-y-1.5 text-xs font-medium">
      <label htmlFor="spending-baseline-period">Amount period</label>
      <Select value={model.period} onValueChange={model.changePeriod}>
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
  );
}

function CurrencyField({ model }: Readonly<{ model: SpendingBaselineModel }>) {
  return (
    <div className="space-y-1.5 text-xs font-medium">
      <label htmlFor="spending-baseline-currency">Currency</label>
      <Select
        value={model.currency}
        onValueChange={(value) => model.setCurrency(value as Currency)}
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
  );
}

function BaselineInputField({
  id,
  label,
  value,
  onChange,
  type = "text",
  className = "",
  placeholder,
}: Readonly<{
  id: string;
  label: string;
  value: string;
  onChange(value: string): void;
  type?: "text" | "date" | "number";
  className?: string;
  placeholder?: string;
}>) {
  return (
    <label
      className={`space-y-1.5 text-xs font-medium ${className}`}
      htmlFor={id}
    >
      <span>{label}</span>
      <Input
        id={id}
        aria-label={label}
        type={type}
        min={type === "number" ? "0" : undefined}
        step={type === "number" ? "any" : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={type !== "text"}
      />
    </label>
  );
}

function OwnershipField({ model }: Readonly<{ model: SpendingBaselineModel }>) {
  return (
    <div className="space-y-1.5 text-xs font-medium">
      <label htmlFor="spending-baseline-owner">Household ownership</label>
      <Select value={model.owner} onValueChange={model.setOwner}>
        <SelectTrigger
          id="spending-baseline-owner"
          aria-label="Spending baseline owner"
          className="w-full"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={HOUSEHOLD_OWNER}>Household</SelectItem>
          {model.household.members.map((member) => (
            <SelectItem key={member.id} value={member.id}>
              {member.displayName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function BaselineForm({ model }: Readonly<{ model: SpendingBaselineModel }>) {
  return (
    <form className="space-y-4" onSubmit={model.save}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <PeriodField model={model} />
        <CurrencyField model={model} />
        <BaselineInputField
          id="spending-baseline-effective-date"
          label="Spending baseline effective date"
          type="date"
          value={model.effectiveDate}
          onChange={model.setEffectiveDate}
        />
        <BaselineInputField
          id="spending-baseline-essential"
          label="Essential spending"
          type="number"
          value={model.essential}
          onChange={model.setEssential}
        />
        <BaselineInputField
          id="spending-baseline-discretionary"
          label="Discretionary spending"
          type="number"
          value={model.discretionary}
          onChange={model.setDiscretionary}
        />
        <BaselineInputField
          id="spending-baseline-debt"
          label="Debt cash flow"
          type="number"
          value={model.debt}
          onChange={model.setDebt}
        />
        <OwnershipField model={model} />
        <BaselineInputField
          id="spending-baseline-source-notes"
          label="Spending baseline source notes"
          value={model.sourceNotes}
          onChange={model.setSourceNotes}
          className="sm:col-span-2"
          placeholder="Budget, statement, estimate, or other source"
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={model.saving}>
          {baselineSaveLabel(model.saving, model.active != null)}
        </Button>
        <p className="text-xs text-muted-foreground">
          Put interest and fees in ordinary spending. Put principal and other
          debt repayment in debt cash flow.
        </p>
        {model.error && (
          <p className="text-sm text-destructive">{model.error}</p>
        )}
      </div>
    </form>
  );
}

export function SpendingBaselineManager() {
  const model = useSpendingBaselineModel();
  if (model.household.activeScope.kind === "member") {
    return <MemberScopeMessage />;
  }
  return (
    <section className="space-y-4 rounded-lg border p-4 sm:p-6">
      <BaselineHeader model={model} />
      <BaselineComparisonGrid model={model} />
      <ReconciledHistoryPrompt model={model} />
      <BaselineForm model={model} />
      <VersionHistory baselines={model.baselines} />
    </section>
  );
}
