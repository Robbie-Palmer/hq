"use client";

import { addDays, addYears, format, parseISO } from "date-fns";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { type SubmitEvent, useEffect, useMemo, useState } from "react";
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
  type ActualCashFlow,
  accountLiquidity,
  type CashFlowDecision,
  type Currency,
  formatAssetTrackerError,
  isLiability,
} from "@/lib/domain/assettracker";
import { useAssetTracker } from "./asset-tracker-provider";

const ITEMISED_SCENARIO_LABEL = "itemised-scenario";
const NEW_SCENARIO = "__new__";

type CostRow = {
  id?: string;
  name: string;
  amount: string;
  date: string;
  actuals: ActualCashFlow[];
};

function placeholderDate() {
  return format(addYears(parseISO(todayIsoDate()), 1), "yyyy-MM-dd");
}

function emptyRows(): CostRow[] {
  return [{ name: "", amount: "", date: placeholderDate(), actuals: [] }];
}

function amountPaid(actuals: readonly ActualCashFlow[]): number {
  return actuals.reduce(
    (total, actual) =>
      total + (actual.direction === "payment" ? actual.amount : -actual.amount),
    0,
  );
}

function itemisedScenarios(
  records: ReturnType<typeof useAssetTracker>["futureCashFlows"],
): CashFlowDecision[] {
  return records.filter(
    (record): record is CashFlowDecision =>
      record.kind === "decision" &&
      record.labels.includes(ITEMISED_SCENARIO_LABEL),
  );
}

function useItemisedScenarioPlanner() {
  const tracker = useAssetTracker();
  const scenarios = itemisedScenarios(tracker.futureCashFlows);
  const [selectedId, setSelectedId] = useState(
    () => scenarios[0]?.id ?? NEW_SCENARIO,
  );
  const existing = scenarios.find(({ id }) => id === selectedId);
  const eligibleAccounts = useMemo(
    () =>
      tracker.accounts.filter(
        (account) =>
          account.isOpen &&
          !isLiability(account.assetType) &&
          accountLiquidity(account) !== "illiquid",
      ),
    [tracker.accounts],
  );
  const defaultAccountId =
    eligibleAccounts.find((account) => account.assetType === "cash")?.id ??
    eligibleAccounts[0]?.id ??
    "";
  const [name, setName] = useState("");
  const [accountId, setAccountId] = useState(defaultAccountId);
  const [costs, setCosts] = useState<CostRow[]>(emptyRows);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [createdName, setCreatedName] = useState<string | null>(null);
  const [paymentFor, setPaymentFor] = useState<string | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(todayIsoDate);
  const [recordingPayment, setRecordingPayment] = useState(false);

  useEffect(() => {
    if (createdName == null) return;
    const created = scenarios.findLast(
      (scenario) => scenario.name === createdName,
    );
    if (created == null) return;
    setSelectedId(created.id);
    setCreatedName(null);
  }, [createdName, scenarios]);

  useEffect(() => {
    if (existing == null) return;
    setName(existing.name);
    setAccountId(existing.stages[0]?.fromAccountId ?? defaultAccountId);
    setCosts(
      existing.stages.map((stage) => ({
        id: stage.id,
        name: stage.name ?? "Cost",
        amount: String(stage.expectedAmount),
        date: stage.expectedDate,
        actuals: stage.actuals,
      })),
    );
    setSaved(false);
    setError(null);
  }, [defaultAccountId, existing]);

  const account = eligibleAccounts.find(({ id }) => id === accountId);
  const currency = account?.currency ?? tracker.baseCurrency;
  const total = costs.reduce(
    (sum, cost) => sum + (Number(cost.amount) || 0),
    0,
  );
  const markChanged = () => setSaved(false);
  const changeName = (value: string) => {
    setName(value);
    markChanged();
  };
  const changeAccount = (value: string) => {
    setAccountId(value);
    markChanged();
  };
  const updateCost = (index: number, change: Partial<CostRow>) => {
    markChanged();
    setCosts((current) =>
      current.map((cost, candidate) =>
        candidate === index ? { ...cost, ...change } : cost,
      ),
    );
  };
  const addCost = () => {
    setCosts((current) => [
      ...current,
      { name: "", amount: "", date: placeholderDate(), actuals: [] },
    ]);
    markChanged();
  };
  const removeCost = (index: number) => {
    setCosts((current) =>
      current.filter((_, candidate) => candidate !== index),
    );
    markChanged();
  };
  const startNewScenario = () => {
    setSelectedId(NEW_SCENARIO);
    setName("");
    setAccountId(defaultAccountId);
    setCosts(emptyRows());
    setSaved(false);
    setError(null);
  };
  const startPayment = (cost: CostRow) => {
    setPaymentFor(cost.id ?? null);
    setPaymentAmount(
      String(Math.max(Number(cost.amount) - amountPaid(cost.actuals), 0)),
    );
  };

  async function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (account == null) return;
    setSubmitting(true);
    setError(null);
    setSaved(false);
    const input = {
      name,
      labels: Array.from(
        new Set([...(existing?.labels ?? []), ITEMISED_SCENARIO_LABEL]),
      ),
      currency,
      importance: existing?.importance,
      confidence: existing?.confidence,
      reversibility: existing?.reversibility ?? ("partly-reversible" as const),
      dependencyIds: existing?.dependencyIds ?? [],
      alternativeToIds: existing?.alternativeToIds ?? [],
      stages: costs.map((cost) => ({
        ...(cost.id == null ? {} : { id: cost.id }),
        name: cost.name,
        fromAccountId: account.id,
        expectedDate: cost.date,
        minimumAmount: Number(cost.amount),
        expectedAmount: Number(cost.amount),
        maximumAmount: Number(cost.amount),
      })),
    };
    try {
      if (existing == null) {
        await tracker.addCashFlowDecision(input);
        setCreatedName(name);
      } else
        await tracker.updateCashFlowDecision({ id: existing.id, ...input });
      setSaved(true);
    } catch (cause) {
      setError(formatAssetTrackerError(cause));
    } finally {
      setSubmitting(false);
    }
  }

  async function recordPayment(stageId: string) {
    setRecordingPayment(true);
    setError(null);
    try {
      await tracker.recordActualCashFlow({
        futureCashFlowId: existing?.id ?? "",
        stageId,
        date: paymentDate,
        amount: Number(paymentAmount),
        direction: "payment",
      });
      setPaymentFor(null);
      setPaymentAmount("");
      setPaymentDate(todayIsoDate());
    } catch (cause) {
      setError(formatAssetTrackerError(cause));
    } finally {
      setRecordingPayment(false);
    }
  }

  return {
    accountId,
    addCost,
    changeAccount,
    changeName,
    costs,
    currency,
    eligibleAccounts,
    error,
    existing,
    name,
    paymentAmount,
    paymentDate,
    paymentFor,
    recordPayment,
    recordingPayment,
    removeCost,
    saved,
    save,
    scenarios,
    selectedId,
    setPaymentAmount,
    setPaymentDate,
    setPaymentFor,
    setSelectedId,
    startNewScenario,
    startPayment,
    submitting,
    total,
    updateCost,
  };
}

type Planner = ReturnType<typeof useItemisedScenarioPlanner>;

function ScenarioHeader({ planner }: Readonly<{ planner: Planner }>) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold">Itemised scenarios</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Group the costs of a choice or event, then include it in the main
          decision comparison.
        </p>
      </div>
      {planner.scenarios.length > 0 && (
        <div className="flex gap-2">
          <Select
            value={planner.selectedId}
            onValueChange={planner.setSelectedId}
          >
            <SelectTrigger aria-label="Scenario" className="w-48">
              <SelectValue placeholder="New scenario" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NEW_SCENARIO}>New scenario</SelectItem>
              {planner.scenarios.map((scenario) => (
                <SelectItem key={scenario.id} value={scenario.id}>
                  {scenario.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            onClick={planner.startNewScenario}
          >
            New
          </Button>
        </div>
      )}
    </div>
  );
}

function ScenarioDetails({ planner }: Readonly<{ planner: Planner }>) {
  return (
    <div className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2">
      <label
        htmlFor="itemised-scenario-name"
        className="space-y-1.5 text-xs font-medium"
      >
        <span>Scenario name</span>
        <Input
          id="itemised-scenario-name"
          required
          placeholder="Name this scenario"
          value={planner.name}
          onChange={(event) => planner.changeName(event.target.value)}
        />
      </label>
      <div className="space-y-1.5 text-xs font-medium">
        <span>Pay from</span>
        <Select value={planner.accountId} onValueChange={planner.changeAccount}>
          <SelectTrigger aria-label="Pay from" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {planner.eligibleAccounts.map((account) => (
              <SelectItem key={account.id} value={account.id}>
                {account.name} · {account.currency}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function CostInputs({
  cost,
  index,
  update,
}: Readonly<{ cost: CostRow; index: number; update: Planner["updateCost"] }>) {
  const label = cost.name || `Cost ${index + 1}`;
  return (
    <>
      <Input
        aria-label={`Cost ${index + 1} name`}
        placeholder="Cost name"
        required
        value={cost.name}
        onChange={(event) => update(index, { name: event.target.value })}
      />
      <Input
        aria-label={`${label} due date`}
        type="date"
        min={
          amountPaid(cost.actuals) >= Number(cost.amount)
            ? undefined
            : format(addDays(parseISO(todayIsoDate()), 1), "yyyy-MM-dd")
        }
        required
        value={cost.date}
        onChange={(event) => update(index, { date: event.target.value })}
      />
      <Input
        aria-label={`${label} amount`}
        type="number"
        min="0.01"
        step="0.01"
        placeholder="0"
        required
        value={cost.amount}
        onChange={(event) => update(index, { amount: event.target.value })}
      />
    </>
  );
}

function PaymentSummary({
  cost,
  currency,
  onStart,
}: Readonly<{ cost: CostRow; currency: Currency; onStart: () => void }>) {
  return (
    <div className="text-xs text-muted-foreground">
      <span className="block font-mono text-foreground">
        {formatCurrency(amountPaid(cost.actuals), currency)}
      </span>
      {cost.id != null && (
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto p-0 text-xs"
          onClick={onStart}
        >
          Record payment
        </Button>
      )}
    </div>
  );
}

function PaymentEditor({
  cost,
  planner,
}: Readonly<{ cost: CostRow & { id: string }; planner: Planner }>) {
  return (
    <div className="grid gap-2 rounded-md bg-muted/35 p-3 sm:col-span-5 sm:grid-cols-[8rem_10rem_auto] sm:items-end">
      <label
        htmlFor={`scenario-payment-amount-${cost.id}`}
        className="space-y-1 text-xs font-medium"
      >
        <span>Amount paid</span>
        <Input
          id={`scenario-payment-amount-${cost.id}`}
          aria-label={`${cost.name} payment amount`}
          type="number"
          min="0.01"
          step="0.01"
          value={planner.paymentAmount}
          onChange={(event) => planner.setPaymentAmount(event.target.value)}
        />
      </label>
      <label
        htmlFor={`scenario-payment-date-${cost.id}`}
        className="space-y-1 text-xs font-medium"
      >
        <span>Payment date</span>
        <Input
          id={`scenario-payment-date-${cost.id}`}
          aria-label={`${cost.name} payment date`}
          type="date"
          max={todayIsoDate()}
          value={planner.paymentDate}
          onChange={(event) => planner.setPaymentDate(event.target.value)}
        />
      </label>
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          disabled={planner.recordingPayment}
          onClick={() => void planner.recordPayment(cost.id)}
        >
          Save payment
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => planner.setPaymentFor(null)}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

function CostRowEditor({
  cost,
  index,
  planner,
}: Readonly<{ cost: CostRow; index: number; planner: Planner }>) {
  return (
    <div className="grid gap-2 p-3 sm:grid-cols-[minmax(10rem,1fr)_9rem_8rem_7rem_2.5rem] sm:items-center">
      <CostInputs cost={cost} index={index} update={planner.updateCost} />
      <PaymentSummary
        cost={cost}
        currency={planner.currency}
        onStart={() => planner.startPayment(cost)}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`Remove ${cost.name || `cost ${index + 1}`}`}
        disabled={planner.costs.length === 1}
        onClick={() => planner.removeCost(index)}
      >
        <Trash2Icon />
      </Button>
      {cost.id != null && planner.paymentFor === cost.id && (
        <PaymentEditor cost={{ ...cost, id: cost.id }} planner={planner} />
      )}
    </div>
  );
}

function ScenarioCostFooter({ planner }: Readonly<{ planner: Planner }>) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/20 px-3 py-3">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={planner.addCost}
      >
        <PlusIcon />
        Add cost
      </Button>
      <p className="text-sm">
        Total{" "}
        <span className="font-semibold">
          {formatCurrency(planner.total, planner.currency)}
        </span>
      </p>
    </div>
  );
}

function ScenarioCosts({ planner }: Readonly<{ planner: Planner }>) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="hidden grid-cols-[minmax(10rem,1fr)_9rem_8rem_7rem_2.5rem] gap-2 border-b bg-muted/35 px-3 py-2 text-xs font-medium text-muted-foreground sm:grid">
        <span>Cost</span>
        <span>Due date</span>
        <span>Estimate</span>
        <span>Paid</span>
        <span className="sr-only">Actions</span>
      </div>
      <div className="divide-y">
        {planner.costs.map((cost, index) => (
          <CostRowEditor
            key={cost.id ?? `new-${index}`}
            cost={cost}
            index={index}
            planner={planner}
          />
        ))}
      </div>
      <ScenarioCostFooter planner={planner} />
    </div>
  );
}

function ScenarioEmptyState() {
  return (
    <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
      Add an open cash or investment account before creating a scenario. Each
      cost needs an account it will be paid from.
    </div>
  );
}

export function ItemisedScenarioPlanner() {
  const planner = useItemisedScenarioPlanner();
  if (planner.eligibleAccounts.length === 0) return <ScenarioEmptyState />;
  return (
    <form onSubmit={planner.save} className="space-y-5">
      <ScenarioHeader planner={planner} />
      <ScenarioDetails planner={planner} />
      <ScenarioCosts planner={planner} />
      {planner.error != null && (
        <p className="text-sm text-destructive">{planner.error}</p>
      )}
      {planner.saved && (
        <p className="text-sm text-muted-foreground">Scenario saved.</p>
      )}
      <Button type="submit" disabled={planner.submitting}>
        {planner.existing == null ? "Add scenario" : "Save scenario"}
      </Button>
    </form>
  );
}
