"use client";

import { addDays, format, parseISO } from "date-fns";
import { Trash2Icon } from "lucide-react";
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
  if (record.kind === "commitment") {
    return record.status === "active" ? "Included" : "Cancelled";
  }
  if (record.status === "selected") return "Included";
  if (record.status === "declined") return "Set aside";
  return "Considering";
}

function stageAmount(record: FutureCashFlow, stageIndex: number): number {
  if (record.kind === "commitment") {
    return record.stages[stageIndex]?.amount ?? 0;
  }
  return record.stages[stageIndex]?.expectedAmount ?? 0;
}

function stageDate(record: FutureCashFlow, stageIndex: number): string {
  if (record.kind === "commitment") {
    return record.stages[stageIndex]?.dueDate ?? "";
  }
  return record.stages[stageIndex]?.expectedDate ?? "";
}

export function FutureCashFlowManager() {
  const {
    accounts,
    planningCases,
    futureCashFlows,
    createPlanningCase,
    addCommitment,
    addCashFlowDecision,
    setCashFlowDecisionStatus,
    setCommitmentStatus,
    recordActualCashFlow,
    deleteFutureCashFlow,
  } = useAssetTracker();
  const eligibleAccounts = useMemo(
    () =>
      accounts.filter(
        (account) =>
          account.isOpen &&
          !isLiability(account.assetType) &&
          accountLiquidity(account) !== "illiquid",
      ),
    [accounts],
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
  const caseNames = new Map(planningCases.map((item) => [item.id, item.name]));
  const recordNames = new Map(
    futureCashFlows.map((record) => [record.id, record.name]),
  );

  async function handleCreateCase(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await createPlanningCase({
        name: caseName,
        labels: [],
        ...(optional(caseTargetDate) == null
          ? {}
          : { targetDate: caseTargetDate }),
      });
      setCaseName("");
      setCaseTargetDate("");
    } catch (cause) {
      setError(formatAssetTrackerError(cause));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAdd(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedAccount == null) return;
    setSubmitting(true);
    setError(null);
    const expectedAmount = Number(amount);
    const common = {
      name,
      planningCaseId: selectedId(planningCaseId),
      labels: labels(labelText),
      currency: selectedAccount.currency,
    };
    try {
      if (kind === "commitment") {
        await addCommitment({
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
        await addCashFlowDecision({
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
    } catch (cause) {
      setError(formatAssetTrackerError(cause));
    } finally {
      setSubmitting(false);
    }
  }

  async function run(action: () => Promise<void>) {
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(formatAssetTrackerError(cause));
    }
  }

  async function handleActual(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (actualFor == null) return;
    await run(async () => {
      await recordActualCashFlow({
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

      <form
        onSubmit={handleCreateCase}
        className="grid gap-2 rounded-md bg-muted/35 p-3 sm:grid-cols-[1fr_10rem_auto] sm:items-end"
      >
        <div className="space-y-1.5">
          <label htmlFor="planning-case-name" className="text-xs font-medium">
            New planning case
          </label>
          <Input
            id="planning-case-name"
            required
            placeholder="e.g. Summer plans"
            value={caseName}
            onChange={(event) => setCaseName(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="planning-case-date" className="text-xs font-medium">
            Target date (optional)
          </label>
          <Input
            id="planning-case-date"
            type="date"
            value={caseTargetDate}
            onChange={(event) => setCaseTargetDate(event.target.value)}
          />
        </div>
        <Button type="submit" variant="secondary" disabled={submitting}>
          Add case
        </Button>
      </form>

      {futureCashFlows.length > 0 && (
        <ul className="divide-y rounded-md border">
          {
            // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: The discriminated union drives the compact controls for each record.
            futureCashFlows.map((record) => (
              <li key={record.id} className="space-y-2 p-3 text-sm">
                <div className="flex flex-wrap items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{record.name}</p>
                      <Badge variant="secondary">
                        {record.kind === "commitment"
                          ? "Commitment"
                          : "Decision"}
                      </Badge>
                      <Badge variant="outline">{recordStatus(record)}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {record.planningCaseId == null
                        ? "Unassigned"
                        : (caseNames.get(record.planningCaseId) ??
                          record.planningCaseId)}
                      {record.kind === "decision" && record.importance != null
                        ? ` · ${record.importance}`
                        : ""}
                    </p>
                  </div>
                  {record.kind === "commitment" ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        run(() =>
                          setCommitmentStatus(
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
                        run(() =>
                          setCashFlowDecisionStatus(
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
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Delete ${record.name}`}
                    onClick={() => run(() => deleteFutureCashFlow(record.id))}
                  >
                    <Trash2Icon />
                  </Button>
                </div>

                <div className="grid gap-2">
                  {record.stages.map((stage, stageIndex) => {
                    const netActual = stage.actuals.reduce(
                      (total, actual) =>
                        total +
                        (actual.direction === "payment"
                          ? actual.amount
                          : -actual.amount),
                      0,
                    );
                    return (
                      <div
                        key={stage.id}
                        className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"
                      >
                        <span>{stage.name ?? `Stage ${stageIndex + 1}`}</span>
                        <span>{stageDate(record, stageIndex)}</span>
                        <span className="font-mono text-foreground">
                          {formatCurrency(
                            stageAmount(record, stageIndex),
                            record.currency,
                          )}
                        </span>
                        {"minimumAmount" in stage && (
                          <span>
                            range{" "}
                            {formatCurrency(
                              stage.minimumAmount,
                              record.currency,
                            )}
                            –
                            {formatCurrency(
                              stage.maximumAmount,
                              record.currency,
                            )}
                          </span>
                        )}
                        {netActual !== 0 && (
                          <span>
                            actual {formatCurrency(netActual, record.currency)}
                          </span>
                        )}
                        <Button
                          type="button"
                          variant="link"
                          size="sm"
                          className="h-auto p-0 text-xs"
                          onClick={() =>
                            setActualFor({
                              recordId: record.id,
                              stageId: stage.id,
                            })
                          }
                        >
                          Record actual
                        </Button>
                      </div>
                    );
                  })}
                </div>

                {record.kind === "decision" &&
                  (record.dependencyIds.length > 0 ||
                    record.alternativeToIds.length > 0) && (
                    <p className="text-xs text-muted-foreground">
                      {record.dependencyIds.length > 0
                        ? `Depends on ${record.dependencyIds.map((id) => recordNames.get(id) ?? id).join(", ")}. `
                        : ""}
                      {record.alternativeToIds.length > 0
                        ? `Alternative to ${record.alternativeToIds.map((id) => recordNames.get(id) ?? id).join(", ")}.`
                        : ""}
                    </p>
                  )}

                {actualFor?.recordId === record.id && (
                  <form
                    onSubmit={handleActual}
                    className="grid gap-2 rounded-md bg-muted/35 p-2 sm:grid-cols-[8rem_9rem_9rem_auto] sm:items-end"
                  >
                    <div className="space-y-1">
                      <label
                        htmlFor={`actual-amount-${record.id}`}
                        className="text-xs"
                      >
                        Amount
                      </label>
                      <Input
                        id={`actual-amount-${record.id}`}
                        type="number"
                        min="0.01"
                        step="0.01"
                        required
                        value={actualAmount}
                        onChange={(event) =>
                          setActualAmount(event.target.value)
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <label
                        htmlFor={`actual-date-${record.id}`}
                        className="text-xs"
                      >
                        Date
                      </label>
                      <Input
                        id={`actual-date-${record.id}`}
                        type="date"
                        max={todayIsoDate()}
                        required
                        value={actualDate}
                        onChange={(event) => setActualDate(event.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <label
                        htmlFor={`actual-direction-${record.id}`}
                        className="text-xs"
                      >
                        Direction
                      </label>
                      <Select
                        value={actualDirection}
                        onValueChange={(value) =>
                          setActualDirection(value as "payment" | "refund")
                        }
                      >
                        <SelectTrigger
                          id={`actual-direction-${record.id}`}
                          className="w-full"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="payment">Payment</SelectItem>
                          <SelectItem value="refund">Refund</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex gap-2">
                      <Button type="submit" size="sm">
                        Save
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setActualFor(null)}
                      >
                        Close
                      </Button>
                    </div>
                  </form>
                )}
              </li>
            ))
          }
        </ul>
      )}

      {eligibleAccounts.length > 0 ? (
        <form onSubmit={handleAdd} className="grid gap-3">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <label htmlFor="future-flow-type" className="text-xs font-medium">
                Type
              </label>
              <Select
                value={kind}
                onValueChange={(value) =>
                  setKind(value as "commitment" | "decision")
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
            </div>
            <div className="space-y-1.5">
              <label htmlFor="future-flow-name" className="text-xs font-medium">
                Name
              </label>
              <Input
                id="future-flow-name"
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="future-flow-amount"
                className="text-xs font-medium"
              >
                {kind === "commitment" ? "Amount" : "Expected amount"}
              </label>
              <Input
                id="future-flow-amount"
                type="number"
                min="0.01"
                step="0.01"
                required
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="future-flow-date" className="text-xs font-medium">
                {kind === "commitment" ? "Due date" : "Expected date"}
              </label>
              <Input
                id="future-flow-date"
                type="date"
                min={tomorrowIsoDate()}
                required
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="future-flow-account"
                className="text-xs font-medium"
              >
                Pay from
              </label>
              <Select value={selectedAccountId} onValueChange={setAccountId}>
                <SelectTrigger id="future-flow-account" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {eligibleAccounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.name} · {account.currency}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="future-flow-case" className="text-xs font-medium">
                Planning case
              </label>
              <Select value={planningCaseId} onValueChange={setPlanningCaseId}>
                <SelectTrigger id="future-flow-case" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_SELECTION}>None</SelectItem>
                  {planningCases.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <label
                htmlFor="future-flow-labels"
                className="text-xs font-medium"
              >
                Labels (comma separated)
              </label>
              <Input
                id="future-flow-labels"
                placeholder="priority, flexible"
                value={labelText}
                onChange={(event) => setLabelText(event.target.value)}
              />
            </div>
          </div>

          {kind === "commitment" ? (
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-40 space-y-1.5">
                <label
                  htmlFor="commitment-changeability"
                  className="text-xs font-medium"
                >
                  Changeability
                </label>
                <Select
                  value={changeability}
                  onValueChange={(value) =>
                    setChangeability(value as "fixed" | "variable")
                  }
                >
                  <SelectTrigger
                    id="commitment-changeability"
                    className="w-full"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fixed">Fixed</SelectItem>
                    <SelectItem value="variable">Can change</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <label className="flex h-9 items-center gap-2 text-xs font-medium">
                <input
                  type="checkbox"
                  checked={refundable}
                  onChange={(event) => setRefundable(event.target.checked)}
                />
                Refundable
              </label>
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="decision-minimum"
                  className="text-xs font-medium"
                >
                  Minimum amount
                </label>
                <Input
                  id="decision-minimum"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Same as expected"
                  value={minimumAmount}
                  onChange={(event) => setMinimumAmount(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor="decision-maximum"
                  className="text-xs font-medium"
                >
                  Maximum amount
                </label>
                <Input
                  id="decision-maximum"
                  type="number"
                  min="0.01"
                  step="0.01"
                  placeholder="Same as expected"
                  value={maximumAmount}
                  onChange={(event) => setMaximumAmount(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor="decision-earliest"
                  className="text-xs font-medium"
                >
                  Earliest date
                </label>
                <Input
                  id="decision-earliest"
                  type="date"
                  value={earliestDate}
                  onChange={(event) => setEarliestDate(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor="decision-latest"
                  className="text-xs font-medium"
                >
                  Latest date
                </label>
                <Input
                  id="decision-latest"
                  type="date"
                  value={latestDate}
                  onChange={(event) => setLatestDate(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor="decision-importance"
                  className="text-xs font-medium"
                >
                  Importance
                </label>
                <Input
                  id="decision-importance"
                  placeholder="e.g. High, but flexible"
                  value={importance}
                  onChange={(event) => setImportance(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor="decision-confidence"
                  className="text-xs font-medium"
                >
                  Confidence %
                </label>
                <Input
                  id="decision-confidence"
                  type="number"
                  min="0"
                  max="100"
                  value={confidence}
                  onChange={(event) => setConfidence(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor="decision-reversibility"
                  className="text-xs font-medium"
                >
                  Reversibility
                </label>
                <Select
                  value={reversibility}
                  onValueChange={(value) =>
                    setReversibility(
                      value as
                        | "reversible"
                        | "partly-reversible"
                        | "irreversible",
                    )
                  }
                >
                  <SelectTrigger id="decision-reversibility" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="reversible">Reversible</SelectItem>
                    <SelectItem value="partly-reversible">
                      Partly reversible
                    </SelectItem>
                    <SelectItem value="irreversible">Irreversible</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor="decision-dependency"
                  className="text-xs font-medium"
                >
                  Depends on
                </label>
                <Select value={dependencyId} onValueChange={setDependencyId}>
                  <SelectTrigger id="decision-dependency" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_SELECTION}>Nothing</SelectItem>
                    {futureCashFlows.map((record) => (
                      <SelectItem key={record.id} value={record.id}>
                        {record.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor="decision-alternative"
                  className="text-xs font-medium"
                >
                  Alternative to
                </label>
                <Select value={alternativeId} onValueChange={setAlternativeId}>
                  <SelectTrigger id="decision-alternative" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_SELECTION}>Nothing</SelectItem>
                    {futureCashFlows.map((record) => (
                      <SelectItem key={record.id} value={record.id}>
                        {record.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <Button type="submit" className="w-fit" disabled={submitting}>
            Add {kind}
          </Button>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">
          Add an open cash or liquid investment account before recording future
          cash flows.
        </p>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
