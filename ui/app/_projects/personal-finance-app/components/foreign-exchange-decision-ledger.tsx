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
      <label
        className="space-y-1 text-xs font-medium"
        htmlFor={`${record.id}-source-amount`}
      >
        <span>Source amount converted</span>
        <Input
          id={`${record.id}-source-amount`}
          name="sourceAmount"
          min="0"
          step="any"
          type="number"
          required
        />
      </label>
      <label
        className="space-y-1 text-xs font-medium"
        htmlFor={`${record.id}-target-amount`}
      >
        <span>Target amount received</span>
        <Input
          id={`${record.id}-target-amount`}
          name="targetAmount"
          min="0"
          step="any"
          type="number"
          required
        />
      </label>
      <label
        className="space-y-1 text-xs font-medium"
        htmlFor={`${record.id}-source-fees`}
      >
        <span>Fees in source currency</span>
        <Input
          id={`${record.id}-source-fees`}
          defaultValue="0"
          name="sourceFees"
          min="0"
          step="any"
          type="number"
          required
        />
      </label>
      <label
        className="space-y-1 text-xs font-medium sm:col-span-2"
        htmlFor={`${record.id}-settlement-note`}
      >
        <span>Settlement note</span>
        <Input id={`${record.id}-settlement-note`} name="note" required />
      </label>
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
  const summary = foreignExchangeReconciliationSummary(record);
  const sourceCurrency = record.assumptions.sourceCurrency;
  const targetCurrency = record.assumptions.targetCurrency;

  return (
    <article className="rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="font-semibold">
            {selected?.label ?? record.selectedScenarioId}
          </h4>
          <p className="text-sm text-muted-foreground">
            Saved {new Date(record.savedAt).toLocaleString("en-GB")}
          </p>
        </div>
        <Badge
          variant={record.reconciliation == null ? "outline" : "secondary"}
        >
          {record.reconciliation == null ? "Awaiting settlement" : "Reconciled"}
        </Badge>
      </div>
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
      <p className="mt-3 text-sm">{record.rationale}</p>
      <div className="mt-3 flex flex-wrap gap-3 text-xs">
        {comparison.sources.map((item) => (
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
      {record.reconciliation == null ? (
        <ReconciliationForm record={record} onReconcile={onReconcile} />
      ) : (
        <dl className="mt-4 grid gap-3 rounded-lg bg-muted/40 p-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">Received</dt>
            <dd className="font-medium">
              {formatAccountCurrency(
                record.reconciliation.targetAmount,
                targetCurrency,
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">
              Actual effective rate
            </dt>
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
          <p className="sm:col-span-3">{record.reconciliation.note}</p>
        </dl>
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
