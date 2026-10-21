"use client";

import { CheckCircle2Icon, ChevronDownIcon } from "lucide-react";
import { type SubmitEvent, useEffect, useMemo, useRef, useState } from "react";
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
import {
  annualOrdinarySpending,
  type Currency,
  equalSharedOwnership,
  formatAssetTrackerError,
  type Ownership,
  personalOwnership,
  type SpendingBaseline,
  SUPPORTED_CURRENCIES,
} from "@/features/personal-finance-app/domain";
import {
  formatCurrency,
  todayIsoDate,
} from "@/features/personal-finance-app/lib";
import { useAssetTracker } from "./asset-tracker-provider";

const HOUSEHOLD_OWNER = "household";

function sourceLabel(baseline: SpendingBaseline): string {
  return baseline.source.kind === "manual" ? "Manual" : "Reconciled";
}

function numberValue(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : Number.NaN;
}

function inputAmount(value: number): string {
  return String(Math.round((value + Number.EPSILON) * 100) / 100);
}

function periodInputAmount(
  annualAmount: number,
  period: "monthly" | "annual",
): string {
  return inputAmount(period === "monthly" ? annualAmount / 12 : annualAmount);
}

function initialBaselineAmount(
  baseline: SpendingBaseline | undefined,
  field:
    | "annualEssentialSpending"
    | "annualDiscretionarySpending"
    | "annualDebtCashFlow",
): string {
  if (baseline == null) return "";
  return inputAmount(baseline[field] / 12);
}

function ownerValue(ownership: Ownership | undefined): string {
  return ownership?.kind === "personal" ? ownership.memberId : HOUSEHOLD_OWNER;
}

function hydrateIfClean(
  dirtyFields: ReadonlySet<string>,
  field: string,
  hydrate: () => void,
) {
  if (!dirtyFields.has(field)) hydrate();
}

function VersionHistory({
  baselines,
}: Readonly<{ baselines: SpendingBaseline[] }>) {
  if (baselines.length === 0) return null;
  return (
    <details className="group rounded-md border">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-sm font-medium marker:content-none [&::-webkit-details-marker]:hidden">
        <span>
          Version history{" "}
          <span className="text-muted-foreground">({baselines.length})</span>
        </span>
        <ChevronDownIcon className="size-4 transition-transform group-open:rotate-180" />
      </summary>
      <ul className="divide-y border-t px-3">
        {baselines.map((baseline) => (
          <li
            key={baseline.id}
            className="grid gap-1 py-3 text-xs sm:grid-cols-[auto_auto_1fr_auto] sm:items-center sm:gap-2"
          >
            <div className="flex items-center gap-2">
              <span className="font-medium">v{baseline.version}</span>
              <Badge variant="outline">{sourceLabel(baseline)}</Badge>
            </div>
            <span className="text-muted-foreground">
              {baseline.effectiveDate}
            </span>
            <span>
              {formatCurrency(
                Math.round(annualOrdinarySpending(baseline)),
                baseline.currency,
              )}
              /yr
            </span>
            <Badge
              className="w-fit sm:justify-self-end"
              variant={baseline.status === "active" ? "secondary" : "outline"}
            >
              {baseline.status === "active" ? "Active" : "Superseded"}
            </Badge>
          </li>
        ))}
      </ul>
    </details>
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
  const [owner, setOwner] = useState(() => ownerValue(active?.ownership));
  const [sourceNotes, setSourceNotes] = useState(active?.sourceNotes ?? "");
  const [saving, setSaving] = useState(false);
  const [savingAction, setSavingAction] = useState<"manual" | "history" | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const historyAvailable =
    tracker.financialIndependence.reconciledAnnualExpenditure != null;
  const [mode, setMode] = useState<"summary" | "history" | "manual">(() => {
    if (active != null) return "summary";
    return historyAvailable ? "history" : "manual";
  });
  const dirtyFields = useRef(new Set<string>());
  const baselines = useMemo(
    () =>
      tracker.spendingBaselines.toSorted(
        (left, right) => right.version - left.version,
      ),
    [tracker.spendingBaselines],
  );
  function ownership(): Ownership {
    if (owner !== HOUSEHOLD_OWNER) return personalOwnership(owner);
    if (active?.ownership.kind === "shared") return active.ownership;
    return equalSharedOwnership(tracker.household.members);
  }

  useEffect(() => {
    if (tracker.localDataStatus !== "ready") return;
    hydrateIfClean(dirtyFields.current, "essential", () =>
      setEssential(initialBaselineAmount(active, "annualEssentialSpending")),
    );
    hydrateIfClean(dirtyFields.current, "discretionary", () =>
      setDiscretionary(
        initialBaselineAmount(active, "annualDiscretionarySpending"),
      ),
    );
    hydrateIfClean(dirtyFields.current, "debt", () =>
      setDebt(initialBaselineAmount(active, "annualDebtCashFlow")),
    );
    hydrateIfClean(dirtyFields.current, "currency", () =>
      setCurrency(active?.currency ?? tracker.baseCurrency),
    );
    hydrateIfClean(dirtyFields.current, "effectiveDate", () =>
      setEffectiveDate(
        active?.effectiveDate ?? tracker.valuationDate ?? todayIsoDate(),
      ),
    );
    hydrateIfClean(dirtyFields.current, "owner", () =>
      setOwner(ownerValue(active?.ownership)),
    );
    hydrateIfClean(dirtyFields.current, "sourceNotes", () =>
      setSourceNotes(active?.sourceNotes ?? ""),
    );
  }, [
    active,
    tracker.baseCurrency,
    tracker.localDataStatus,
    tracker.valuationDate,
  ]);

  function edit(
    field: string,
    setValue: (value: string) => void,
    value: string,
  ) {
    dirtyFields.current.add(field);
    setValue(value);
    setNotice(null);
  }

  function changePeriod(next: "monthly" | "annual") {
    if (next === period) return;
    dirtyFields.current.add("essential");
    dirtyFields.current.add("discretionary");
    dirtyFields.current.add("debt");
    const multiplier = next === "annual" ? 12 : 1 / 12;
    const convert = (value: string) =>
      value.trim() === "" ? "" : inputAmount(Number(value) * multiplier);
    setEssential(convert(essential));
    setDiscretionary(convert(discretionary));
    setDebt(convert(debt));
    setPeriod(next);
  }

  function showHistory() {
    const ordinary = tracker.financialIndependence.reconciledAnnualExpenditure;
    const previous = baselines.find(
      (baseline) => baseline.source.kind === "reconciled",
    );
    const annualEssential =
      previous?.annualEssentialSpending ?? active?.annualEssentialSpending;
    const nextEssential =
      ordinary != null && annualEssential != null && annualEssential <= ordinary
        ? periodInputAmount(annualEssential, period)
        : "";
    dirtyFields.current.add("essential");
    setEssential(nextEssential);
    setError(null);
    setNotice(null);
    setMode("history");
  }

  function showManual() {
    if (active != null) {
      dirtyFields.current.add("essential");
      dirtyFields.current.add("discretionary");
      dirtyFields.current.add("debt");
      setEssential(periodInputAmount(active.annualEssentialSpending, period));
      setDiscretionary(
        periodInputAmount(active.annualDiscretionarySpending, period),
      );
      setDebt(periodInputAmount(active.annualDebtCashFlow, period));
    }
    setError(null);
    setNotice(null);
    setMode("manual");
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
    setSavingAction("manual");
    setError(null);
    setNotice(null);
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
      dirtyFields.current.clear();
      const annualOrdinary =
        (essentialAmount + discretionaryAmount) * multiplier;
      setNotice(
        `Baseline saved. Your FI results now use ${formatCurrency(Math.round(annualOrdinary), currency)}/yr of ordinary spending.`,
      );
      setMode("summary");
    } catch (error_) {
      setError(formatAssetTrackerError(error_));
    } finally {
      setSaving(false);
      setSavingAction(null);
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
    if (essential.trim() === "") {
      setError(
        "Enter and confirm essential spending before saving reconciled history.",
      );
      return;
    }
    const enteredEssential = numberValue(essential);
    const retainedEssential =
      enteredEssential * (period === "monthly" ? 12 : 1);
    if (!Number.isFinite(retainedEssential) || retainedEssential > ordinary) {
      setError(
        "Essential spending must be zero or more and cannot exceed reconciled ordinary spending.",
      );
      return;
    }
    setSaving(true);
    setSavingAction("history");
    setError(null);
    setNotice(null);
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
        sourceNotes:
          "Reconciled ordinary total; essential split confirmed manually",
      });
      dirtyFields.current.clear();
      setNotice(
        `History applied. Your FI results now use ${formatCurrency(Math.round(ordinary), tracker.baseCurrency)}/yr of ordinary spending.`,
      );
      setMode("summary");
    } catch (error_) {
      setError(formatAssetTrackerError(error_));
    } finally {
      setSaving(false);
      setSavingAction(null);
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
    savingAction,
    error,
    notice,
    historyAvailable,
    mode,
    showHistory,
    showManual,
    changePeriod,
    setEssential: (value: string) => edit("essential", setEssential, value),
    setDiscretionary: (value: string) =>
      edit("discretionary", setDiscretionary, value),
    setDebt: (value: string) => edit("debt", setDebt, value),
    setCurrency: (value: Currency) => {
      dirtyFields.current.add("currency");
      setCurrency(value);
    },
    setEffectiveDate: (value: string) =>
      edit("effectiveDate", setEffectiveDate, value),
    setOwner: (value: string) => edit("owner", setOwner, value),
    setSourceNotes: (value: string) =>
      edit("sourceNotes", setSourceNotes, value),
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
        Switch to Household to set the spending used by forecasts.
      </p>
    </section>
  );
}

function BaselineHeader({ model }: Readonly<{ model: SpendingBaselineModel }>) {
  const { spendingBasis } = model.financialIndependence;
  const badgeLabel =
    model.active == null
      ? model.historyAvailable
        ? "Using history"
        : "Not set"
      : sourceLabel(model.active);
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold">Spending baseline</h3>
          <Badge
            variant={spendingBasis.kind === "manual" ? "secondary" : "outline"}
          >
            {badgeLabel}
          </Badge>
          {spendingBasis.version != null && (
            <Badge variant="outline">v{spendingBasis.version}</Badge>
          )}
        </div>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Set the spending used for your FI target and forecasts.
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

function StatusNotice({ model }: Readonly<{ model: SpendingBaselineModel }>) {
  if (model.notice == null) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col gap-3 rounded-md border bg-muted/40 p-3 sm:flex-row sm:items-center"
    >
      <div className="flex min-w-0 items-start gap-2">
        <CheckCircle2Icon className="mt-0.5 size-4 shrink-0" />
        <p className="text-sm">{model.notice}</p>
      </div>
      <Button className="w-full sm:ml-auto sm:w-auto" variant="outline" asChild>
        <a href="#fi-results">View updated results</a>
      </Button>
    </div>
  );
}

function BaselineSummaryAmounts({
  model,
}: Readonly<{ model: SpendingBaselineModel }>) {
  const ordinary = selectedOrdinarySpending(model);
  const debt = model.financialIndependence.spendingBasis.annualDebtCashFlow;
  const history = model.financialIndependence.reconciledAnnualExpenditure;
  const difference =
    ordinary != null && history != null ? ordinary - history : null;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <p className="text-xs text-muted-foreground">Ordinary spending</p>
        <p className="mt-1 text-2xl font-semibold">
          {ordinary == null
            ? "Unavailable"
            : `${formatCurrency(Math.round(ordinary), model.baseCurrency)}/yr`}
        </p>
        {ordinary != null && (
          <p className="mt-1 text-xs text-muted-foreground">
            {formatCurrency(Math.round(ordinary / 12), model.baseCurrency)}
            /month
          </p>
        )}
      </div>
      <div>
        <p className="text-xs text-muted-foreground">Debt cash flow</p>
        <p className="mt-1 text-lg font-semibold">
          {debt == null
            ? "Unavailable"
            : `${formatCurrency(Math.round(debt), model.baseCurrency)}/yr`}
        </p>
        {difference != null && difference !== 0 && (
          <p className="mt-1 text-xs text-muted-foreground">
            {formatCurrency(
              Math.round(Math.abs(difference)),
              model.baseCurrency,
            )}
            /yr {difference > 0 ? "above" : "below"} reconciled history
          </p>
        )}
      </div>
    </div>
  );
}

function BaselineSummaryActions({
  model,
}: Readonly<{ model: SpendingBaselineModel }>) {
  return (
    <div className="grid gap-2 sm:flex sm:flex-wrap">
      <Button className="w-full sm:w-auto" onClick={model.showManual}>
        Edit amounts
      </Button>
      {model.historyAvailable && (
        <Button
          className="w-full sm:w-auto"
          variant="outline"
          onClick={model.showHistory}
        >
          {model.active?.source.kind === "reconciled"
            ? "Refresh from history"
            : "Use history"}
        </Button>
      )}
      <Button className="w-full sm:w-auto" variant="ghost" asChild>
        <a href="#fi-results">View FI results</a>
      </Button>
    </div>
  );
}

function BaselineSummary({
  model,
}: Readonly<{ model: SpendingBaselineModel }>) {
  return (
    <div className="space-y-4 rounded-md bg-muted/40 p-4">
      <BaselineSummaryAmounts model={model} />
      <p className="text-sm text-muted-foreground">
        This sets your FI target, runway, and portfolio projection below.
      </p>
      <BaselineSummaryActions model={model} />
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
  ariaLabel,
  max,
}: Readonly<{
  id: string;
  label: string;
  value: string;
  onChange(value: string): void;
  type?: "text" | "date" | "number";
  className?: string;
  placeholder?: string;
  ariaLabel?: string;
  max?: number;
}>) {
  return (
    <label
      className={`space-y-1.5 text-xs font-medium ${className}`}
      htmlFor={id}
    >
      <span>{label}</span>
      <Input
        id={id}
        aria-label={ariaLabel ?? label}
        type={type}
        min={type === "number" ? "0" : undefined}
        max={max}
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
      <label htmlFor="spending-baseline-owner">Applies to</label>
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

function FlowSwitcher({ model }: Readonly<{ model: SpendingBaselineModel }>) {
  if (!model.historyAvailable) return null;
  return (
    <Button
      className="w-full sm:w-auto"
      type="button"
      variant="ghost"
      onClick={model.mode === "history" ? model.showManual : model.showHistory}
    >
      {model.mode === "history"
        ? "Enter my own amounts"
        : "Use history instead"}
    </Button>
  );
}

function ErrorMessage({ model }: Readonly<{ model: SpendingBaselineModel }>) {
  if (model.error == null) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {model.error}
    </p>
  );
}

function HistoryFlow({ model }: Readonly<{ model: SpendingBaselineModel }>) {
  const ordinary = model.financialIndependence.reconciledAnnualExpenditure;
  const debt = reconciledDebtCashFlow(model);
  if (ordinary == null) return null;
  const maximumEssential =
    model.period === "monthly" ? ordinary / 12 : ordinary;
  return (
    <div className="space-y-4 rounded-md border p-4">
      <div>
        <h4 className="font-medium">Start from history</h4>
        <p className="mt-1 text-2xl font-semibold">
          {formatCurrency(Math.round(ordinary), model.baseCurrency)}/yr
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Reconciled from balances and income. Debt cash flow is{" "}
          {debt == null
            ? "unavailable"
            : `${formatCurrency(Math.round(debt), model.baseCurrency)}/yr`}
          .
        </p>
      </div>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <PeriodField model={model} />
        <BaselineInputField
          id="spending-baseline-essential"
          label={`Essential spending per ${model.period === "monthly" ? "month" : "year"}`}
          ariaLabel="Essential spending"
          type="number"
          value={model.essential}
          onChange={model.setEssential}
          max={maximumEssential}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Enter up to{" "}
        {formatCurrency(Math.round(maximumEssential), model.baseCurrency)} per{" "}
        {model.period === "monthly" ? "month" : "year"}. The rest becomes
        discretionary.
      </p>
      <ErrorMessage model={model} />
      <div className="grid gap-2 sm:flex sm:flex-wrap">
        <Button
          className="w-full sm:w-auto"
          type="button"
          disabled={model.saving}
          onClick={() => void model.adoptReconciledHistory()}
        >
          {model.savingAction === "history"
            ? "Applying history…"
            : "Use history"}
        </Button>
        <FlowSwitcher model={model} />
      </div>
    </div>
  );
}

function MoreBaselineDetails({
  model,
}: Readonly<{ model: SpendingBaselineModel }>) {
  return (
    <details className="group rounded-md border">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-sm font-medium marker:content-none [&::-webkit-details-marker]:hidden">
        Currency, date, owner, and source
        <ChevronDownIcon className="size-4 transition-transform group-open:rotate-180" />
      </summary>
      <div className="grid gap-3 border-t p-3 sm:grid-cols-2 lg:grid-cols-3">
        <CurrencyField model={model} />
        <BaselineInputField
          id="spending-baseline-effective-date"
          label="Effective date"
          ariaLabel="Spending baseline effective date"
          type="date"
          value={model.effectiveDate}
          onChange={model.setEffectiveDate}
        />
        <OwnershipField model={model} />
        <BaselineInputField
          id="spending-baseline-source-notes"
          label="Source notes"
          ariaLabel="Spending baseline source notes"
          value={model.sourceNotes}
          onChange={model.setSourceNotes}
          className="sm:col-span-2 lg:col-span-3"
          placeholder="Budget, statement, estimate, or other source"
        />
      </div>
    </details>
  );
}

function ManualAmountFields({
  model,
}: Readonly<{ model: SpendingBaselineModel }>) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <PeriodField model={model} />
      <BaselineInputField
        id="spending-baseline-essential"
        label={`Essential per ${model.period === "monthly" ? "month" : "year"}`}
        ariaLabel="Essential spending"
        type="number"
        value={model.essential}
        onChange={model.setEssential}
      />
      <BaselineInputField
        id="spending-baseline-discretionary"
        label={`Discretionary per ${model.period === "monthly" ? "month" : "year"}`}
        ariaLabel="Discretionary spending"
        type="number"
        value={model.discretionary}
        onChange={model.setDiscretionary}
      />
      <BaselineInputField
        id="spending-baseline-debt"
        label={`Debt cash flow per ${model.period === "monthly" ? "month" : "year"}`}
        ariaLabel="Debt cash flow"
        type="number"
        value={model.debt}
        onChange={model.setDebt}
      />
    </div>
  );
}

function ManualSpendingPreview({
  model,
}: Readonly<{ model: SpendingBaselineModel }>) {
  const amounts = [model.essential, model.discretionary].map(numberValue);
  const [essentialAmount = Number.NaN, discretionaryAmount = Number.NaN] =
    amounts;
  if (![essentialAmount, discretionaryAmount].every(Number.isFinite))
    return null;
  const multiplier = model.period === "monthly" ? 12 : 1;
  return (
    <div className="rounded-md bg-muted/40 p-3">
      <p className="text-xs text-muted-foreground">Forecast spending</p>
      <p className="mt-1 font-semibold">
        {formatCurrency(
          Math.round((essentialAmount + discretionaryAmount) * multiplier),
          model.currency,
        )}
        /yr
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Saving this updates the FI target, runway, and projection.
      </p>
    </div>
  );
}

function ManualFormActions({
  model,
}: Readonly<{ model: SpendingBaselineModel }>) {
  const label =
    model.savingAction === "manual"
      ? "Saving…"
      : model.active == null
        ? "Use this budget"
        : "Save changes";
  return (
    <div className="grid gap-2 sm:flex sm:flex-wrap">
      <Button
        className="w-full sm:w-auto"
        type="submit"
        disabled={model.saving}
      >
        {label}
      </Button>
      <FlowSwitcher model={model} />
    </div>
  );
}

function ManualBaselineForm({
  model,
}: Readonly<{ model: SpendingBaselineModel }>) {
  return (
    <form className="space-y-4 rounded-md border p-4" onSubmit={model.save}>
      <div>
        <h4 className="font-medium">Enter a budget</h4>
        <p className="mt-1 text-sm text-muted-foreground">
          Use the amounts you expect the household to keep spending.
        </p>
      </div>
      <ManualAmountFields model={model} />
      <ManualSpendingPreview model={model} />
      <MoreBaselineDetails model={model} />
      <p className="text-xs text-muted-foreground">
        Debt cash flow covers principal and other debt repayments. Interest and
        fees belong in ordinary spending.
      </p>
      <ErrorMessage model={model} />
      <ManualFormActions model={model} />
    </form>
  );
}

export function SpendingBaselineManager() {
  const model = useSpendingBaselineModel();
  if (model.household.activeScope.kind === "member") {
    return <MemberScopeMessage />;
  }
  return (
    <section className="min-w-0 space-y-4 rounded-lg border p-4 sm:p-6">
      <BaselineHeader model={model} />
      <StatusNotice model={model} />
      {model.mode === "summary" && <BaselineSummary model={model} />}
      {model.mode === "history" && <HistoryFlow model={model} />}
      {model.mode === "manual" && <ManualBaselineForm model={model} />}
      <VersionHistory baselines={model.baselines} />
    </section>
  );
}
