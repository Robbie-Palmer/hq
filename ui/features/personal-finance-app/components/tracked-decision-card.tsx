"use client";

import {
  reconcileDecisionRecord,
  type TrackedFinancialDecisionRecord,
} from "@/features/personal-finance-app/domain";
import { formatCurrency } from "@/features/personal-finance-app/lib";
import { InterpretationForm, ObservationForm } from "./decision-record-forms";

type Reconciliation = ReturnType<typeof reconcileDecisionRecord>[number];

function DecisionSummary({
  decision,
}: Readonly<{ decision: TrackedFinancialDecisionRecord }>) {
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold">{decision.question}</h2>
          <p className="text-xs text-muted-foreground">
            Decided {decision.decisionDate} · {decision.selectedScenario.label}
          </p>
        </div>
        <span className="rounded-full bg-muted px-2 py-1 text-xs">
          Reconciled decision
        </span>
      </div>
      <div className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
        <div>
          <p className="text-xs text-muted-foreground">Rationale</p>
          <p>{decision.rationale}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Action</p>
          <p>{decision.action}</p>
        </div>
      </div>
    </>
  );
}

function ForecastLineage({
  decision,
}: Readonly<{ decision: TrackedFinancialDecisionRecord }>) {
  return (
    <details className="mt-4 rounded-md border p-3">
      <summary className="cursor-pointer text-sm font-medium">
        Frozen forecast lineage
      </summary>
      <p className="mt-2 text-xs text-muted-foreground">
        Captured {decision.forecast.capturedAt}. Calculation version{" "}
        {decision.forecast.calculationVersion}.
      </p>
      <dl className="mt-3 grid gap-3 sm:grid-cols-2">
        {decision.forecast.lineage.map((item) => (
          <div key={item.id} className="text-sm">
            <dt className="text-xs capitalize text-muted-foreground">
              {item.kind.replaceAll("-", " ")} · {item.label}
            </dt>
            <dd>{item.value}</dd>
            <dd className="text-xs text-muted-foreground">
              {item.source} · valid {item.validAt}
              {item.version == null ? "" : ` · ${item.version}`}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function DivergenceList({
  reconciliation,
}: Readonly<{ reconciliation: Reconciliation }>) {
  if (reconciliation.largestDivergenceSources.length === 0) return null;
  return (
    <div className="mt-2">
      <p className="text-xs font-medium text-muted-foreground">
        Largest sources of divergence
      </p>
      <ul className="mt-1 space-y-1">
        {reconciliation.largestDivergenceSources.map((source) => (
          <li key={`${source.kind}-${source.label}`}>
            {source.kind === "changed-assumption"
              ? "Changed assumption"
              : "Changed reality"}
            : {source.label} (
            {formatCurrency(
              source.impactAmount,
              reconciliation.checkpoint.currency,
            )}
            )
          </li>
        ))}
      </ul>
    </div>
  );
}

function CheckpointResult({
  reconciliation,
}: Readonly<{ reconciliation: Reconciliation }>) {
  const { observation } = reconciliation;
  if (observation == null) return null;
  return (
    <div className="mt-3 text-sm">
      <p>{observation.note}</p>
      <DivergenceList reconciliation={reconciliation} />
    </div>
  );
}

function CheckpointAmounts({
  reconciliation,
}: Readonly<{ reconciliation: Reconciliation }>) {
  const { checkpoint, observation, variance } = reconciliation;
  return (
    <div className="text-right">
      <p>
        Expected{" "}
        {formatCurrency(checkpoint.expectedAmount, checkpoint.currency)}
      </p>
      {observation == null ? (
        <p className="text-xs text-muted-foreground">Awaiting observation</p>
      ) : (
        <p>
          Actual {formatCurrency(observation.actualAmount, checkpoint.currency)}{" "}
          · {formatCurrency(variance ?? 0, checkpoint.currency)} variance
        </p>
      )}
    </div>
  );
}

function CheckpointCard({
  decisionId,
  reconciliation,
}: Readonly<{
  decisionId: string;
  reconciliation: Reconciliation;
}>) {
  const { checkpoint, observation } = reconciliation;
  return (
    <section className="rounded-md border p-3">
      <div className="flex flex-wrap justify-between gap-2 text-sm">
        <div>
          <p className="font-medium">{checkpoint.label}</p>
          <p className="text-xs text-muted-foreground">
            Checkpoint {checkpoint.dueDate}
          </p>
        </div>
        <CheckpointAmounts reconciliation={reconciliation} />
      </div>
      {observation == null ? (
        <ObservationForm checkpointId={checkpoint.id} decisionId={decisionId} />
      ) : (
        <CheckpointResult reconciliation={reconciliation} />
      )}
    </section>
  );
}

function DecisionInterpretations({
  decision,
}: Readonly<{ decision: TrackedFinancialDecisionRecord }>) {
  if (decision.interpretations.length === 0) return null;
  return (
    <div className="mt-4 space-y-2">
      <h3 className="text-sm font-semibold">Later interpretations</h3>
      {decision.interpretations.map((interpretation) => (
        <div
          key={interpretation.id}
          className="rounded-md bg-muted/40 p-3 text-sm"
        >
          <p className="font-medium">{interpretation.reason}</p>
          <p>{interpretation.revisedRationale}</p>
          {interpretation.assumptionChanges.map((change) => (
            <p
              key={change.label}
              className="mt-1 text-xs text-muted-foreground"
            >
              {change.label}: {change.previousValue} → {change.revisedValue}
            </p>
          ))}
        </div>
      ))}
    </div>
  );
}

export function TrackedDecisionCard({
  decision,
}: Readonly<{
  decision: TrackedFinancialDecisionRecord;
}>) {
  const reconciliations = reconcileDecisionRecord(decision);
  return (
    <article className="rounded-lg border p-5">
      <DecisionSummary decision={decision} />
      <ForecastLineage decision={decision} />
      <div className="mt-4 space-y-3">
        <h3 className="text-sm font-semibold">Forecast and reality</h3>
        {reconciliations.map((reconciliation) => (
          <CheckpointCard
            key={reconciliation.checkpoint.id}
            decisionId={decision.id}
            reconciliation={reconciliation}
          />
        ))}
      </div>
      <DecisionInterpretations decision={decision} />
      <InterpretationForm decision={decision} />
    </article>
  );
}
