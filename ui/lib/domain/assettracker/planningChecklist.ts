import {
  buildPlanningCaseChecklistView,
  type ChecklistFinancialLink,
  type PlanningCase,
  type PlanningCaseChecklistView,
  type PlanningChecklistItem,
  validatePlanningCaseChecklistStructure,
} from "planning-case-domain";
import type { Currency } from "./currency";
import type { FinancialDecisionRecord } from "./decisionRecord";
import type {
  ActualCashFlow,
  FutureCashFlow,
  FutureCashFlowDirection,
} from "./futureCashFlow";

export * from "planning-case-domain";

export type PlanningCaseFinancialSummary = {
  currency: Currency;
  direction: FutureCashFlowDirection;
  planned: number;
  committed: number;
  paid: number;
  remaining: number;
};

export type PlanningCaseView = PlanningCaseChecklistView & {
  financialSummary: PlanningCaseFinancialSummary[];
};

type MutableFinancialSummary = Omit<
  PlanningCaseFinancialSummary,
  "currency" | "direction"
>;

function settledAmount(actuals: readonly ActualCashFlow[]): number {
  return actuals.reduce(
    (total, actual) =>
      total +
      (actual.direction === "payment" || actual.direction === "receipt"
        ? actual.amount
        : -actual.amount),
    0,
  );
}

function addAmount(
  summaries: Map<string, PlanningCaseFinancialSummary>,
  currency: Currency,
  direction: FutureCashFlowDirection,
  amounts: Partial<MutableFinancialSummary>,
): void {
  const key = `${currency}:${direction}`;
  const current = summaries.get(key) ?? {
    currency,
    direction,
    planned: 0,
    committed: 0,
    paid: 0,
    remaining: 0,
  };
  for (const field of ["planned", "committed", "paid", "remaining"] as const)
    current[field] += amounts[field] ?? 0;
  summaries.set(key, current);
}

function addFutureCashFlow(
  summaries: Map<string, PlanningCaseFinancialSummary>,
  record: FutureCashFlow,
  countedActualIds: Set<string>,
): void {
  const included =
    record.kind === "commitment"
      ? record.status === "active"
      : record.status !== "declined";
  for (const stage of record.stages) {
    const expected = "amount" in stage ? stage.amount : stage.expectedAmount;
    const settled = settledAmount(stage.actuals);
    if (included) {
      addAmount(summaries, record.currency, stage.direction, {
        planned: expected,
        committed: record.kind === "commitment" ? expected : 0,
        remaining: Math.max(expected - settled, 0),
      });
    }
    for (const actual of stage.actuals) {
      if (countedActualIds.has(actual.id)) continue;
      countedActualIds.add(actual.id);
      addAmount(summaries, record.currency, stage.direction, {
        paid: settledAmount([actual]),
      });
    }
  }
}

function findPaymentAction(
  records: readonly FutureCashFlow[],
  id: string,
): {
  record: FutureCashFlow;
  direction: FutureCashFlowDirection;
  actual: ActualCashFlow;
} | null {
  for (const record of records) {
    for (const stage of record.stages) {
      const actual = stage.actuals.find((candidate) => candidate.id === id);
      if (actual != null) return { record, direction: stage.direction, actual };
    }
  }
  return null;
}

type FinancialSummaryContext = {
  summaries: Map<string, PlanningCaseFinancialSummary>;
  records: readonly FutureCashFlow[];
  recordsById: ReadonlyMap<string, FutureCashFlow>;
  reconciliationsById: ReadonlyMap<string, FinancialDecisionRecord>;
  countedRecordIds: Set<string>;
  countedActualIds: Set<string>;
  countedReconciliationIds: Set<string>;
};

function addLinkedFutureCashFlow(
  context: FinancialSummaryContext,
  link: Extract<ChecklistFinancialLink, { kind: "commitment" | "decision" }>,
): void {
  if (context.countedRecordIds.has(link.recordId)) return;
  const record = context.recordsById.get(link.recordId);
  if (record?.kind !== link.kind) return;
  context.countedRecordIds.add(link.recordId);
  addFutureCashFlow(context.summaries, record, context.countedActualIds);
}

function addLinkedPaymentAction(
  context: FinancialSummaryContext,
  link: Extract<ChecklistFinancialLink, { kind: "payment_action" }>,
): void {
  if (context.countedActualIds.has(link.recordId)) return;
  const payment = findPaymentAction(context.records, link.recordId);
  if (payment == null) return;
  context.countedActualIds.add(link.recordId);
  addAmount(context.summaries, payment.record.currency, payment.direction, {
    paid: settledAmount([payment.actual]),
  });
}

function addLinkedReconciliation(
  context: FinancialSummaryContext,
  link: Extract<ChecklistFinancialLink, { kind: "reconciliation" }>,
): void {
  if (context.countedReconciliationIds.has(link.recordId)) return;
  const reconciliation = context.reconciliationsById.get(link.recordId);
  if (reconciliation?.kind !== "tracked") return;
  context.countedReconciliationIds.add(link.recordId);
  const observations = new Map(
    reconciliation.observations.map((observation) => [
      observation.checkpointId,
      observation,
    ]),
  );
  for (const checkpoint of reconciliation.forecast.checkpoints) {
    const paid = observations.get(checkpoint.id)?.actualAmount ?? 0;
    addAmount(context.summaries, checkpoint.currency, "payment", {
      planned: checkpoint.expectedAmount,
      paid,
      remaining: Math.max(checkpoint.expectedAmount - paid, 0),
    });
  }
}

function addFinancialLink(
  context: FinancialSummaryContext,
  link: ChecklistFinancialLink,
): void {
  if (link.kind === "commitment" || link.kind === "decision") {
    addLinkedFutureCashFlow(context, link);
    return;
  }
  if (link.kind === "payment_action") {
    addLinkedPaymentAction(context, link);
    return;
  }
  addLinkedReconciliation(context, link);
}

function planningCaseFinancialSummary(
  planningCase: PlanningCase,
  records: readonly FutureCashFlow[],
  decisionRecords: readonly FinancialDecisionRecord[],
): PlanningCaseFinancialSummary[] {
  const context: FinancialSummaryContext = {
    summaries: new Map(),
    records,
    recordsById: new Map(records.map((record) => [record.id, record])),
    reconciliationsById: new Map(
      decisionRecords.map((record) => [record.id, record]),
    ),
    countedRecordIds: new Set(),
    countedActualIds: new Set(),
    countedReconciliationIds: new Set(),
  };
  for (const item of planningCase.checklistItems)
    for (const link of item.financialLinks) addFinancialLink(context, link);
  return Array.from(context.summaries.values()).sort(
    (left, right) =>
      left.currency.localeCompare(right.currency) ||
      left.direction.localeCompare(right.direction),
  );
}

type ChecklistReferenceIndex = {
  records: ReadonlyMap<string, FutureCashFlow>;
  paymentActionIds: ReadonlySet<string>;
  reconciliationIds: ReadonlySet<string>;
};

function financialLinkExists(
  link: ChecklistFinancialLink,
  index: ChecklistReferenceIndex,
): boolean {
  if (link.kind === "payment_action")
    return index.paymentActionIds.has(link.recordId);
  if (link.kind === "reconciliation")
    return index.reconciliationIds.has(link.recordId);
  return index.records.get(link.recordId)?.kind === link.kind;
}

function validateFinancialLink(
  item: PlanningChecklistItem,
  link: ChecklistFinancialLink,
  index: ChecklistReferenceIndex,
): void {
  if (link.kind === "payment_action") {
    if (!index.paymentActionIds.has(link.recordId))
      throw new Error(
        `Checklist item "${item.title}" references unknown payment action "${link.recordId}"`,
      );
    return;
  }
  if (link.kind === "reconciliation") {
    if (!index.reconciliationIds.has(link.recordId))
      throw new Error(
        `Checklist item "${item.title}" references unknown reconciliation "${link.recordId}"`,
      );
    return;
  }
  const record = index.records.get(link.recordId);
  if (record?.kind !== link.kind)
    throw new Error(
      `Checklist item "${item.title}" references unknown ${link.kind} "${link.recordId}"`,
    );
}

function checklistReferenceIndex(
  records: readonly FutureCashFlow[],
  decisionRecords: readonly FinancialDecisionRecord[],
): ChecklistReferenceIndex {
  return {
    records: new Map(records.map((record) => [record.id, record])),
    paymentActionIds: new Set(
      records.flatMap((record) =>
        record.stages.flatMap((stage) =>
          stage.actuals.map((actual) => actual.id),
        ),
      ),
    ),
    reconciliationIds: new Set(
      decisionRecords
        .filter((record) => record.kind === "tracked")
        .map((record) => record.id),
    ),
  };
}

export function retainKnownAssetTrackerChecklistLinks(
  planningCases: readonly PlanningCase[],
  records: readonly FutureCashFlow[],
  decisionRecords: readonly FinancialDecisionRecord[],
): PlanningCase[] {
  const index = checklistReferenceIndex(records, decisionRecords);
  return planningCases.map((planningCase) => ({
    ...planningCase,
    checklistItems: planningCase.checklistItems.map((item) => ({
      ...item,
      financialLinks: item.financialLinks.filter((link) =>
        financialLinkExists(link, index),
      ),
    })),
  }));
}

export function buildPlanningCaseView(
  planningCase: PlanningCase,
  records: readonly FutureCashFlow[],
  decisionRecords: readonly FinancialDecisionRecord[],
  asOfDate: string,
): PlanningCaseView {
  return {
    ...buildPlanningCaseChecklistView(planningCase, asOfDate),
    financialSummary: planningCaseFinancialSummary(
      planningCase,
      records,
      decisionRecords,
    ),
  };
}

export function validateAssetTrackerPlanningCaseChecklist(
  planningCase: PlanningCase,
  records: readonly FutureCashFlow[],
  decisionRecords: readonly FinancialDecisionRecord[],
): void {
  validatePlanningCaseChecklistStructure(planningCase);
  const index = checklistReferenceIndex(records, decisionRecords);
  for (const item of planningCase.checklistItems)
    for (const link of item.financialLinks)
      validateFinancialLink(item, link, index);
}
