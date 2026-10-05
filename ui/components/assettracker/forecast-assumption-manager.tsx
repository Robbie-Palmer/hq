"use client";

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
  equalSharedOwnership,
  type ForecastAssumption,
  type ForecastAssumptionSet,
  formatAssetTrackerError,
  isLiability,
  personalOwnership,
} from "@/lib/domain/assettracker";
import { useAssetTracker } from "./asset-tracker-provider";

const HOUSEHOLD_OWNER = "__household__";

function optional(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function numberOr(value: string, fallback: number): number {
  return optional(value) == null ? fallback : Number(value);
}

function sourceLabel(assumption: ForecastAssumption): string {
  if (assumption.source.kind === "manual-take-home")
    return "Manual take-home income";
  if (assumption.source.kind === "tax-derived") {
    return `${assumption.source.taxYear} tax rules · dataset ${assumption.source.ruleDatasetVersion}`;
  }
  return "Manual assumption";
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

function AssumptionRow({
  assumption,
  canDelete,
  onDelete,
}: Readonly<{
  assumption: ForecastAssumption;
  canDelete: boolean;
  onDelete(): void;
}>) {
  return (
    <li className="flex flex-wrap items-start gap-2 py-2 text-xs">
      <div className="min-w-0 flex-1">
        <p className="font-medium text-foreground">{assumption.name}</p>
        <p className="text-muted-foreground">
          {assumption.kind === "income" ? "Income" : "Expenditure"} ·{" "}
          {assumption.startDate}
          {assumption.endDate == null ? " onward" : ` to ${assumption.endDate}`}
        </p>
        <p className="text-muted-foreground">
          {sourceLabel(assumption)}
          {assumption.sourceNotes == null ? "" : ` · ${assumption.sourceNotes}`}
        </p>
      </div>
      <div className="text-right font-mono">
        <p>
          {formatCurrency(
            assumption.monthlyChange.expected,
            assumption.currency,
          )}
          /mo
        </p>
        <p className="text-muted-foreground">
          {formatCurrency(
            assumption.monthlyChange.minimum,
            assumption.currency,
          )}
          –
          {formatCurrency(
            assumption.monthlyChange.maximum,
            assumption.currency,
          )}
        </p>
      </div>
      {canDelete && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Delete assumption ${assumption.name}`}
          onClick={onDelete}
        >
          <Trash2Icon />
        </Button>
      )}
    </li>
  );
}

function AssumptionSetHeader({
  set,
  onVersion,
}: Readonly<{
  set: ForecastAssumptionSet;
  onVersion(): void;
}>) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <p className="font-medium">{set.name}</p>
      <Badge variant="outline">v{set.version}</Badge>
      <Badge variant={set.status === "active" ? "secondary" : "outline"}>
        {set.status === "active" ? "Active" : "Superseded"}
      </Badge>
      {set.status === "active" && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="ml-auto"
          onClick={onVersion}
        >
          Create next version
        </Button>
      )}
    </div>
  );
}

function AssumptionSetSummary({
  set,
  onVersion,
  onDelete,
}: Readonly<{
  set: ForecastAssumptionSet;
  onVersion(id: string): void;
  onDelete(setId: string, assumptionId: string): void;
}>) {
  return (
    <div className="space-y-2 rounded-md border p-3">
      <AssumptionSetHeader set={set} onVersion={() => onVersion(set.id)} />
      {set.assumptions.length === 0 ? (
        <p className="text-xs text-muted-foreground">No changes in this set.</p>
      ) : (
        <ul className="divide-y">
          {set.assumptions.map((assumption) => (
            <AssumptionRow
              key={assumption.id}
              assumption={assumption}
              canDelete={set.status === "active"}
              onDelete={() => onDelete(set.id, assumption.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function useForecastAssumptionManager() {
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
  const activeSets = tracker.forecastAssumptionSets.filter(
    ({ status }) => status === "active",
  );
  const [newSetName, setNewSetName] = useState("");
  const [setId, setSetId] = useState("");
  const [kind, setKind] = useState<"income" | "expenditure">("income");
  const [name, setName] = useState("");
  const [expected, setExpected] = useState("");
  const [minimum, setMinimum] = useState("");
  const [maximum, setMaximum] = useState("");
  const [startDate, setStartDate] = useState(todayIsoDate);
  const [endDate, setEndDate] = useState("");
  const [accountId, setAccountId] = useState("");
  const [ownerId, setOwnerId] = useState(HOUSEHOLD_OWNER);
  const [sourceKind, setSourceKind] = useState<
    "manual-take-home" | "manual" | "tax-derived"
  >("manual-take-home");
  const [confidence, setConfidence] = useState("");
  const [sourceNotes, setSourceNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const selectedSetId = activeSets.some(({ id }) => id === setId)
    ? setId
    : (activeSets[0]?.id ?? "");
  const selectedAccountId = eligibleAccounts.some(({ id }) => id === accountId)
    ? accountId
    : (eligibleAccounts[0]?.id ?? "");
  const selectedAccount = eligibleAccounts.find(
    ({ id }) => id === selectedAccountId,
  );
  async function run(action: () => Promise<void>) {
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(formatAssetTrackerError(cause));
    }
  }
  async function handleCreateSet(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    await run(async () => {
      await tracker.createForecastAssumptionSet({ name: newSetName });
      setNewSetName("");
    });
    setSubmitting(false);
  }
  async function handleAdd(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedSetId === "" || (kind === "income" && !selectedAccount)) return;
    const expectedChange = Number(expected);
    const ownership =
      ownerId === HOUSEHOLD_OWNER
        ? equalSharedOwnership(tracker.household.members)
        : personalOwnership(ownerId);
    const source =
      sourceKind === "tax-derived"
        ? {
            kind: "tax-derived" as const,
            taxYear: tracker.taxEstimate.taxYear,
            calculationVersion: tracker.taxEstimate.calculationVersion,
            ruleDatasetVersion: tracker.taxEstimate.lineage.ruleDatasetVersion,
          }
        : { kind: sourceKind };
    setSubmitting(true);
    await run(async () => {
      await tracker.addForecastAssumption({
        setId: selectedSetId,
        name,
        kind,
        startDate,
        endDate: optional(endDate),
        monthlyChange: {
          minimum: numberOr(minimum, expectedChange),
          expected: expectedChange,
          maximum: numberOr(maximum, expectedChange),
        },
        currency:
          selectedAccount?.currency ?? tracker.accounts[0]?.currency ?? "GBP",
        confidence:
          optional(confidence) == null ? undefined : Number(confidence) / 100,
        ownership,
        accountId: kind === "income" ? selectedAccountId : undefined,
        source,
        sourceNotes: optional(sourceNotes),
      });
      setName("");
      setExpected("");
      setMinimum("");
      setMaximum("");
      setEndDate("");
      setConfidence("");
      setSourceNotes("");
    });
    setSubmitting(false);
  }
  return {
    ...tracker,
    eligibleAccounts,
    activeSets,
    newSetName,
    setNewSetName,
    selectedSetId,
    setSetId,
    kind,
    setKind,
    name,
    setName,
    expected,
    setExpected,
    minimum,
    setMinimum,
    maximum,
    setMaximum,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    selectedAccountId,
    setAccountId,
    ownerId,
    setOwnerId,
    sourceKind,
    setSourceKind,
    confidence,
    setConfidence,
    sourceNotes,
    setSourceNotes,
    error,
    submitting,
    run,
    handleCreateSet,
    handleAdd,
  };
}

type ForecastManager = ReturnType<typeof useForecastAssumptionManager>;

function CreateAssumptionSetForm({
  model,
}: Readonly<{ model: ForecastManager }>) {
  return (
    <form
      onSubmit={model.handleCreateSet}
      className="flex flex-col gap-2 rounded-md bg-muted/35 p-3 sm:flex-row sm:items-end"
    >
      <FormField
        id="assumption-set-name"
        label="New reusable assumption set"
        className="flex-1"
      >
        <Input
          id="assumption-set-name"
          required
          placeholder="e.g. Household baseline"
          value={model.newSetName}
          onChange={(event) => model.setNewSetName(event.target.value)}
        />
      </FormField>
      <Button type="submit" variant="secondary" disabled={model.submitting}>
        Add set
      </Button>
    </form>
  );
}

function AssumptionIdentityFields({
  model,
}: Readonly<{ model: ForecastManager }>) {
  return (
    <>
      <FormField id="assumption-set" label="Assumption set">
        <Select value={model.selectedSetId} onValueChange={model.setSetId}>
          <SelectTrigger id="assumption-set" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {model.activeSets.map((set) => (
              <SelectItem key={set.id} value={set.id}>
                {set.name} · v{set.version}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
      <FormField id="assumption-kind" label="Change to">
        <Select
          value={model.kind}
          onValueChange={(value) => {
            const nextKind = value as "income" | "expenditure";
            model.setKind(nextKind);
            if (nextKind === "expenditure") model.setSourceKind("manual");
          }}
        >
          <SelectTrigger id="assumption-kind" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="income">Income</SelectItem>
            <SelectItem value="expenditure">Expenditure</SelectItem>
          </SelectContent>
        </Select>
      </FormField>
      <FormField id="assumption-name" label="Name" className="sm:col-span-2">
        <Input
          id="assumption-name"
          required
          placeholder="e.g. Reduced working hours"
          value={model.name}
          onChange={(event) => model.setName(event.target.value)}
        />
      </FormField>
    </>
  );
}

function AssumptionAmountFields({
  model,
}: Readonly<{ model: ForecastManager }>) {
  return (
    <>
      <FormField id="assumption-expected" label="Expected monthly change">
        <Input
          id="assumption-expected"
          type="number"
          step="0.01"
          required
          value={model.expected}
          onChange={(event) => model.setExpected(event.target.value)}
        />
      </FormField>
      <FormField id="assumption-minimum" label="Minimum">
        <Input
          id="assumption-minimum"
          type="number"
          step="0.01"
          placeholder="Same as expected"
          value={model.minimum}
          onChange={(event) => model.setMinimum(event.target.value)}
        />
      </FormField>
      <FormField id="assumption-maximum" label="Maximum">
        <Input
          id="assumption-maximum"
          type="number"
          step="0.01"
          placeholder="Same as expected"
          value={model.maximum}
          onChange={(event) => model.setMaximum(event.target.value)}
        />
      </FormField>
      <FormField id="assumption-confidence" label="Confidence % (optional)">
        <Input
          id="assumption-confidence"
          type="number"
          min="0"
          max="100"
          value={model.confidence}
          onChange={(event) => model.setConfidence(event.target.value)}
        />
      </FormField>
    </>
  );
}

function AssumptionTimingFields({
  model,
}: Readonly<{ model: ForecastManager }>) {
  return (
    <>
      <FormField id="assumption-start" label="Starts">
        <Input
          id="assumption-start"
          type="date"
          required
          value={model.startDate}
          onChange={(event) => model.setStartDate(event.target.value)}
        />
      </FormField>
      <FormField id="assumption-end" label="Ends (optional)">
        <Input
          id="assumption-end"
          type="date"
          value={model.endDate}
          onChange={(event) => model.setEndDate(event.target.value)}
        />
      </FormField>
    </>
  );
}

function AssumptionAccountField({
  model,
}: Readonly<{ model: ForecastManager }>) {
  if (model.kind !== "income") return null;
  return (
    <FormField id="assumption-account" label="Paid into">
      <Select
        value={model.selectedAccountId}
        onValueChange={model.setAccountId}
      >
        <SelectTrigger id="assumption-account" className="w-full">
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
  );
}

function AssumptionOwnerField({ model }: Readonly<{ model: ForecastManager }>) {
  return (
    <FormField id="assumption-owner" label="Applies to">
      <Select value={model.ownerId} onValueChange={model.setOwnerId}>
        <SelectTrigger id="assumption-owner" className="w-full">
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
    </FormField>
  );
}

function AssumptionSourceField({
  model,
}: Readonly<{ model: ForecastManager }>) {
  return (
    <FormField id="assumption-source" label="Source">
      <Select
        value={model.sourceKind}
        onValueChange={(value) =>
          model.setSourceKind(value as ForecastManager["sourceKind"])
        }
      >
        <SelectTrigger id="assumption-source" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {model.kind === "income" && (
            <SelectItem value="manual-take-home">
              Manual take-home income
            </SelectItem>
          )}
          <SelectItem value="manual">Manual estimate</SelectItem>
          {model.kind === "income" && (
            <SelectItem value="tax-derived">
              {model.taxEstimate.taxYear} tax estimate
            </SelectItem>
          )}
        </SelectContent>
      </Select>
    </FormField>
  );
}

function AssumptionScopeFields({
  model,
}: Readonly<{ model: ForecastManager }>) {
  return (
    <>
      <AssumptionAccountField model={model} />
      <AssumptionOwnerField model={model} />
      <AssumptionSourceField model={model} />
      <FormField
        id="assumption-notes"
        label="Source notes (optional)"
        className="sm:col-span-2"
      >
        <Input
          id="assumption-notes"
          value={model.sourceNotes}
          onChange={(event) => model.setSourceNotes(event.target.value)}
        />
      </FormField>
    </>
  );
}

function AssumptionForm({ model }: Readonly<{ model: ForecastManager }>) {
  return (
    <form onSubmit={model.handleAdd} className="grid gap-3">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <AssumptionIdentityFields model={model} />
        <AssumptionAmountFields model={model} />
        <AssumptionTimingFields model={model} />
        <AssumptionScopeFields model={model} />
      </div>
      <p className="text-xs text-muted-foreground">
        Use negative values for a reduction. Minimum and maximum remain a range;
        the forecast does not assign probabilities to them.
      </p>
      <Button type="submit" className="w-fit" disabled={model.submitting}>
        Add forecast change
      </Button>
    </form>
  );
}

export function ForecastAssumptionManager() {
  const model = useForecastAssumptionManager();
  return (
    <div className="space-y-4 rounded-md border p-3">
      <div>
        <h4 className="text-sm font-medium">Household forecast assumptions</h4>
        <p className="text-xs text-muted-foreground">
          Describe changes from the reconciled income and ordinary-expenditure
          baseline. These are monthly changes, not category limits or budgets.
        </p>
      </div>
      <CreateAssumptionSetForm model={model} />
      {model.forecastAssumptionSets.length > 0 && (
        <div className="grid gap-2">
          {model.forecastAssumptionSets.map((set) => (
            <AssumptionSetSummary
              key={set.id}
              set={set}
              onVersion={(id) =>
                model.run(() => model.versionForecastAssumptionSet(id))
              }
              onDelete={(setId, assumptionId) =>
                model.run(() =>
                  model.deleteForecastAssumption(setId, assumptionId),
                )
              }
            />
          ))}
        </div>
      )}
      {model.activeSets.length > 0 && <AssumptionForm model={model} />}
      {model.error && <p className="text-sm text-destructive">{model.error}</p>}
    </div>
  );
}
