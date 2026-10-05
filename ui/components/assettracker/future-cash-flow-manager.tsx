"use client";

import { addDays, format, parseISO } from "date-fns";
import { Trash2Icon } from "lucide-react";
import { type ReactNode, type SubmitEvent, useMemo, useState } from "react";
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
  accountLiquidity,
  type FutureCashFlow,
  formatAssetTrackerError,
  isLiability,
} from "@/lib/domain/assettracker";
import { useAssetTracker } from "./asset-tracker-provider";

const NO_SELECTION = "__none__";

function tomorrowIsoDate(): string {
  return format(addDays(parseISO(todayIsoDate()), 1), "yyyy-MM-dd");
}

function optional(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function labels(value: string): string[] {
  return value
    .split(",")
    .map((label) => label.trim())
    .filter(Boolean);
}

function selectedId(value: string): string | undefined {
  return value === NO_SELECTION ? undefined : value;
}

function selectedIds(value: string): string[] {
  const id = selectedId(value);
  return id == null ? [] : [id];
}

function numberOr(value: string, fallback: number): number {
  return optional(value) == null ? fallback : Number(value);
}

function percentage(value: string): number | undefined {
  return optional(value) == null ? undefined : Number(value) / 100;
}

function recordStatus(record: FutureCashFlow): string {
  if (record.kind === "commitment")
    return record.status === "active" ? "Included" : "Cancelled";
  if (record.status === "selected") return "Included";
  if (record.status === "declined") return "Set aside";
  return "Considering";
}

function stageAmount(record: FutureCashFlow, stageIndex: number): number {
  return record.kind === "commitment"
    ? (record.stages[stageIndex]?.amount ?? 0)
    : (record.stages[stageIndex]?.expectedAmount ?? 0);
}

function stageDate(record: FutureCashFlow, stageIndex: number): string {
  return record.kind === "commitment"
    ? (record.stages[stageIndex]?.dueDate ?? "")
    : (record.stages[stageIndex]?.expectedDate ?? "");
}

function FormField({
  id,
  label,
  children,
  className = "",
}: Readonly<{
  id: string;
  label: string;
  children: ReactNode;
  className?: string;
}>) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <label htmlFor={id} className="text-xs font-medium">
        {label}
      </label>
      {children}
    </div>
  );
}

function useFutureCashFlowManager() {
  const tracker = useAssetTracker();
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
  const [caseName, setCaseName] = useState("");
  const [caseTargetDate, setCaseTargetDate] = useState("");
  const [kind, setKind] = useState<"commitment" | "decision">("commitment");
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [minimumAmount, setMinimumAmount] = useState("");
  const [maximumAmount, setMaximumAmount] = useState("");
  const [date, setDate] = useState(tomorrowIsoDate);
  const [earliestDate, setEarliestDate] = useState("");
  const [latestDate, setLatestDate] = useState("");
  const [accountId, setAccountId] = useState("");
  const [planningCaseId, setPlanningCaseId] = useState(NO_SELECTION);
  const [labelText, setLabelText] = useState("");
  const [importance, setImportance] = useState("");
  const [confidence, setConfidence] = useState("");
  const [dependencyId, setDependencyId] = useState(NO_SELECTION);
  const [alternativeId, setAlternativeId] = useState(NO_SELECTION);
  const [changeability, setChangeability] = useState<"fixed" | "variable">(
    "fixed",
  );
  const [reversibility, setReversibility] = useState<
    "reversible" | "partly-reversible" | "irreversible"
  >("reversible");
  const [refundable, setRefundable] = useState(false);
  const [actualFor, setActualFor] = useState<{
    recordId: string;
    stageId: string;
  } | null>(null);
  const [actualAmount, setActualAmount] = useState("");
  const [actualDate, setActualDate] = useState(todayIsoDate);
  const [actualDirection, setActualDirection] = useState<"payment" | "refund">(
    "payment",
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const selectedAccountId = eligibleAccounts.some(({ id }) => id === accountId)
    ? accountId
    : (eligibleAccounts[0]?.id ?? "");
  const selectedAccount = eligibleAccounts.find(
    ({ id }) => id === selectedAccountId,
  );
  const caseNames = new Map(
    tracker.planningCases.map((item) => [item.id, item.name]),
  );
  const recordNames = new Map(
    tracker.futureCashFlows.map((record) => [record.id, record.name]),
  );
  async function run(action: () => Promise<void>) {
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(formatAssetTrackerError(cause));
    }
  }
  async function handleCreateCase(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    await run(async () => {
      await tracker.createPlanningCase({
        name: caseName,
        labels: [],
        ...(optional(caseTargetDate) == null
          ? {}
          : { targetDate: caseTargetDate }),
      });
      setCaseName("");
      setCaseTargetDate("");
    });
    setSubmitting(false);
  }
  async function handleAdd(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedAccount) return;
    setSubmitting(true);
    setError(null);
    const expectedAmount = Number(amount);
    const common = {
      name,
      planningCaseId: selectedId(planningCaseId),
      labels: labels(labelText),
      currency: selectedAccount.currency,
    };
    await run(async () => {
      if (kind === "commitment") {
        await tracker.addCommitment({
          ...common,
          changeability,
          refundable,
          stages: [
            {
              fromAccountId: selectedAccountId,
              dueDate: date,
              amount: expectedAmount,
            },
          ],
        });
      } else {
        await tracker.addCashFlowDecision({
          ...common,
          importance: optional(importance),
          confidence: percentage(confidence),
          reversibility,
          dependencyIds: selectedIds(dependencyId),
          alternativeToIds: selectedIds(alternativeId),
          stages: [
            {
              fromAccountId: selectedAccountId,
              earliestDate: optional(earliestDate),
              expectedDate: date,
              latestDate: optional(latestDate),
              minimumAmount: numberOr(minimumAmount, expectedAmount),
              expectedAmount,
              maximumAmount: numberOr(maximumAmount, expectedAmount),
            },
          ],
        });
      }
      setName("");
      setAmount("");
      setMinimumAmount("");
      setMaximumAmount("");
      setDate(tomorrowIsoDate());
      setEarliestDate("");
      setLatestDate("");
      setLabelText("");
      setImportance("");
      setConfidence("");
      setDependencyId(NO_SELECTION);
      setAlternativeId(NO_SELECTION);
    });
    setSubmitting(false);
  }
  async function handleActual(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!actualFor) return;
    await run(async () => {
      await tracker.recordActualCashFlow({
        futureCashFlowId: actualFor.recordId,
        stageId: actualFor.stageId,
        date: actualDate,
        amount: Number(actualAmount),
        direction: actualDirection,
      });
      setActualFor(null);
      setActualAmount("");
      setActualDirection("payment");
    });
  }
  return {
    ...tracker,
    eligibleAccounts,
    caseName,
    setCaseName,
    caseTargetDate,
    setCaseTargetDate,
    kind,
    setKind,
    name,
    setName,
    amount,
    setAmount,
    minimumAmount,
    setMinimumAmount,
    maximumAmount,
    setMaximumAmount,
    date,
    setDate,
    earliestDate,
    setEarliestDate,
    latestDate,
    setLatestDate,
    selectedAccountId,
    setAccountId,
    planningCaseId,
    setPlanningCaseId,
    labelText,
    setLabelText,
    importance,
    setImportance,
    confidence,
    setConfidence,
    dependencyId,
    setDependencyId,
    alternativeId,
    setAlternativeId,
    changeability,
    setChangeability,
    reversibility,
    setReversibility,
    refundable,
    setRefundable,
    actualFor,
    setActualFor,
    actualAmount,
    setActualAmount,
    actualDate,
    setActualDate,
    actualDirection,
    setActualDirection,
    error,
    submitting,
    caseNames,
    recordNames,
    run,
    handleCreateCase,
    handleAdd,
    handleActual,
  };
}

type FlowManager = ReturnType<typeof useFutureCashFlowManager>;

function PlanningCaseForm({ model }: Readonly<{ model: FlowManager }>) {
  return (
    <form
      onSubmit={model.handleCreateCase}
      className="grid gap-2 rounded-md bg-muted/35 p-3 sm:grid-cols-[1fr_10rem_auto] sm:items-end"
    >
      <FormField id="planning-case-name" label="New planning case">
        <Input
          id="planning-case-name"
          required
          placeholder="e.g. Summer plans"
          value={model.caseName}
          onChange={(event) => model.setCaseName(event.target.value)}
        />
      </FormField>
      <FormField id="planning-case-date" label="Target date (optional)">
        <Input
          id="planning-case-date"
          type="date"
          value={model.caseTargetDate}
          onChange={(event) => model.setCaseTargetDate(event.target.value)}
        />
      </FormField>
      <Button type="submit" variant="secondary" disabled={model.submitting}>
        Add case
      </Button>
    </form>
  );
}

function RecordIdentity({
  record,
  model,
}: Readonly<{
  record: FutureCashFlow;
  model: FlowManager;
}>) {
  return (
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium">{record.name}</p>
        <Badge variant="secondary">
          {record.kind === "commitment" ? "Commitment" : "Decision"}
        </Badge>
        <Badge variant="outline">{recordStatus(record)}</Badge>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {record.planningCaseId == null
          ? "Unassigned"
          : (model.caseNames.get(record.planningCaseId) ??
            record.planningCaseId)}
        {record.kind === "decision" && record.importance != null
          ? ` · ${record.importance}`
          : ""}
      </p>
    </div>
  );
}

function RecordActions({
  record,
  model,
}: Readonly<{
  record: FutureCashFlow;
  model: FlowManager;
}>) {
  return (
    <>
      {record.kind === "commitment" ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            model.run(() =>
              model.setCommitmentStatus(
                record.id,
                record.status === "active" ? "cancelled" : "active",
              ),
            )
          }
        >
          {record.status === "active" ? "Cancel" : "Reactivate"}
        </Button>
      ) : (
        <Select
          value={record.status}
          onValueChange={(status) =>
            model.run(() =>
              model.setCashFlowDecisionStatus(
                record.id,
                status as "considering" | "selected" | "declined",
              ),
            )
          }
        >
          <SelectTrigger
            aria-label={`Forecast status for ${record.name}`}
            size="sm"
            className="w-32"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="considering">Considering</SelectItem>
            <SelectItem value="selected">Include</SelectItem>
            <SelectItem value="declined">Set aside</SelectItem>
          </SelectContent>
        </Select>
      )}
      <DeleteRecordButton record={record} model={model} />
    </>
  );
}

function DeleteRecordButton({
  record,
  model,
}: Readonly<{ record: FutureCashFlow; model: FlowManager }>) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={`Delete ${record.name}`}
      onClick={() => model.run(() => model.deleteFutureCashFlow(record.id))}
    >
      <Trash2Icon />
    </Button>
  );
}

function RecordHeader({
  record,
  model,
}: Readonly<{
  record: FutureCashFlow;
  model: FlowManager;
}>) {
  return (
    <div className="flex flex-wrap items-start gap-2">
      <RecordIdentity record={record} model={model} />
      <RecordActions record={record} model={model} />
    </div>
  );
}

function StageRow({
  record,
  stageIndex,
  onRecord,
}: Readonly<{
  record: FutureCashFlow;
  stageIndex: number;
  onRecord(): void;
}>) {
  const stage = record.stages[stageIndex];
  if (!stage) return null;
  const netActual = stage.actuals.reduce(
    (total, actual) =>
      total + (actual.direction === "payment" ? actual.amount : -actual.amount),
    0,
  );
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span>{stage.name ?? `Stage ${stageIndex + 1}`}</span>
      <span>{stageDate(record, stageIndex)}</span>
      <span className="font-mono text-foreground">
        {formatCurrency(stageAmount(record, stageIndex), record.currency)}
      </span>
      {"minimumAmount" in stage && (
        <span>
          range {formatCurrency(stage.minimumAmount, record.currency)}–
          {formatCurrency(stage.maximumAmount, record.currency)}
        </span>
      )}
      {netActual !== 0 && (
        <span>actual {formatCurrency(netActual, record.currency)}</span>
      )}
      <Button
        type="button"
        variant="link"
        size="sm"
        className="h-auto p-0 text-xs"
        onClick={onRecord}
      >
        Record actual
      </Button>
    </div>
  );
}

function StageList({
  record,
  model,
}: Readonly<{
  record: FutureCashFlow;
  model: FlowManager;
}>) {
  return (
    <div className="grid gap-2">
      {record.stages.map((stage, stageIndex) => (
        <StageRow
          key={stage.id}
          record={record}
          stageIndex={stageIndex}
          onRecord={() =>
            model.setActualFor({ recordId: record.id, stageId: stage.id })
          }
        />
      ))}
    </div>
  );
}

function DecisionRelationships({
  record,
  model,
}: Readonly<{
  record: FutureCashFlow;
  model: FlowManager;
}>) {
  if (
    record.kind !== "decision" ||
    (record.dependencyIds.length === 0 && record.alternativeToIds.length === 0)
  )
    return null;
  return (
    <p className="text-xs text-muted-foreground">
      {record.dependencyIds.length > 0
        ? `Depends on ${record.dependencyIds.map((id) => model.recordNames.get(id) ?? id).join(", ")}. `
        : ""}
      {record.alternativeToIds.length > 0
        ? `Alternative to ${record.alternativeToIds.map((id) => model.recordNames.get(id) ?? id).join(", ")}.`
        : ""}
    </p>
  );
}

function ActualAmountField({
  record,
  model,
}: Readonly<{ record: FutureCashFlow; model: FlowManager }>) {
  return (
    <FormField id={`actual-amount-${record.id}`} label="Amount">
      <Input
        id={`actual-amount-${record.id}`}
        type="number"
        min="0.01"
        step="0.01"
        required
        value={model.actualAmount}
        onChange={(event) => model.setActualAmount(event.target.value)}
      />
    </FormField>
  );
}

function ActualDateField({
  record,
  model,
}: Readonly<{ record: FutureCashFlow; model: FlowManager }>) {
  return (
    <FormField id={`actual-date-${record.id}`} label="Date">
      <Input
        id={`actual-date-${record.id}`}
        type="date"
        max={todayIsoDate()}
        required
        value={model.actualDate}
        onChange={(event) => model.setActualDate(event.target.value)}
      />
    </FormField>
  );
}

function ActualDirectionField({
  record,
  model,
}: Readonly<{ record: FutureCashFlow; model: FlowManager }>) {
  return (
    <FormField id={`actual-direction-${record.id}`} label="Direction">
      <Select
        value={model.actualDirection}
        onValueChange={(value) =>
          model.setActualDirection(value as "payment" | "refund")
        }
      >
        <SelectTrigger id={`actual-direction-${record.id}`} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="payment">Payment</SelectItem>
          <SelectItem value="refund">Refund</SelectItem>
        </SelectContent>
      </Select>
    </FormField>
  );
}

function ActualCashFlowForm({
  record,
  model,
}: Readonly<{
  record: FutureCashFlow;
  model: FlowManager;
}>) {
  if (model.actualFor?.recordId !== record.id) return null;
  return (
    <form
      onSubmit={model.handleActual}
      className="grid gap-2 rounded-md bg-muted/35 p-2 sm:grid-cols-[8rem_9rem_9rem_auto] sm:items-end"
    >
      <ActualAmountField record={record} model={model} />
      <ActualDateField record={record} model={model} />
      <ActualDirectionField record={record} model={model} />
      <div className="flex gap-2">
        <Button type="submit" size="sm">
          Save
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => model.setActualFor(null)}
        >
          Close
        </Button>
      </div>
    </form>
  );
}

function FutureCashFlowRecord({
  record,
  model,
}: Readonly<{
  record: FutureCashFlow;
  model: FlowManager;
}>) {
  return (
    <li className="space-y-2 p-3 text-sm">
      <RecordHeader record={record} model={model} />
      <StageList record={record} model={model} />
      <DecisionRelationships record={record} model={model} />
      <ActualCashFlowForm record={record} model={model} />
    </li>
  );
}

function FutureCashFlowList({ model }: Readonly<{ model: FlowManager }>) {
  if (model.futureCashFlows.length === 0) return null;
  return (
    <ul className="divide-y rounded-md border">
      {model.futureCashFlows.map((record) => (
        <FutureCashFlowRecord key={record.id} record={record} model={model} />
      ))}
    </ul>
  );
}

function FlowPrimaryFields({ model }: Readonly<{ model: FlowManager }>) {
  return (
    <>
      <FormField id="future-flow-type" label="Type">
        <Select
          value={model.kind}
          onValueChange={(value) =>
            model.setKind(value as "commitment" | "decision")
          }
        >
          <SelectTrigger id="future-flow-type" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="commitment">Firm commitment</SelectItem>
            <SelectItem value="decision">Weighted decision</SelectItem>
          </SelectContent>
        </Select>
      </FormField>
      <FormField id="future-flow-name" label="Name">
        <Input
          id="future-flow-name"
          required
          value={model.name}
          onChange={(event) => model.setName(event.target.value)}
        />
      </FormField>
      <FormField
        id="future-flow-amount"
        label={model.kind === "commitment" ? "Amount" : "Expected amount"}
      >
        <Input
          id="future-flow-amount"
          type="number"
          min="0.01"
          step="0.01"
          required
          value={model.amount}
          onChange={(event) => model.setAmount(event.target.value)}
        />
      </FormField>
      <FormField
        id="future-flow-date"
        label={model.kind === "commitment" ? "Due date" : "Expected date"}
      >
        <Input
          id="future-flow-date"
          type="date"
          min={tomorrowIsoDate()}
          required
          value={model.date}
          onChange={(event) => model.setDate(event.target.value)}
        />
      </FormField>
    </>
  );
}

function FlowContextFields({ model }: Readonly<{ model: FlowManager }>) {
  return (
    <>
      <FormField id="future-flow-account" label="Pay from">
        <Select
          value={model.selectedAccountId}
          onValueChange={model.setAccountId}
        >
          <SelectTrigger id="future-flow-account" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {model.eligibleAccounts.map((account) => (
              <SelectItem key={account.id} value={account.id}>
                {account.name} · {account.currency}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
      <FormField id="future-flow-case" label="Planning case">
        <Select
          value={model.planningCaseId}
          onValueChange={model.setPlanningCaseId}
        >
          <SelectTrigger id="future-flow-case" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_SELECTION}>None</SelectItem>
            {model.planningCases.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
      <FormField
        id="future-flow-labels"
        label="Labels (comma separated)"
        className="sm:col-span-2"
      >
        <Input
          id="future-flow-labels"
          placeholder="priority, flexible"
          value={model.labelText}
          onChange={(event) => model.setLabelText(event.target.value)}
        />
      </FormField>
    </>
  );
}

function CommitmentFields({ model }: Readonly<{ model: FlowManager }>) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <FormField
        id="commitment-changeability"
        label="Changeability"
        className="w-40"
      >
        <Select
          value={model.changeability}
          onValueChange={(value) =>
            model.setChangeability(value as "fixed" | "variable")
          }
        >
          <SelectTrigger id="commitment-changeability" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="fixed">Fixed</SelectItem>
            <SelectItem value="variable">Can change</SelectItem>
          </SelectContent>
        </Select>
      </FormField>
      <label className="flex h-9 items-center gap-2 text-xs font-medium">
        <input
          type="checkbox"
          checked={model.refundable}
          onChange={(event) => model.setRefundable(event.target.checked)}
        />
        Refundable
      </label>
    </div>
  );
}

function DecisionAmountFields({ model }: Readonly<{ model: FlowManager }>) {
  return (
    <>
      <FormField id="decision-minimum" label="Minimum amount">
        <Input
          id="decision-minimum"
          type="number"
          min="0"
          step="0.01"
          placeholder="Same as expected"
          value={model.minimumAmount}
          onChange={(event) => model.setMinimumAmount(event.target.value)}
        />
      </FormField>
      <FormField id="decision-maximum" label="Maximum amount">
        <Input
          id="decision-maximum"
          type="number"
          min="0.01"
          step="0.01"
          placeholder="Same as expected"
          value={model.maximumAmount}
          onChange={(event) => model.setMaximumAmount(event.target.value)}
        />
      </FormField>
    </>
  );
}

function DecisionTimingFields({ model }: Readonly<{ model: FlowManager }>) {
  return (
    <>
      <FormField id="decision-earliest" label="Earliest date">
        <Input
          id="decision-earliest"
          type="date"
          value={model.earliestDate}
          onChange={(event) => model.setEarliestDate(event.target.value)}
        />
      </FormField>
      <FormField id="decision-latest" label="Latest date">
        <Input
          id="decision-latest"
          type="date"
          value={model.latestDate}
          onChange={(event) => model.setLatestDate(event.target.value)}
        />
      </FormField>
    </>
  );
}

function DecisionQualityFields({ model }: Readonly<{ model: FlowManager }>) {
  return (
    <>
      <FormField id="decision-importance" label="Importance">
        <Input
          id="decision-importance"
          placeholder="e.g. High, but flexible"
          value={model.importance}
          onChange={(event) => model.setImportance(event.target.value)}
        />
      </FormField>
      <FormField id="decision-confidence" label="Confidence %">
        <Input
          id="decision-confidence"
          type="number"
          min="0"
          max="100"
          value={model.confidence}
          onChange={(event) => model.setConfidence(event.target.value)}
        />
      </FormField>
      <FormField id="decision-reversibility" label="Reversibility">
        <Select
          value={model.reversibility}
          onValueChange={(value) =>
            model.setReversibility(value as FlowManager["reversibility"])
          }
        >
          <SelectTrigger id="decision-reversibility" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="reversible">Reversible</SelectItem>
            <SelectItem value="partly-reversible">Partly reversible</SelectItem>
            <SelectItem value="irreversible">Irreversible</SelectItem>
          </SelectContent>
        </Select>
      </FormField>
    </>
  );
}

function RelationshipSelect({
  id,
  label,
  value,
  onChange,
  model,
}: Readonly<{
  id: string;
  label: string;
  value: string;
  onChange(value: string): void;
  model: FlowManager;
}>) {
  return (
    <FormField id={id} label={label}>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_SELECTION}>Nothing</SelectItem>
          {model.futureCashFlows.map((record) => (
            <SelectItem key={record.id} value={record.id}>
              {record.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FormField>
  );
}

function DecisionRelationshipFields({
  model,
}: Readonly<{ model: FlowManager }>) {
  return (
    <>
      <RelationshipSelect
        id="decision-dependency"
        label="Depends on"
        value={model.dependencyId}
        onChange={model.setDependencyId}
        model={model}
      />
      <RelationshipSelect
        id="decision-alternative"
        label="Alternative to"
        value={model.alternativeId}
        onChange={model.setAlternativeId}
        model={model}
      />
    </>
  );
}

function DecisionFields({ model }: Readonly<{ model: FlowManager }>) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      <DecisionAmountFields model={model} />
      <DecisionTimingFields model={model} />
      <DecisionQualityFields model={model} />
      <DecisionRelationshipFields model={model} />
    </div>
  );
}

function AddFutureCashFlowForm({ model }: Readonly<{ model: FlowManager }>) {
  if (model.eligibleAccounts.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Add an open cash or liquid investment account before recording future
        cash flows.
      </p>
    );
  }
  return (
    <form onSubmit={model.handleAdd} className="grid gap-3">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <FlowPrimaryFields model={model} />
        <FlowContextFields model={model} />
      </div>
      {model.kind === "commitment" ? (
        <CommitmentFields model={model} />
      ) : (
        <DecisionFields model={model} />
      )}
      <Button type="submit" className="w-fit" disabled={model.submitting}>
        Add {model.kind}
      </Button>
    </form>
  );
}

export function FutureCashFlowManager() {
  const model = useFutureCashFlowManager();
  return (
    <div className="space-y-4 rounded-md border p-3">
      <div>
        <h4 className="text-sm font-medium">Future cash-flow choices</h4>
        <p className="text-xs text-muted-foreground">
          Track firm commitments and weighted decisions. Active commitments and
          selected decisions affect the forecast; a planning case is optional
          context, not a budget.
        </p>
      </div>
      <PlanningCaseForm model={model} />
      <FutureCashFlowList model={model} />
      <AddFutureCashFlowForm model={model} />
      {model.error && <p className="text-sm text-destructive">{model.error}</p>}
    </div>
  );
}
