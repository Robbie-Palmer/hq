import type {
  ReadinessTask,
  UpcomingWeddingPayment,
  WeddingFinanceSummary,
  WeddingOperationsSnapshot,
} from "wedding-planner-domain";
import type { AssetTrackerData } from "@/app/_projects/personal-finance-app/domain/assetTrackerData";
import type { FutureCashFlow } from "@/app/_projects/personal-finance-app/domain/futureCashFlow";

function dueOn(
  task: AssetTrackerData["planningCases"][number]["checklistItems"][number],
): string | null {
  if (!task.schedule) return null;
  return task.schedule.kind === "due_date"
    ? task.schedule.dueDate
    : task.schedule.endsOn;
}

function taskHref(
  task: AssetTrackerData["planningCases"][number]["checklistItems"][number],
): string {
  return task.externalLink ?? `/assettracker/planning#task-${task.id}`;
}

function selectedPlanningCase(
  data: AssetTrackerData,
  requestedId: string | null,
) {
  if (requestedId)
    return data.planningCases.find((candidate) => candidate.id === requestedId);
  return data.planningCases.find(
    (candidate) =>
      candidate.id.toLowerCase().includes("wedding") ||
      candidate.name.toLowerCase().includes("wedding") ||
      candidate.labels.some((label) => label.toLowerCase() === "wedding"),
  );
}

function linkedRecordIds(
  planningCase: AssetTrackerData["planningCases"][number],
  records: readonly FutureCashFlow[],
): Set<string> {
  const ids = new Set<string>();
  const byPayment = new Map(
    records.flatMap((record) =>
      record.stages.flatMap((stage) =>
        stage.actuals.map((actual) => [actual.id, record.id] as const),
      ),
    ),
  );
  for (const task of planningCase.checklistItems) {
    for (const link of task.financialLinks) {
      if (link.kind === "commitment" || link.kind === "decision")
        ids.add(link.recordId);
      if (link.kind === "payment_action") {
        const recordId = byPayment.get(link.recordId);
        if (recordId) ids.add(recordId);
      }
    }
  }
  return ids;
}

function weddingRecords(
  data: AssetTrackerData,
  planningCase: AssetTrackerData["planningCases"][number],
): FutureCashFlow[] {
  const linked = linkedRecordIds(planningCase, data.futureCashFlows);
  return data.futureCashFlows.filter(
    (record) =>
      record.planningCaseId === planningCase.id || linked.has(record.id),
  );
}

function expectedStageAmount(
  record: FutureCashFlow,
  stage: FutureCashFlow["stages"][number],
): number {
  if (record.kind === "commitment") return "amount" in stage ? stage.amount : 0;
  return "expectedAmount" in stage ? stage.expectedAmount : 0;
}

function includedRecord(record: FutureCashFlow): boolean {
  return record.kind === "commitment"
    ? record.status === "active"
    : record.status !== "declined";
}

function financeSummary(records: readonly FutureCashFlow[]) {
  const summaries = new Map<string, WeddingFinanceSummary>();
  for (const record of records) {
    const summary = summaries.get(record.currency) ?? {
      currency: record.currency,
      planned: 0,
      committed: 0,
      paid: 0,
      refunded: 0,
      remaining: 0,
    };
    for (const stage of record.stages) {
      if (stage.direction !== "payment") continue;
      const expected = expectedStageAmount(record, stage);
      const paid = stage.actuals
        .filter((actual) => actual.direction === "payment")
        .reduce((total, actual) => total + actual.amount, 0);
      const refunded = stage.actuals
        .filter((actual) => actual.direction === "refund")
        .reduce((total, actual) => total + actual.amount, 0);
      if (includedRecord(record)) {
        summary.planned += expected;
        if (record.kind === "commitment") summary.committed += expected;
        summary.remaining += Math.max(expected - paid + refunded, 0);
      }
      summary.paid += paid;
      summary.refunded += refunded;
    }
    summaries.set(record.currency, summary);
  }
  return [...summaries.values()].sort((left, right) =>
    left.currency.localeCompare(right.currency),
  );
}

function upcomingPayments(
  records: readonly FutureCashFlow[],
): UpcomingWeddingPayment[] {
  return records
    .flatMap((record) => {
      if (record.kind !== "commitment" || record.status !== "active") return [];
      return record.stages.flatMap((stage) => {
        if (stage.direction !== "payment") return [];
        const paid = stage.actuals.reduce(
          (total, actual) =>
            total +
            (actual.direction === "payment" ? actual.amount : -actual.amount),
          0,
        );
        const remaining = Math.max(stage.amount - paid, 0);
        if (!remaining) return [];
        return [
          {
            id: `${record.id}:${stage.id}`,
            title: stage.name ? `${record.name}: ${stage.name}` : record.name,
            due_on: stage.dueDate,
            amount: remaining,
            currency: record.currency,
            href: `/assettracker/cash-flow#cash-flow-${record.id}`,
          },
        ];
      });
    })
    .sort(
      (left, right) =>
        left.due_on.localeCompare(right.due_on) ||
        left.title.localeCompare(right.title),
    );
}

export function buildWeddingOperationsSnapshot(
  data: AssetTrackerData,
  requestedPlanningCaseId: string | null,
): WeddingOperationsSnapshot | null {
  const planningCase = selectedPlanningCase(data, requestedPlanningCaseId);
  if (!planningCase) return null;
  const records = weddingRecords(data, planningCase);
  const tasks: ReadinessTask[] = planningCase.checklistItems.map((task) => ({
    id: task.id,
    title: task.title,
    owner: task.owner || null,
    status: task.status,
    due_on: dueOn(task),
    href: taskHref(task),
  }));
  return {
    planning_case_id: planningCase.id,
    planning_case_name: planningCase.name,
    tasks,
    unresolved_decisions: records
      .filter(
        (record): record is Extract<FutureCashFlow, { kind: "decision" }> =>
          record.kind === "decision" && record.status === "considering",
      )
      .map((record) => ({
        id: record.id,
        title: record.name,
        href: `/assettracker/cash-flow#cash-flow-${record.id}`,
      })),
    finances: financeSummary(records),
    upcoming_payments: upcomingPayments(records),
  };
}

export async function loadWeddingOperationsSnapshot(
  storage: Storage,
  requestedPlanningCaseId: string | null,
): Promise<WeddingOperationsSnapshot | null> {
  const { createLocalAssetTrackerApi } = await import(
    "@/app/_projects/personal-finance-app/api/assettracker"
  );
  const loaded = await createLocalAssetTrackerApi(storage).load();
  if (!loaded.persisted) return null;
  return buildWeddingOperationsSnapshot(loaded.data, requestedPlanningCaseId);
}
