"use client";

import { useState } from "react";
import {
  compareForeignExchangeDecision,
  type ForeignExchangeDecisionComparison,
  type ForeignExchangeDecisionInput,
} from "@/app/_projects/personal-finance-app/domain/foreignExchangeDecision";
import { ForeignExchangeComparison } from "./foreign-exchange-comparison";
import { ForeignExchangeDecisionLedger } from "./foreign-exchange-decision-ledger";
import { ForeignExchangeInputForm } from "./foreign-exchange-input-form";
import { useForeignExchangeDecisions } from "./use-foreign-exchange-decisions";

export function ForeignExchangeDecisionWorkspace() {
  const [comparison, setComparison] =
    useState<ForeignExchangeDecisionComparison | null>(null);
  const { records, storageError, save, reconcile } =
    useForeignExchangeDecisions();

  function compare(input: ForeignExchangeDecisionInput) {
    setComparison(compareForeignExchangeDecision(input));
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight">
          Currency conversion decision
        </h2>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Compare converting now, waiting, or splitting the conversion. The
          current case uses linked rate sources. Later rates remain editable
          assumptions and never become a directional recommendation.
        </p>
      </div>
      <ForeignExchangeInputForm onCompare={compare} />
      {comparison == null ? null : (
        <ForeignExchangeComparison comparison={comparison} onSave={save} />
      )}
      {storageError == null ? null : (
        <p className="text-sm text-destructive" role="alert">
          {storageError}
        </p>
      )}
      <ForeignExchangeDecisionLedger
        records={records}
        onReconcile={reconcile}
      />
    </div>
  );
}
