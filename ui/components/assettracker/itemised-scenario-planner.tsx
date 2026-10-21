"use client";

import { addDays, addYears, format, parseISO } from "date-fns";
import { PlusIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { type SubmitEvent, useEffect, useMemo, useRef, useState } from "react";
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
  type DecisionStageGroup,
  type DecisionStageGroupUnresolvedCost,
  formatAssetTrackerError,
  isLiability,
  settledCashFlowAmount,
} from "@/lib/domain/assettracker";
import { useAssetTracker } from "./asset-tracker-provider";
import {
  ItemisedScenarioTimeline,
  type ScenarioTimelinePayment,
} from "./itemised-scenario-timeline";

const ITEMISED_SCENARIO_LABEL = "itemised-scenario";
const NEW_SCENARIO = "__new__";

type CostRow = {
  id?: string;
  groupId: string;
  accountId: string;
  name: string;
  amount: string;
  date: string;
  actuals: ActualCashFlow[];
};

type UnresolvedCostDraft = Omit<
  DecisionStageGroupUnresolvedCost,
  "amount" | "date"
> & {
  amount: string;
  date: string;
};

type CostGroup = Omit<DecisionStageGroup, "unresolvedCosts"> & {
  unresolvedCosts: UnresolvedCostDraft[];
};

function placeholderDate() {
  return format(addYears(parseISO(todayIsoDate()), 1), "yyyy-MM-dd");
}

function emptyGroups(): CostGroup[] {
  return [
    {
      id: "cost-group-1",
      name: "",
      status: "considering",
      unresolvedCosts: [],
    },
  ];
}

function emptyRows(accountId = ""): CostRow[] {
  return [
    {
      groupId: "cost-group-1",
      accountId,
      name: "",
      amount: "",
      date: placeholderDate(),
      actuals: [],
    },
  ];
}

function amountPaid(actuals: readonly ActualCashFlow[]): number {
  return settledCashFlowAmount(actuals);
}

function legacyGroupName(stageName: string | undefined, index: number) {
  const name = stageName?.trim() || `Cost ${index + 1}`;
  return (
    name.replace(
      /\s+(?:deposit|balance|instalment|installment|final(?:\s+(?:bill|instalment|installment))?|payment)(?:\b.*)?$/i,
      "",
    ) || name
  );
}

function uniqueGroupId(name: string, usedIds: Set<string>) {
  const root =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "cost-group";
  let id = root;
  let suffix = 2;
  while (usedIds.has(id)) {
    id = `${root}-${suffix}`;
    suffix += 1;
  }
  usedIds.add(id);
  return id;
}

type GroupDraftContext = {
  groupById: Map<string, CostGroup>;
  groups: CostGroup[];
  inferredIdByName: Map<string, string>;
  usedIds: Set<string>;
};

function inferredStageGroup(
  stage: CashFlowDecision["stages"][number],
  index: number,
  context: GroupDraftContext,
) {
  if (stage.groupId != null && context.groupById.has(stage.groupId)) {
    return stage.groupId;
  }
  const name = legacyGroupName(stage.name, index);
  const key = name.toLocaleLowerCase();
  const inferredId = context.inferredIdByName.get(key);
  if (inferredId != null) {
    const group = context.groupById.get(inferredId);
    if (stage.actuals.length > 0 && group?.status === "considering") {
      group.status = "committed";
    }
    return inferredId;
  }
  const id = stage.groupId ?? uniqueGroupId(name, context.usedIds);
  const group: CostGroup = {
    id,
    name,
    status: stage.actuals.length > 0 ? "committed" : "considering",
    unresolvedCosts: [],
  };
  context.groups.push(group);
  context.groupById.set(id, group);
  context.inferredIdByName.set(key, id);
  return id;
}

function scenarioDraft(existing: CashFlowDecision): {
  costs: CostRow[];
  groups: CostGroup[];
} {
  const groups = (existing.groups ?? []).map((group) => ({
    ...group,
    unresolvedCosts: (group.unresolvedCosts ?? []).map((cost) => ({
      ...cost,
      amount: cost.amount == null ? "" : String(cost.amount),
      date: cost.date ?? "",
    })),
  }));
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const inferredIdByName = new Map<string, string>();
  const usedIds = new Set(groups.map(({ id }) => id));
  const context = { groupById, groups, inferredIdByName, usedIds };
  const costs = existing.stages.map((stage, index) => {
    const groupId = inferredStageGroup(stage, index, context);
    return {
      id: stage.id,
      groupId,
      accountId: stage.direction === "payment" ? stage.fromAccountId : "",
      name: stage.name ?? "Payment",
      amount: String(stage.expectedAmount),
      date: stage.expectedDate,
      actuals: stage.actuals,
    };
  });
  return { costs, groups };
}

function itemisedScenarios(
  records: ReturnType<typeof useAssetTracker>["futureCashFlows"],
): CashFlowDecision[] {
  return records.filter(
    (record): record is CashFlowDecision =>
      record.kind === "decision" &&
      record.labels.includes(ITEMISED_SCENARIO_LABEL) &&
      record.stages.every((stage) => stage.direction === "payment"),
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
  const [groups, setGroups] = useState<CostGroup[]>(emptyGroups);
  const [costs, setCosts] = useState<CostRow[]>(() =>
    emptyRows(defaultAccountId),
  );
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [createdName, setCreatedName] = useState<string | null>(null);
  const [paymentFor, setPaymentFor] = useState<string | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(todayIsoDate);
  const [recordingPayment, setRecordingPayment] = useState(false);
  const loadedScenarioId = useRef<string | null>(null);

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
    if (loadedScenarioId.current !== existing.id) {
      loadedScenarioId.current = existing.id;
      setName(existing.name);
      const firstStage = existing.stages[0];
      setAccountId(
        firstStage?.direction === "payment"
          ? firstStage.fromAccountId
          : defaultAccountId,
      );
      const draft = scenarioDraft(existing);
      setGroups(draft.groups);
      setCosts(draft.costs);
      setSaved(false);
      setError(null);
      return;
    }
    const actualsByStage = new Map(
      existing.stages.map((stage) => [stage.id, stage.actuals]),
    );
    setCosts((current) => {
      let changed = false;
      const next = current.map((cost) => {
        if (cost.id == null) return cost;
        const actuals = actualsByStage.get(cost.id);
        if (actuals == null || actuals === cost.actuals) return cost;
        changed = true;
        return { ...cost, actuals };
      });
      return changed ? next : current;
    });
  }, [defaultAccountId, existing]);

  const account = eligibleAccounts.find(({ id }) => id === accountId);
  const currency = account?.currency ?? tracker.baseCurrency;
  const scheduledTotal = costs.reduce(
    (sum, cost) => sum + (Number(cost.amount) || 0),
    0,
  );
  const unresolvedTotal = groups.reduce(
    (sum, group) =>
      sum +
      group.unresolvedCosts.reduce(
        (groupSum, cost) => groupSum + (Number(cost.amount) || 0),
        0,
      ),
    0,
  );
  const total = scheduledTotal + unresolvedTotal;
  const paid = costs.reduce((sum, cost) => sum + amountPaid(cost.actuals), 0);
  const groupStatus = new Map(groups.map((group) => [group.id, group.status]));
  const committed =
    costs.reduce(
      (sum, cost) =>
        groupStatus.get(cost.groupId) === "committed"
          ? sum +
            Math.max((Number(cost.amount) || 0) - amountPaid(cost.actuals), 0)
          : sum,
      0,
    ) +
    groups.reduce(
      (sum, group) =>
        group.status === "committed"
          ? sum +
            group.unresolvedCosts.reduce(
              (groupSum, cost) => groupSum + (Number(cost.amount) || 0),
              0,
            )
          : sum,
      0,
    );
  const considering =
    costs.reduce(
      (sum, cost) =>
        groupStatus.get(cost.groupId) === "considering"
          ? sum +
            Math.max((Number(cost.amount) || 0) - amountPaid(cost.actuals), 0)
          : sum,
      0,
    ) +
    groups.reduce(
      (sum, group) =>
        group.status === "considering"
          ? sum +
            group.unresolvedCosts.reduce(
              (groupSum, cost) => groupSum + (Number(cost.amount) || 0),
              0,
            )
          : sum,
      0,
    );
  const unresolvedCosts = groups.flatMap((group) => group.unresolvedCosts);
  const missingPriceCount = unresolvedCosts.filter(
    (cost) => cost.amount === "",
  ).length;
  const missingDateCount = unresolvedCosts.filter(
    (cost) => cost.date === "",
  ).length;
  const timelinePayments: ScenarioTimelinePayment[] = costs.flatMap((cost) => {
    const amount = Number(cost.amount);
    const status = groupStatus.get(cost.groupId);
    return Number.isFinite(amount) && amount > 0 && status != null
      ? [
          {
            amount,
            date: cost.date,
            paid: amountPaid(cost.actuals),
            status,
          },
        ]
      : [];
  });
  const markChanged = () => setSaved(false);
  const changeName = (value: string) => {
    setName(value);
    markChanged();
  };
  const changeAccount = (value: string) => {
    setAccountId(value);
    if (existing == null) {
      setCosts((current) =>
        current.map((cost) =>
          cost.accountId === accountId ? { ...cost, accountId: value } : cost,
        ),
      );
    }
    markChanged();
  };
  const changeCostAccount = (index: number, value: string) => {
    updateCost(index, { accountId: value });
  };
  const updateCost = (index: number, change: Partial<CostRow>) => {
    markChanged();
    setCosts((current) =>
      current.map((cost, candidate) =>
        candidate === index ? { ...cost, ...change } : cost,
      ),
    );
  };
  const updateGroup = (id: string, change: Partial<CostGroup>) => {
    markChanged();
    setGroups((current) =>
      current.map((group) =>
        group.id === id ? { ...group, ...change } : group,
      ),
    );
  };
  const addCost = (groupId: string) => {
    setCosts((current) => [
      ...current,
      {
        groupId,
        accountId,
        name: "",
        amount: "",
        date: placeholderDate(),
        actuals: [],
      },
    ]);
    markChanged();
  };
  const addGroup = () => {
    const usedIds = new Set(groups.map(({ id }) => id));
    const id = uniqueGroupId("cost-group", usedIds);
    setGroups((current) => [
      ...current,
      { id, name: "", status: "considering", unresolvedCosts: [] },
    ]);
    setCosts((current) => [
      ...current,
      {
        groupId: id,
        accountId,
        name: "",
        amount: "",
        date: placeholderDate(),
        actuals: [],
      },
    ]);
    markChanged();
  };
  const addGroupWithMissingDetails = () => {
    const usedGroupIds = new Set(groups.map(({ id }) => id));
    const groupId = uniqueGroupId("cost-group", usedGroupIds);
    const usedCostIds = new Set(
      groups.flatMap((group) => group.unresolvedCosts.map(({ id }) => id)),
    );
    const costId = uniqueGroupId("unresolved-cost", usedCostIds);
    setGroups((current) => [
      ...current,
      {
        id: groupId,
        name: "",
        status: "considering",
        unresolvedCosts: [{ id: costId, name: "", amount: "", date: "" }],
      },
    ]);
    markChanged();
  };
  const addUnresolvedCost = (groupId: string) => {
    const usedIds = new Set(
      groups.flatMap((group) => group.unresolvedCosts.map(({ id }) => id)),
    );
    const id = uniqueGroupId("unresolved-cost", usedIds);
    setGroups((current) =>
      current.map((group) =>
        group.id === groupId
          ? {
              ...group,
              unresolvedCosts: [
                ...group.unresolvedCosts,
                { id, name: "", amount: "", date: "" },
              ],
            }
          : group,
      ),
    );
    markChanged();
  };
  const updateUnresolvedCost = (
    groupId: string,
    id: string,
    change: Partial<UnresolvedCostDraft>,
  ) => {
    setGroups((current) =>
      current.map((group) =>
        group.id === groupId
          ? {
              ...group,
              unresolvedCosts: group.unresolvedCosts.map((cost) =>
                cost.id === id ? { ...cost, ...change } : cost,
              ),
            }
          : group,
      ),
    );
    markChanged();
  };
  const removeUnresolvedCost = (groupId: string, id: string) => {
    setGroups((current) =>
      current.map((group) =>
        group.id === groupId
          ? {
              ...group,
              unresolvedCosts: group.unresolvedCosts.filter(
                (cost) => cost.id !== id,
              ),
            }
          : group,
      ),
    );
    markChanged();
  };
  const removeCost = (index: number) => {
    const removedGroupId = costs[index]?.groupId;
    const remaining = costs.filter((_, candidate) => candidate !== index);
    setCosts(remaining);
    if (
      removedGroupId != null &&
      !remaining.some(({ groupId }) => groupId === removedGroupId) &&
      groups.find(({ id }) => id === removedGroupId)?.unresolvedCosts.length ===
        0
    ) {
      setGroups((current) => current.filter(({ id }) => id !== removedGroupId));
    }
    markChanged();
  };
  const startNewScenario = () => {
    loadedScenarioId.current = null;
    setSelectedId(NEW_SCENARIO);
    setName("");
    setAccountId(defaultAccountId);
    setGroups(emptyGroups());
    setCosts(emptyRows(defaultAccountId));
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
      groups: groups.map((group) => ({
        id: group.id,
        name: group.name,
        status: group.status,
        ...(group.unresolvedCosts.length === 0
          ? {}
          : {
              unresolvedCosts: group.unresolvedCosts.map((cost) => ({
                id: cost.id,
                name: cost.name,
                ...(cost.amount === "" ? {} : { amount: Number(cost.amount) }),
                ...(cost.date === "" ? {} : { date: cost.date }),
              })),
            }),
      })),
      stages: costs.map((cost) => ({
        ...(cost.id == null ? {} : { id: cost.id }),
        name: cost.name,
        groupId: cost.groupId,
        fromAccountId: cost.accountId || account.id,
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
    addGroup,
    addGroupWithMissingDetails,
    addUnresolvedCost,
    changeAccount,
    changeCostAccount,
    changeName,
    costs,
    groups,
    currency,
    eligibleAccounts,
    error,
    existing,
    name,
    paymentAmount,
    paymentDate,
    paymentFor,
    paid,
    recordPayment,
    recordingPayment,
    removeCost,
    removeUnresolvedCost,
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
    missingDateCount,
    missingPriceCount,
    committed,
    considering,
    timelinePayments,
    updateCost,
    updateGroup,
    updateUnresolvedCost,
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
            onValueChange={(value) =>
              value === NEW_SCENARIO
                ? planner.startNewScenario()
                : planner.setSelectedId(value)
            }
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
        <span>Default pay from</span>
        <Select value={planner.accountId} onValueChange={planner.changeAccount}>
          <SelectTrigger aria-label="Default pay from" className="w-full">
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
        <p className="font-normal text-muted-foreground">
          Used for new payments. Each scheduled payment can be assigned below.
        </p>
      </div>
    </div>
  );
}

function CostInputs({
  cost,
  currency,
  index,
  planner,
  update,
}: Readonly<{
  cost: CostRow;
  currency: Currency;
  index: number;
  planner: Planner;
  update: Planner["updateCost"];
}>) {
  const label = cost.name || `Cost ${index + 1}`;
  const paid = amountPaid(cost.actuals);
  const isPaid = Number(cost.amount) > 0 && paid >= Number(cost.amount);
  const fundingAccount = planner.eligibleAccounts.find(
    (account) => account.id === cost.accountId,
  );
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
      {isPaid ? (
        <output
          aria-label={`${label} final amount`}
          className="flex h-9 items-center gap-2 px-1 text-sm"
        >
          <span className="font-mono font-semibold">
            {formatCurrency(paid, currency)}
          </span>
          <span className="text-xs text-muted-foreground">Final</span>
        </output>
      ) : (
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
      )}
      {isPaid ? (
        <output
          aria-label={`${label} paid from`}
          className="flex h-9 items-center px-1 text-sm"
        >
          {fundingAccount?.name ?? "Account unavailable"}
        </output>
      ) : (
        <Select
          value={cost.accountId}
          onValueChange={(value) => planner.changeCostAccount(index, value)}
        >
          <SelectTrigger aria-label={`${label} pay from`} className="w-full">
            <SelectValue placeholder="Choose account" />
          </SelectTrigger>
          <SelectContent>
            {planner.eligibleAccounts
              .filter((account) => account.currency === currency)
              .map((account) => (
                <SelectItem key={account.id} value={account.id}>
                  {account.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      )}
    </>
  );
}

function PaymentSummary({
  cost,
  currency,
  onStart,
}: Readonly<{ cost: CostRow; currency: Currency; onStart: () => void }>) {
  const paid = amountPaid(cost.actuals);
  const isPaid = Number(cost.amount) > 0 && paid >= Number(cost.amount);
  return (
    <div className="text-xs text-muted-foreground">
      <span className="block font-mono text-foreground">
        {formatCurrency(paid, currency)}
      </span>
      {isPaid ? (
        <span>Paid in full</span>
      ) : (
        cost.id != null && (
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs"
            onClick={onStart}
          >
            Record payment
          </Button>
        )
      )}
    </div>
  );
}

function PaymentEditor({
  cost,
  planner,
}: Readonly<{ cost: CostRow & { id: string }; planner: Planner }>) {
  return (
    <div className="grid gap-2 rounded-md bg-muted/35 p-3 sm:col-span-6 sm:grid-cols-[8rem_10rem_auto] sm:items-end">
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
  const costLabel = cost.name || `cost ${index + 1}`;
  return (
    <div className="grid gap-2 p-3 sm:grid-cols-[minmax(10rem,1fr)_9rem_8rem_minmax(10rem,12rem)_7rem_2.5rem] sm:items-center">
      <CostInputs
        cost={cost}
        currency={planner.currency}
        index={index}
        planner={planner}
        update={planner.updateCost}
      />
      <PaymentSummary
        cost={cost}
        currency={planner.currency}
        onStart={() => planner.startPayment(cost)}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`Remove ${costLabel}`}
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
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={planner.addGroup}
        >
          <PlusIcon />
          Add scheduled cost
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={planner.addGroupWithMissingDetails}
        >
          <PlusIcon />
          Add cost with missing details
        </Button>
      </div>
      <p className="text-sm">
        Total{" "}
        <span className="font-semibold">
          {formatCurrency(planner.total, planner.currency)}
        </span>
      </p>
    </div>
  );
}

function ScenarioSummary({ planner }: Readonly<{ planner: Planner }>) {
  const items = [
    ["Total estimate", planner.total],
    ["Paid", planner.paid],
    ["Committed remaining", planner.committed],
    ["Under consideration", planner.considering],
  ] as const;
  return (
    <div className="space-y-2">
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {items.map(([label, value]) => (
          <div key={label} className="rounded-lg border p-3">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-1 font-mono text-lg font-semibold">
              {formatCurrency(value, planner.currency)}
            </dd>
          </div>
        ))}
      </dl>
      {(planner.missingPriceCount > 0 || planner.missingDateCount > 0) && (
        <p className="text-xs text-muted-foreground" role="status">
          Needs details: {planner.missingPriceCount}{" "}
          {planner.missingPriceCount === 1 ? "cost needs" : "costs need"} a
          price · {planner.missingDateCount}{" "}
          {planner.missingDateCount === 1 ? "cost needs" : "costs need"} a due
          date. Unknown amounts are not included in the total; costs without a
          date are not plotted on the timeline.
        </p>
      )}
    </div>
  );
}

function ScenarioFundingCallout({ planner }: Readonly<{ planner: Planner }>) {
  if (planner.existing == null) return null;
  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h3 className="text-sm font-semibold">Check funding health</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          The comparison projects each chosen account after income, spending,
          scheduled payments, and investment returns. It also flags reserve
          pressure, account shortfalls, monthly saving needs, and asset sales.
        </p>
      </div>
      <Button asChild type="button" variant="outline">
        <Link href="/assettracker/decisions?tab=compare">
          View cash and reserve impact
        </Link>
      </Button>
    </div>
  );
}

function UnresolvedCostEditor({
  cost,
  group,
  planner,
}: Readonly<{
  cost: UnresolvedCostDraft;
  group: CostGroup;
  planner: Planner;
}>) {
  const label = cost.name || "Cost needing details";
  return (
    <div className="grid gap-2 p-3 sm:grid-cols-[minmax(10rem,1fr)_9rem_8rem_7rem_2.5rem] sm:items-center">
      <Input
        aria-label={`${group.name} unresolved cost name`}
        placeholder="Remaining balance"
        required
        value={cost.name}
        onChange={(event) =>
          planner.updateUnresolvedCost(group.id, cost.id, {
            name: event.target.value,
          })
        }
      />
      <Input
        aria-label={`${label} due date`}
        type="date"
        value={cost.date}
        onChange={(event) =>
          planner.updateUnresolvedCost(group.id, cost.id, {
            date: event.target.value,
          })
        }
      />
      <Input
        aria-label={`${label} amount`}
        type="number"
        min="0.01"
        step="0.01"
        placeholder="Unknown"
        value={cost.amount}
        onChange={(event) =>
          planner.updateUnresolvedCost(group.id, cost.id, {
            amount: event.target.value,
          })
        }
      />
      <div className="text-xs text-muted-foreground">
        {cost.amount === "" && <span className="block">Price needed</span>}
        {cost.date === "" && <span className="block">Date needed</span>}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`Remove ${label}`}
        onClick={() => planner.removeUnresolvedCost(group.id, cost.id)}
      >
        <Trash2Icon />
      </Button>
    </div>
  );
}

function CostGroupEditor({
  group,
  groupIndex,
  planner,
}: Readonly<{
  group: CostGroup;
  groupIndex: number;
  planner: Planner;
}>) {
  const rows = planner.costs.flatMap((cost, index) =>
    cost.groupId === group.id ? [{ cost, index }] : [],
  );
  const total =
    rows.reduce((sum, { cost }) => sum + (Number(cost.amount) || 0), 0) +
    group.unresolvedCosts.reduce(
      (sum, cost) => sum + (Number(cost.amount) || 0),
      0,
    );
  const hasNoCost = rows.length === 0 && group.unresolvedCosts.length === 0;
  const label = group.name || `Cost group ${groupIndex + 1}`;
  const nameInputId = `scenario-cost-group-${group.id}`;
  return (
    <section className="overflow-hidden rounded-lg border">
      <div className="grid gap-3 border-b bg-muted/20 p-3 sm:grid-cols-[minmax(12rem,1fr)_12rem_auto] sm:items-end">
        <label htmlFor={nameInputId} className="space-y-1 text-xs font-medium">
          <span>Supplier or cost</span>
          <Input
            id={nameInputId}
            aria-label={`Cost group ${groupIndex + 1} name`}
            required
            placeholder="Venue, catering, photographer..."
            value={group.name}
            onChange={(event) =>
              planner.updateGroup(group.id, { name: event.target.value })
            }
          />
        </label>
        <div className="space-y-1 text-xs font-medium">
          <span>Status</span>
          <Select
            value={group.status}
            onValueChange={(value: CostGroup["status"]) =>
              planner.updateGroup(group.id, { status: value })
            }
          >
            <SelectTrigger aria-label={`${label} status`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="committed">Committed</SelectItem>
              <SelectItem value="considering">Under consideration</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="pb-1 text-right text-xs text-muted-foreground">
          {hasNoCost ? (
            <span className="text-sm font-medium text-foreground">No cost</span>
          ) : (
            <>
              <span className="block">
                {rows.length} {rows.length === 1 ? "payment" : "payments"}
              </span>
              {group.unresolvedCosts.length > 0 && (
                <span className="block">
                  {group.unresolvedCosts.length}{" "}
                  {group.unresolvedCosts.length === 1
                    ? "cost needs"
                    : "costs need"}{" "}
                  details
                </span>
              )}
              <span className="font-mono text-sm font-semibold text-foreground">
                {formatCurrency(total, planner.currency)}
              </span>
            </>
          )}
        </div>
      </div>
      {rows.length > 0 && (
        <>
          <div className="hidden grid-cols-[minmax(10rem,1fr)_9rem_8rem_minmax(10rem,12rem)_7rem_2.5rem] gap-2 border-b px-3 py-2 text-xs font-medium text-muted-foreground sm:grid">
            <span>Payment</span>
            <span>Due date</span>
            <span>Amount</span>
            <span>Pay from</span>
            <span>Paid</span>
            <span className="sr-only">Actions</span>
          </div>
          <div className="divide-y">
            {rows.map(({ cost, index }) => (
              <CostRowEditor
                key={cost.id ?? `new-${index}`}
                cost={cost}
                index={index}
                planner={planner}
              />
            ))}
          </div>
        </>
      )}
      {group.unresolvedCosts.length > 0 && (
        <div className="border-t bg-muted/10">
          <div className="grid gap-2 border-b px-3 py-2 text-xs font-medium text-muted-foreground sm:grid-cols-[minmax(10rem,1fr)_9rem_8rem_7rem_2.5rem]">
            <span>Cost needing details</span>
            <span>Due date (optional)</span>
            <span>Estimate (optional)</span>
            <span>Missing details</span>
            <span className="sr-only">Actions</span>
          </div>
          <div className="divide-y">
            {group.unresolvedCosts.map((cost) => (
              <UnresolvedCostEditor
                key={cost.id}
                cost={cost}
                group={group}
                planner={planner}
              />
            ))}
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-1 border-t px-3 py-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => planner.addCost(group.id)}
        >
          <PlusIcon />
          Add payment
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => planner.addUnresolvedCost(group.id)}
        >
          <PlusIcon />
          Add cost needing details
        </Button>
      </div>
    </section>
  );
}

function ScenarioCosts({ planner }: Readonly<{ planner: Planner }>) {
  return (
    <div className="space-y-3">
      {planner.groups.map((group, groupIndex) => (
        <CostGroupEditor
          key={group.id}
          group={group}
          groupIndex={groupIndex}
          planner={planner}
        />
      ))}
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
      <ScenarioSummary planner={planner} />
      <ScenarioFundingCallout planner={planner} />
      <ItemisedScenarioTimeline
        currency={planner.currency}
        payments={planner.timelinePayments}
      />
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
