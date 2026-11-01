"use client";

import { type SubmitEvent, useState } from "react";
import {
  createForeignExchangeDecisionRecord,
  type ForeignExchangeDecisionComparison,
  type ForeignExchangeDecisionRecord,
  type ForeignExchangeScenarioId,
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
import { Textarea } from "@/components/ui/textarea";

const selectClassName =
  "border-input h-9 w-full rounded-md border bg-transparent px-3 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function formatRate(rate: number): string {
  return rate.toLocaleString("en-GB", { maximumFractionDigits: 6 });
}

function quoteAge(minutes: number): string {
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0 ? `${hours} hours` : `${hours}h ${remainder}m`;
}

function SourceTrace({
  comparison,
}: Readonly<{ comparison: ForeignExchangeDecisionComparison }>) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {comparison.sources.map((item) => (
        <div className="rounded-lg border p-3 text-sm" key={item.input}>
          <div className="flex items-center justify-between gap-3">
            <p className="font-medium">{item.input}</p>
            <p className="font-mono">{formatRate(item.rate)}</p>
          </div>
          <p className="mt-1 text-muted-foreground">
            {item.source.provider}, {item.source.label}
          </p>
          <p className="text-xs text-muted-foreground">
            Observed {new Date(item.source.observedAt).toLocaleString("en-GB")}
          </p>
          <a
            className="mt-2 inline-block text-xs font-medium underline underline-offset-4"
            href={item.source.url}
            rel="noreferrer"
            target="_blank"
          >
            Open source
          </a>
        </div>
      ))}
    </div>
  );
}

function ScenarioTable({
  comparison,
}: Readonly<{ comparison: ForeignExchangeDecisionComparison }>) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-3xl text-left text-sm">
        <thead className="bg-muted/50 text-xs text-muted-foreground">
          <tr>
            <th className="p-3 font-medium">Case</th>
            <th className="p-3 font-medium">Applied rate</th>
            <th className="p-3 font-medium">Fees</th>
            <th className="p-3 font-medium">Spread + fee cost</th>
            <th className="p-3 font-medium">Net proceeds</th>
            <th className="p-3 font-medium">Break-even future rate</th>
          </tr>
        </thead>
        <tbody>
          {comparison.scenarios.map((scenario) => (
            <tr className="border-t align-top" key={scenario.id}>
              <td className="p-3">
                <p className="font-medium">{scenario.label}</p>
                {scenario.assumption ? (
                  <Badge className="mt-1" variant="outline">
                    Assumption
                  </Badge>
                ) : (
                  <Badge className="mt-1" variant="secondary">
                    Sourced quote
                  </Badge>
                )}
              </td>
              <td className="p-3 font-mono">
                {formatRate(scenario.executableRate)}
              </td>
              <td className="p-3">
                {formatAccountCurrency(
                  scenario.sourceFees,
                  comparison.input.sourceCurrency,
                )}
              </td>
              <td className="p-3">
                {formatAccountCurrency(
                  scenario.spreadAndFeeCost,
                  comparison.input.targetCurrency,
                )}
              </td>
              <td className="p-3 font-semibold">
                {formatAccountCurrency(
                  scenario.netProceeds,
                  comparison.input.targetCurrency,
                )}
              </td>
              <td className="p-3 font-mono">
                {scenario.breakEvenFutureRate == null
                  ? "Not applicable"
                  : formatRate(scenario.breakEvenFutureRate)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ForeignExchangeComparison({
  comparison,
  onSave,
}: Readonly<{
  comparison: ForeignExchangeDecisionComparison;
  onSave(record: ForeignExchangeDecisionRecord): boolean;
}>) {
  const [selectedScenarioId, setSelectedScenarioId] =
    useState<ForeignExchangeScenarioId>("now");
  const [rationale, setRationale] = useState("");
  const [error, setError] = useState<string | null>(null);

  function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const record = createForeignExchangeDecisionRecord({
        id: `fx-decision-${globalThis.crypto.randomUUID()}`,
        savedAt: new Date().toISOString(),
        selectedScenarioId,
        rationale,
        comparison,
      });
      if (onSave(record)) {
        setRationale("");
        setError(null);
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The decision was not saved.",
      );
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle>Conversion comparison</CardTitle>
            <CardDescription>
              The available quote is {quoteAge(comparison.quoteAgeMinutes)} old.
              Its spread against the reference rate is{" "}
              {comparison.spreadPercentage.toFixed(2)}%.
            </CardDescription>
          </div>
          <Badge variant="outline">No exchange-rate forecast</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <SourceTrace comparison={comparison} />
        <ScenarioTable comparison={comparison} />
        <p className="text-xs text-muted-foreground">
          Future and stress rates are your assumptions. The calculation applies
          the current quote&apos;s relative spread and provider fee schedule to
          later legs. A staged conversion pays the fixed fee on each leg.
        </p>
        <form
          className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2"
          onSubmit={save}
        >
          <label
            className="space-y-1.5 text-xs font-medium"
            htmlFor="fx-chosen-case"
          >
            <span>Chosen case</span>
            <select
              aria-label="Chosen conversion case"
              className={selectClassName}
              id="fx-chosen-case"
              value={selectedScenarioId}
              onChange={(event) =>
                setSelectedScenarioId(
                  event.target.value as ForeignExchangeScenarioId,
                )
              }
            >
              {comparison.scenarios.map((scenario) => (
                <option key={scenario.id} value={scenario.id}>
                  {scenario.label}
                </option>
              ))}
            </select>
          </label>
          <label
            className="space-y-1.5 text-xs font-medium sm:row-span-2"
            htmlFor="fx-rationale"
          >
            <span>Rationale</span>
            <Textarea
              id="fx-rationale"
              placeholder="Why this timing and split fit the known constraints"
              required
              value={rationale}
              onChange={(event) => setRationale(event.target.value)}
            />
          </label>
          <div className="self-end">
            {error == null ? null : (
              <p className="mb-2 text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
            <Button type="submit">Save decision assumptions</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
