"use client";

import { type SubmitEvent, useState } from "react";
import {
  compareForeignExchangeDecision,
  type ForeignExchangeDecisionRecord,
  type ForeignExchangeReconciliation,
  foreignExchangeReconciliationSummary,
} from "@/app/_projects/personal-finance-app/domain/foreignExchangeDecision";
import { formatAccountCurrency } from "@/app/_projects/personal-finance-app/lib/presentation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

function ReconciliationInput({
  id,
  label,
  name,
  defaultValue,
}: Readonly<{
  id: string;
  label: string;
  name: string;
  defaultValue?: string;
}>) {
  return (
    <label className="space-y-1 text-xs font-medium" htmlFor={id}>
      <span>{label}</span>
      <Input
        id={id}
        defaultValue={defaultValue}
        name={name}
        min="0"
        step="any"
        type="number"
        required
      />
    </label>
  );
}

function ReconciliationFields({
  record,
}: Readonly<{ record: ForeignExchangeDecisionRecord }>) {
  return (
    <>
      <label
        className="space-y-1 text-xs font-medium"
        htmlFor={`${record.id}-completed-at`}
      >
        <span>Completed at</span>
        <Input
          id={`${record.id}-completed-at`}
          name="completedAt"
          type="datetime-local"
          required
        />
      </label>
      <ReconciliationInput
        id={`${record.id}-source-amount`}
        label="Source amount converted"
        name="sourceAmount"
      />
      <ReconciliationInput
        id={`${record.id}-target-amount`}
        label="Target amount received"
        name="targetAmount"
      />
      <ReconciliationInput
        id={`${record.id}-source-fees`}
        label="Fees in source currency"
        name="sourceFees"
        defaultValue="0"
      />
      <label
        className="space-y-1 text-xs font-medium sm:col-span-2"
        htmlFor={`${record.id}-settlement-note`}
      >
        <span>Settlement note</span>
        <Input id={`${record.id}-settlement-note`} name="note" required />
      </label>
    </>
  );
}

function ReconciliationForm({
  record,
  onReconcile,
}: Readonly<{
  record: ForeignExchangeDecisionRecord;
  onReconcile(actual: ForeignExchangeReconciliation): boolean;
}>) {
  const [error, setError] = useState<string | null>(null);

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const actual = {
        completedAt: new Date(String(form.get("completedAt"))).toISOString(),
        sourceAmount: Number(form.get("sourceAmount")),
        targetAmount: Number(form.get("targetAmount")),
        sourceFees: Number(form.get("sourceFees")),
        note: String(form.get("note") ?? "").trim(),
      };
      if (onReconcile(actual)) setError(null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The completed conversion was not recorded.",
      );
    }
  }

  return (
    <form
      className="mt-4 grid gap-3 rounded-lg bg-muted/40 p-3 sm:grid-cols-2"
      onSubmit={submit}
    >
      <ReconciliationFields record={record} />
      {error == null ? null : (
        <p className="text-sm text-destructive sm:col-span-2" role="alert">
          {error}
        </p>
      )}
      <Button className="justify-self-start" type="submit">
        Reconcile completed conversion
      </Button>
    </form>
  );
}

function DecisionHeader({
  record,
  selectedLabel,
}: Readonly<{
  record: ForeignExchangeDecisionRecord;
  selectedLabel: string;
}>) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h4 className="font-semibold">{selectedLabel}</h4>
        <p className="text-sm text-muted-foreground">
          Saved {new Date(record.savedAt).toLocaleString("en-GB")}
        </p>
      </div>
      <Badge variant={record.reconciliation == null ? "outline" : "secondary"}>
        {record.reconciliation == null ? "Awaiting settlement" : "Reconciled"}
      </Badge>
    </div>
  );
}

function DecisionSnapshot({
  record,
}: Readonly<{ record: ForeignExchangeDecisionRecord }>) {
  const sourceCurrency = record.assumptions.sourceCurrency;
  const targetCurrency = record.assumptions.targetCurrency;
  return (
    <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
      <div>
        <dt className="text-xs text-muted-foreground">Amount</dt>
        <dd className="font-medium">
          {formatAccountCurrency(record.assumptions.amount, sourceCurrency)}
        </dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">Expected proceeds</dt>
        <dd className="font-medium">
          {formatAccountCurrency(record.expectedNetProceeds, targetCurrency)}
        </dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">
          Assumed future / stress rates
        </dt>
        <dd className="font-mono">
          {record.assumptions.futureRate} / {record.assumptions.stressRate}
        </dd>
      </div>
    </dl>
  );
}

function SourceLinks({
  record,
}: Readonly<{ record: ForeignExchangeDecisionRecord }>) {
  const sources = compareForeignExchangeDecision(record.assumptions).sources;
  return (
    <div className="mt-3 flex flex-wrap gap-3 text-xs">
      {sources.map((item) => (
        <a
          className="underline underline-offset-4"
          href={item.source.url}
          key={item.input}
          rel="noreferrer"
          target="_blank"
        >
          {item.input}: {item.source.provider}
        </a>
      ))}
    </div>
  );
}

function ReconciledOutcome({
  record,
}: Readonly<{ record: ForeignExchangeDecisionRecord }>) {
  const reconciliation = record.reconciliation;
  if (reconciliation == null) return null;
  const summary = foreignExchangeReconciliationSummary(record);
  const targetCurrency = record.assumptions.targetCurrency;
  return (
    <dl className="mt-4 grid gap-3 rounded-lg bg-muted/40 p-3 text-sm sm:grid-cols-3">
      <div>
        <dt className="text-xs text-muted-foreground">Received</dt>
        <dd className="font-medium">
          {formatAccountCurrency(reconciliation.targetAmount, targetCurrency)}
        </dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">Actual effective rate</dt>
        <dd className="font-mono">{summary?.actualRate.toFixed(6)}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">Proceeds variance</dt>
        <dd className="font-medium">
          {formatAccountCurrency(
            summary?.netProceedsVariance ?? 0,
            targetCurrency,
          )}
        </dd>
      </div>
      <p className="sm:col-span-3">{reconciliation.note}</p>
    </dl>
  );
}

function DecisionRecord({
  record,
  onReconcile,
}: Readonly<{
  record: ForeignExchangeDecisionRecord;
  onReconcile(actual: ForeignExchangeReconciliation): boolean;
}>) {
  const comparison = compareForeignExchangeDecision(record.assumptions);
  const selected = comparison.scenarios.find(
    ({ id }) => id === record.selectedScenarioId,
  );

  return (
    <article className="rounded-lg border p-4">
      <DecisionHeader
        record={record}
        selectedLabel={selected?.label ?? record.selectedScenarioId}
      />
      <DecisionSnapshot record={record} />
      <p className="mt-3 text-sm">{record.rationale}</p>
      <SourceLinks record={record} />
      {record.reconciliation == null ? (
        <ReconciliationForm record={record} onReconcile={onReconcile} />
      ) : (
        <ReconciledOutcome record={record} />
      )}
    </article>
  );
}

export function ForeignExchangeDecisionLedger({
  records,
  onReconcile,
}: Readonly<{
  records: ForeignExchangeDecisionRecord[];
  onReconcile(id: string, actual: ForeignExchangeReconciliation): boolean;
}>) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Saved FX decisions</CardTitle>
        <CardDescription>
          Saved inputs stay fixed so the completed conversion can be compared
          with what was known at the decision time.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {records.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No FX decisions saved yet.
          </p>
        ) : (
          records.map((record) => (
            <DecisionRecord
              key={record.id}
              record={record}
              onReconcile={(actual) => onReconcile(record.id, actual)}
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}
