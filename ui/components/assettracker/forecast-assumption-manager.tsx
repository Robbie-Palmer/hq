"use client";

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
  if (assumption.source.kind === "manual-take-home") {
    return "Manual take-home income";
  }
  if (assumption.source.kind === "tax-derived") {
    return `${assumption.source.taxYear} tax rules · dataset ${assumption.source.ruleDatasetVersion}`;
  }
  return "Manual assumption";
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
            onClick={() => onVersion(set.id)}
          >
            Create next version
          </Button>
        )}
      </div>
      {set.assumptions.length === 0 ? (
        <p className="text-xs text-muted-foreground">No changes in this set.</p>
      ) : (
        <ul className="divide-y">
          {set.assumptions.map((assumption) => (
            <li
              key={assumption.id}
              className="flex flex-wrap items-start gap-2 py-2 text-xs"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium text-foreground">{assumption.name}</p>
                <p className="text-muted-foreground">
                  {assumption.kind === "income" ? "Income" : "Expenditure"} ·{" "}
                  {assumption.startDate}
                  {assumption.endDate == null
                    ? " onward"
                    : ` to ${assumption.endDate}`}
                </p>
                <p className="text-muted-foreground">
                  {sourceLabel(assumption)}
                  {assumption.sourceNotes == null
                    ? ""
                    : ` · ${assumption.sourceNotes}`}
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
              {set.status === "active" && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Delete assumption ${assumption.name}`}
                  onClick={() => onDelete(set.id, assumption.id)}
                >
                  <Trash2Icon />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ForecastAssumptionManager() {
  const {
    accounts,
    household,
    taxEstimate,
    forecastAssumptionSets,
    createForecastAssumptionSet,
    addForecastAssumption,
    versionForecastAssumptionSet,
    deleteForecastAssumption,
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
  const activeSets = forecastAssumptionSets.filter(
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
      await createForecastAssumptionSet({ name: newSetName });
      setNewSetName("");
    });
    setSubmitting(false);
  }

  async function handleAdd(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      selectedSetId === "" ||
      (kind === "income" && selectedAccount == null)
    ) {
      return;
    }
    const expectedChange = Number(expected);
    const ownership =
      ownerId === HOUSEHOLD_OWNER
        ? equalSharedOwnership(household.members)
        : personalOwnership(ownerId);
    const source =
      sourceKind === "tax-derived"
        ? {
            kind: "tax-derived" as const,
            taxYear: taxEstimate.taxYear,
            calculationVersion: taxEstimate.calculationVersion,
            ruleDatasetVersion: taxEstimate.lineage.ruleDatasetVersion,
          }
        : { kind: sourceKind };
    setSubmitting(true);
    await run(async () => {
      await addForecastAssumption({
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
        currency: selectedAccount?.currency ?? accounts[0]?.currency ?? "GBP",
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

  return (
    <div className="space-y-4 rounded-md border p-3">
      <div>
        <h4 className="text-sm font-medium">Household forecast assumptions</h4>
        <p className="text-xs text-muted-foreground">
          Describe changes from the reconciled income and ordinary-expenditure
          baseline. These are monthly changes, not category limits or budgets.
        </p>
      </div>

      <form
        onSubmit={handleCreateSet}
        className="flex flex-col gap-2 rounded-md bg-muted/35 p-3 sm:flex-row sm:items-end"
      >
        <div className="flex-1 space-y-1.5">
          <label htmlFor="assumption-set-name" className="text-xs font-medium">
            New reusable assumption set
          </label>
          <Input
            id="assumption-set-name"
            required
            placeholder="e.g. Household baseline"
            value={newSetName}
            onChange={(event) => setNewSetName(event.target.value)}
          />
        </div>
        <Button type="submit" variant="secondary" disabled={submitting}>
          Add set
        </Button>
      </form>

      {forecastAssumptionSets.length > 0 && (
        <div className="grid gap-2">
          {forecastAssumptionSets.map((set) => (
            <AssumptionSetSummary
              key={set.id}
              set={set}
              onVersion={(id) => run(() => versionForecastAssumptionSet(id))}
              onDelete={(candidateSetId, assumptionId) =>
                run(() =>
                  deleteForecastAssumption(candidateSetId, assumptionId),
                )
              }
            />
          ))}
        </div>
      )}

      {activeSets.length > 0 && (
        <form onSubmit={handleAdd} className="grid gap-3">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <label htmlFor="assumption-set" className="text-xs font-medium">
                Assumption set
              </label>
              <Select value={selectedSetId} onValueChange={setSetId}>
                <SelectTrigger id="assumption-set" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {activeSets.map((set) => (
                    <SelectItem key={set.id} value={set.id}>
                      {set.name} · v{set.version}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="assumption-kind" className="text-xs font-medium">
                Change to
              </label>
              <Select
                value={kind}
                onValueChange={(value) => {
                  const nextKind = value as "income" | "expenditure";
                  setKind(nextKind);
                  if (nextKind === "expenditure") setSourceKind("manual");
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
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <label htmlFor="assumption-name" className="text-xs font-medium">
                Name
              </label>
              <Input
                id="assumption-name"
                required
                placeholder="e.g. Reduced working hours"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="assumption-expected"
                className="text-xs font-medium"
              >
                Expected monthly change
              </label>
              <Input
                id="assumption-expected"
                type="number"
                step="0.01"
                required
                value={expected}
                onChange={(event) => setExpected(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="assumption-minimum"
                className="text-xs font-medium"
              >
                Minimum
              </label>
              <Input
                id="assumption-minimum"
                type="number"
                step="0.01"
                placeholder="Same as expected"
                value={minimum}
                onChange={(event) => setMinimum(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="assumption-maximum"
                className="text-xs font-medium"
              >
                Maximum
              </label>
              <Input
                id="assumption-maximum"
                type="number"
                step="0.01"
                placeholder="Same as expected"
                value={maximum}
                onChange={(event) => setMaximum(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="assumption-confidence"
                className="text-xs font-medium"
              >
                Confidence % (optional)
              </label>
              <Input
                id="assumption-confidence"
                type="number"
                min="0"
                max="100"
                value={confidence}
                onChange={(event) => setConfidence(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="assumption-start" className="text-xs font-medium">
                Starts
              </label>
              <Input
                id="assumption-start"
                type="date"
                required
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="assumption-end" className="text-xs font-medium">
                Ends (optional)
              </label>
              <Input
                id="assumption-end"
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
              />
            </div>
            {kind === "income" && (
              <div className="space-y-1.5">
                <label
                  htmlFor="assumption-account"
                  className="text-xs font-medium"
                >
                  Paid into
                </label>
                <Select value={selectedAccountId} onValueChange={setAccountId}>
                  <SelectTrigger id="assumption-account" className="w-full">
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
            )}
            <div className="space-y-1.5">
              <label htmlFor="assumption-owner" className="text-xs font-medium">
                Applies to
              </label>
              <Select value={ownerId} onValueChange={setOwnerId}>
                <SelectTrigger id="assumption-owner" className="w-full">
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
            <div className="space-y-1.5">
              <label
                htmlFor="assumption-source"
                className="text-xs font-medium"
              >
                Source
              </label>
              <Select
                value={sourceKind}
                onValueChange={(value) =>
                  setSourceKind(
                    value as "manual-take-home" | "manual" | "tax-derived",
                  )
                }
              >
                <SelectTrigger id="assumption-source" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {kind === "income" && (
                    <SelectItem value="manual-take-home">
                      Manual take-home income
                    </SelectItem>
                  )}
                  <SelectItem value="manual">Manual estimate</SelectItem>
                  {kind === "income" && (
                    <SelectItem value="tax-derived">
                      {taxEstimate.taxYear} tax estimate
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <label htmlFor="assumption-notes" className="text-xs font-medium">
                Source notes (optional)
              </label>
              <Input
                id="assumption-notes"
                value={sourceNotes}
                onChange={(event) => setSourceNotes(event.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Use negative values for a reduction. Minimum and maximum remain a
            range; the forecast does not assign probabilities to them.
          </p>
          <Button type="submit" className="w-fit" disabled={submitting}>
            Add forecast change
          </Button>
        </form>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
