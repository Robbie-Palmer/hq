import { z } from "zod";
import { AccountIdSchema } from "./account";
import { CurrencySchema, DEFAULT_BASE_CURRENCY } from "./currency";
import type { PlannedExpenditure } from "./plannedExpenditure";

const OptionalTextSchema = z.string().trim().min(1).optional();
const LabelsSchema = z
  .array(z.string().trim().min(1))
  .default([])
  .transform((labels) => Array.from(new Set(labels)));

export const PlanningCaseSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  description: OptionalTextSchema,
  labels: LabelsSchema,
  targetDate: z.iso.date().optional(),
});
export type PlanningCase = z.infer<typeof PlanningCaseSchema>;

export const ActualCashFlowSchema = z.object({
  id: z.string().trim().min(1),
  date: z.iso.date(),
  amount: z.number().positive(),
  direction: z.enum(["payment", "refund"]),
});
export type ActualCashFlow = z.infer<typeof ActualCashFlowSchema>;

const StageBaseSchema = z.object({
  id: z.string().trim().min(1),
  name: OptionalTextSchema,
  fromAccountId: AccountIdSchema,
  actuals: z.array(ActualCashFlowSchema).default([]),
});

export const CommitmentStageSchema = StageBaseSchema.extend({
  dueDate: z.iso.date(),
  amount: z.number().positive(),
});
export type CommitmentStage = z.infer<typeof CommitmentStageSchema>;

export const DecisionStageSchema = StageBaseSchema.extend({
  earliestDate: z.iso.date().optional(),
  expectedDate: z.iso.date(),
  latestDate: z.iso.date().optional(),
  minimumAmount: z.number().nonnegative(),
  expectedAmount: z.number().positive(),
  maximumAmount: z.number().positive(),
}).superRefine((stage, context) => {
  if (
    stage.minimumAmount > stage.expectedAmount ||
    stage.expectedAmount > stage.maximumAmount
  ) {
    context.addIssue({
      code: "custom",
      message: "Decision amounts must run from minimum to expected to maximum",
    });
  }
  if (
    (stage.earliestDate != null && stage.earliestDate > stage.expectedDate) ||
    (stage.latestDate != null && stage.expectedDate > stage.latestDate)
  ) {
    context.addIssue({
      code: "custom",
      message: "Decision dates must run from earliest to expected to latest",
    });
  }
});
export type DecisionStage = z.infer<typeof DecisionStageSchema>;

const FutureCashFlowBaseShape = {
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  description: OptionalTextSchema,
  planningCaseId: z.string().trim().min(1).optional(),
  labels: LabelsSchema,
  currency: CurrencySchema.default(DEFAULT_BASE_CURRENCY),
  notes: OptionalTextSchema,
};

export const CommitmentSchema = z.object({
  ...FutureCashFlowBaseShape,
  kind: z.literal("commitment"),
  counterparty: OptionalTextSchema,
  status: z.enum(["active", "cancelled"]).default("active"),
  changeability: z.enum(["fixed", "variable"]).default("fixed"),
  refundable: z.boolean().default(false),
  stages: z.array(CommitmentStageSchema).min(1),
});
export type Commitment = z.infer<typeof CommitmentSchema>;

export const CashFlowDecisionSchema = z.object({
  ...FutureCashFlowBaseShape,
  kind: z.literal("decision"),
  status: z
    .enum(["considering", "selected", "declined"])
    .default("considering"),
  importance: OptionalTextSchema,
  confidence: z.number().min(0).max(1).optional(),
  reversibility: z
    .enum(["reversible", "partly-reversible", "irreversible"])
    .default("reversible"),
  dependencyIds: z.array(z.string().trim().min(1)).default([]),
  alternativeToIds: z.array(z.string().trim().min(1)).default([]),
  stages: z.array(DecisionStageSchema).min(1),
});
export type CashFlowDecision = z.infer<typeof CashFlowDecisionSchema>;

export const FutureCashFlowSchema = z.discriminatedUnion("kind", [
  CommitmentSchema,
  CashFlowDecisionSchema,
]);
export type FutureCashFlow = z.infer<typeof FutureCashFlowSchema>;

export type ForecastCashFlow = {
  id: string;
  futureCashFlowId: string;
  stageId: string;
  name: string;
  date: string;
  amount: number;
  currency: FutureCashFlow["currency"];
  fromAccountId: string;
  kind: FutureCashFlow["kind"];
  planningCaseId?: string;
};

function netPaid(actuals: readonly ActualCashFlow[]): number {
  return actuals.reduce(
    (total, actual) =>
      total + (actual.direction === "payment" ? actual.amount : -actual.amount),
    0,
  );
}

export function futureCashFlowForecastItems(
  records: readonly FutureCashFlow[],
): ForecastCashFlow[] {
  return records
    .flatMap((record): ForecastCashFlow[] => {
      if (record.kind === "commitment") {
        if (record.status !== "active") return [];
        return record.stages.flatMap((stage) => {
          const remaining = Math.max(stage.amount - netPaid(stage.actuals), 0);
          return remaining === 0
            ? []
            : [forecastItem(record, stage, stage.dueDate, remaining)];
        });
      }
      if (record.status !== "selected") return [];
      return record.stages.flatMap((stage) => {
        const remaining = Math.max(
          stage.expectedAmount - netPaid(stage.actuals),
          0,
        );
        return remaining === 0
          ? []
          : [forecastItem(record, stage, stage.expectedDate, remaining)];
      });
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

function forecastItem(
  record: FutureCashFlow,
  stage: CommitmentStage | DecisionStage,
  date: string,
  amount: number,
): ForecastCashFlow {
  return {
    id: `${record.id}:${stage.id}`,
    futureCashFlowId: record.id,
    stageId: stage.id,
    name: stage.name == null ? record.name : `${record.name}: ${stage.name}`,
    date,
    amount,
    currency: record.currency,
    fromAccountId: stage.fromAccountId,
    kind: record.kind,
    ...(record.planningCaseId == null
      ? {}
      : { planningCaseId: record.planningCaseId }),
  };
}

export function legacyPlannedExpenditureToCommitment(
  expenditure: PlannedExpenditure,
  currency: FutureCashFlow["currency"] = DEFAULT_BASE_CURRENCY,
): Commitment {
  return CommitmentSchema.parse({
    id: expenditure.id,
    name: expenditure.name,
    labels: [],
    currency,
    kind: "commitment",
    status: "active",
    changeability: "variable",
    refundable: false,
    stages: [
      {
        id: "payment-1",
        fromAccountId: expenditure.fromAccountId,
        dueDate: expenditure.date,
        amount: expenditure.amount,
        actuals: [],
      },
    ],
  });
}

export function futureCashFlowAccountIds(record: FutureCashFlow): string[] {
  return Array.from(
    new Set(record.stages.map(({ fromAccountId }) => fromAccountId)),
  );
}
