import { z } from "zod";
import { AccountIdSchema } from "./account";
import { CurrencySchema, DEFAULT_BASE_CURRENCY } from "./currency";
import type { PlannedExpenditure } from "./plannedExpenditure";

export {
  type PlanningCase,
  PlanningCaseSchema,
} from "planning-case-domain";

const OptionalTextSchema = z.string().trim().min(1).optional();
const LabelsSchema = z
  .array(z.string().trim().min(1))
  .default([])
  .transform((labels) => Array.from(new Set(labels)));

export const FutureCashFlowDirectionSchema = z.enum(["payment", "receipt"]);
export type FutureCashFlowDirection = z.infer<
  typeof FutureCashFlowDirectionSchema
>;

export const ActualCashFlowDirectionSchema = z.enum([
  "payment",
  "refund",
  "receipt",
  "return",
]);
export type ActualCashFlowDirection = z.infer<
  typeof ActualCashFlowDirectionSchema
>;

export const ActualCashFlowSchema = z.object({
  id: z.string().trim().min(1),
  date: z.iso.date(),
  amount: z.number().positive(),
  direction: ActualCashFlowDirectionSchema,
});
export type ActualCashFlow = z.infer<typeof ActualCashFlowSchema>;

const CashFlowDeductionSchema = z.object({
  label: z.string().trim().min(1),
  amount: z.number().nonnegative(),
});

export const CashFlowAmountBreakdownSchema = z
  .object({
    grossAmount: z.number().positive(),
    taxAmount: z.number().nonnegative().default(0),
    feeAmount: z.number().nonnegative().default(0),
    deductions: z.array(CashFlowDeductionSchema).default([]),
    netAmount: z.number().positive(),
    sourceNotes: OptionalTextSchema,
    calculationLineage: z.array(z.string().trim().min(1)).default([]),
  })
  .superRefine((breakdown, context) => {
    const calculatedNet =
      breakdown.grossAmount -
      breakdown.taxAmount -
      breakdown.feeAmount -
      breakdown.deductions.reduce((total, item) => total + item.amount, 0);
    if (Math.abs(calculatedNet - breakdown.netAmount) > 0.005) {
      context.addIssue({
        code: "custom",
        message:
          "Gross amount less tax, fees, and deductions must equal net cash",
      });
    }
  });
export type CashFlowAmountBreakdown = z.infer<
  typeof CashFlowAmountBreakdownSchema
>;

const StageCommonShape = {
  id: z.string().trim().min(1),
  name: OptionalTextSchema,
  actuals: z.array(ActualCashFlowSchema).default([]),
  amountBreakdown: CashFlowAmountBreakdownSchema.optional(),
};

const PaymentEndpointShape = {
  direction: z.literal("payment").default("payment"),
  fromAccountId: AccountIdSchema,
};

const ReceiptEndpointShape = {
  direction: z.literal("receipt"),
  toAccountId: AccountIdSchema,
};

function validateActualDirections(
  direction: FutureCashFlowDirection,
  actuals: readonly ActualCashFlow[],
  context: z.RefinementCtx,
) {
  const valid =
    direction === "payment"
      ? new Set<ActualCashFlowDirection>(["payment", "refund"])
      : new Set<ActualCashFlowDirection>(["receipt", "return"]);
  for (const actual of actuals) {
    if (!valid.has(actual.direction)) {
      context.addIssue({
        code: "custom",
        message: `Actual ${actual.direction} does not match a ${direction} stage`,
      });
    }
  }
}

function validateBreakdown(
  expectedNet: number,
  breakdown: CashFlowAmountBreakdown | undefined,
  context: z.RefinementCtx,
) {
  if (
    breakdown != null &&
    Math.abs(breakdown.netAmount - expectedNet) > 0.005
  ) {
    context.addIssue({
      code: "custom",
      message: "The amount breakdown net cash must equal the stage amount",
    });
  }
}

const CommitmentAmountShape = {
  dueDate: z.iso.date(),
  amount: z.number().positive(),
};

const PaymentCommitmentStageSchema = z
  .object({
    ...StageCommonShape,
    ...PaymentEndpointShape,
    ...CommitmentAmountShape,
  })
  .superRefine((stage, context) => {
    validateActualDirections(stage.direction, stage.actuals, context);
    validateBreakdown(stage.amount, stage.amountBreakdown, context);
  });

const ReceiptCommitmentStageSchema = z
  .object({
    ...StageCommonShape,
    ...ReceiptEndpointShape,
    ...CommitmentAmountShape,
  })
  .superRefine((stage, context) => {
    validateActualDirections(stage.direction, stage.actuals, context);
    validateBreakdown(stage.amount, stage.amountBreakdown, context);
  });

export const CommitmentStageSchema = z.union([
  PaymentCommitmentStageSchema,
  ReceiptCommitmentStageSchema,
]);
export type CommitmentStage = z.infer<typeof CommitmentStageSchema>;

const DecisionAmountShape = {
  groupId: z.string().trim().min(1).optional(),
  earliestDate: z.iso.date().optional(),
  expectedDate: z.iso.date(),
  latestDate: z.iso.date().optional(),
  minimumAmount: z.number().nonnegative(),
  expectedAmount: z.number().positive(),
  maximumAmount: z.number().positive(),
};

const PaymentDecisionStageBaseSchema = z.object({
  ...StageCommonShape,
  ...PaymentEndpointShape,
  ...DecisionAmountShape,
});

const ReceiptDecisionStageBaseSchema = z.object({
  ...StageCommonShape,
  ...ReceiptEndpointShape,
  ...DecisionAmountShape,
});

type DecisionStageCandidate =
  | z.infer<typeof PaymentDecisionStageBaseSchema>
  | z.infer<typeof ReceiptDecisionStageBaseSchema>;

function validateDecisionStage(
  stage: DecisionStageCandidate,
  context: z.RefinementCtx,
) {
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
  validateActualDirections(stage.direction, stage.actuals, context);
  validateBreakdown(stage.expectedAmount, stage.amountBreakdown, context);
}

const PaymentDecisionStageSchema = PaymentDecisionStageBaseSchema.superRefine(
  validateDecisionStage,
);
const ReceiptDecisionStageSchema = ReceiptDecisionStageBaseSchema.superRefine(
  validateDecisionStage,
);

export const DecisionStageSchema = z.union([
  PaymentDecisionStageSchema,
  ReceiptDecisionStageSchema,
]);
export type DecisionStage = z.infer<typeof DecisionStageSchema>;

export const DecisionStageGroupUnresolvedCostSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  amount: z.number().positive().optional(),
  date: z.iso.date().optional(),
});
export type DecisionStageGroupUnresolvedCost = z.infer<
  typeof DecisionStageGroupUnresolvedCostSchema
>;

export const DecisionStageGroupSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  status: z.enum(["considering", "committed"]),
  unresolvedCosts: z.array(DecisionStageGroupUnresolvedCostSchema).optional(),
});
export type DecisionStageGroup = z.infer<typeof DecisionStageGroupSchema>;

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
  groups: z.array(DecisionStageGroupSchema).optional(),
  stages: z.array(DecisionStageSchema).min(1),
});
export type CashFlowDecision = z.infer<typeof CashFlowDecisionSchema>;

export const FutureCashFlowSchema = z.discriminatedUnion("kind", [
  CommitmentSchema,
  CashFlowDecisionSchema,
]);
export type FutureCashFlow = z.infer<typeof FutureCashFlowSchema>;

type ForecastCashFlowBase = {
  id: string;
  futureCashFlowId: string;
  stageId: string;
  name: string;
  date: string;
  amount: number;
  currency: FutureCashFlow["currency"];
  kind: FutureCashFlow["kind"];
  planningCaseId?: string;
};

export type ForecastCashFlow = ForecastCashFlowBase &
  (
    | { direction: "payment"; fromAccountId: string }
    | { direction: "receipt"; toAccountId: string }
  );

export type DecisionForecastSelection = {
  decisionIds: readonly string[];
  amount: "minimum" | "expected" | "maximum";
  timing: "earliest" | "expected" | "latest";
};

export function settledCashFlowAmount(
  actuals: readonly ActualCashFlow[],
): number {
  return actuals.reduce(
    (total, actual) =>
      total +
      (actual.direction === "payment" || actual.direction === "receipt"
        ? actual.amount
        : -actual.amount),
    0,
  );
}

function selectedDecisionAmount(
  stage: DecisionStage,
  selection: DecisionForecastSelection | undefined,
): number {
  if (selection?.amount === "minimum") {
    return stage.direction === "receipt"
      ? stage.maximumAmount
      : stage.minimumAmount;
  }
  if (selection?.amount === "maximum") {
    return stage.direction === "receipt"
      ? stage.minimumAmount
      : stage.maximumAmount;
  }
  return stage.expectedAmount;
}

function selectedDecisionDate(
  stage: DecisionStage,
  selection: DecisionForecastSelection | undefined,
): string {
  if (selection?.timing === "earliest") {
    return stage.direction === "receipt"
      ? (stage.latestDate ?? stage.expectedDate)
      : (stage.earliestDate ?? stage.expectedDate);
  }
  if (selection?.timing === "latest") {
    return stage.direction === "receipt"
      ? (stage.earliestDate ?? stage.expectedDate)
      : (stage.latestDate ?? stage.expectedDate);
  }
  return stage.expectedDate;
}

function decisionForecastItems(
  record: CashFlowDecision,
  selection: DecisionForecastSelection | undefined,
): ForecastCashFlow[] {
  return record.stages.flatMap((stage) => {
    const remaining = Math.max(
      selectedDecisionAmount(stage, selection) -
        settledCashFlowAmount(stage.actuals),
      0,
    );
    return remaining === 0
      ? []
      : [
          forecastItem(
            record,
            stage,
            selectedDecisionDate(stage, selection),
            remaining,
          ),
        ];
  });
}

export function futureCashFlowForecastItems(
  records: readonly FutureCashFlow[],
  selection?: DecisionForecastSelection,
): ForecastCashFlow[] {
  const selectedDecisionIds =
    selection == null ? null : new Set(selection.decisionIds);
  return records
    .flatMap((record): ForecastCashFlow[] => {
      if (record.kind === "commitment") {
        if (record.status !== "active") return [];
        return record.stages.flatMap((stage) => {
          const remaining = Math.max(
            stage.amount - settledCashFlowAmount(stage.actuals),
            0,
          );
          return remaining === 0
            ? []
            : [forecastItem(record, stage, stage.dueDate, remaining)];
        });
      }
      const included =
        selectedDecisionIds == null
          ? record.status === "selected"
          : selectedDecisionIds.has(record.id);
      if (!included) return [];
      return decisionForecastItems(record, selection);
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

function forecastItem(
  record: FutureCashFlow,
  stage: CommitmentStage | DecisionStage,
  date: string,
  amount: number,
): ForecastCashFlow {
  const base = {
    id: `${record.id}:${stage.id}`,
    futureCashFlowId: record.id,
    stageId: stage.id,
    name: stage.name == null ? record.name : `${record.name}: ${stage.name}`,
    date,
    amount,
    currency: record.currency,
    kind: record.kind,
    ...(record.planningCaseId == null
      ? {}
      : { planningCaseId: record.planningCaseId }),
  };
  return stage.direction === "payment"
    ? { ...base, direction: "payment", fromAccountId: stage.fromAccountId }
    : { ...base, direction: "receipt", toAccountId: stage.toAccountId };
}

export function futureCashFlowStageAccountId(
  stage: CommitmentStage | DecisionStage,
): string {
  return stage.direction === "payment"
    ? stage.fromAccountId
    : stage.toAccountId;
}

export function forecastCashFlowAccountId(flow: ForecastCashFlow): string {
  return flow.direction === "payment" ? flow.fromAccountId : flow.toAccountId;
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
        direction: "payment",
        fromAccountId: expenditure.fromAccountId,
        dueDate: expenditure.date,
        amount: expenditure.amount,
        actuals: [],
      },
    ],
  });
}

export function futureCashFlowAccountIds(record: FutureCashFlow): string[] {
  return Array.from(new Set(record.stages.map(futureCashFlowStageAccountId)));
}
