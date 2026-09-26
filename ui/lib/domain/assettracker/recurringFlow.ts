import { addDays, addMonths, format, parseISO } from "date-fns";
import { z } from "zod";
import { AccountIdSchema } from "./account";
import {
  type Currency,
  CurrencySchema,
  DEFAULT_BASE_CURRENCY,
} from "./currency";
import {
  type Money,
  NonNegativeMoneySchema,
  PositiveMoneySchema,
} from "./money";

export const FlowFrequencySchema = z.enum([
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
]);
export type FlowFrequency = z.infer<typeof FlowFrequencySchema>;

/**
 * Marks externally sourced recurring compensation so current savings and FI
 * projections can include pension contributions without treating them as
 * spendable take-home income.
 */
export const CompensationKindSchema = z.enum([
  "takeHomeIncome",
  "employeePension",
  "employerPension",
]);
export type CompensationKind = z.infer<typeof CompensationKindSchema>;

/**
 * A computed payment instead of a fixed amount. Credit card minimum
 * payments are the canonical case: a percentage of the outstanding balance
 * with a floor (e.g. greater of 2.5% or £25), never more than clears it.
 */
export const MinimumPaymentFormulaSchema = z.object({
  kind: z.literal("minimumPayment"),
  percentOfBalance: z
    .number()
    .positive("Percentage must be positive")
    .lt(1, "Use a fraction, e.g. 0.025 for 2.5%"),
  floor: z.number().nonnegative(),
});
export type MinimumPaymentFormula = z.infer<typeof MinimumPaymentFormulaSchema>;

export const RecurringFlowConversionSchema = z.object({
  received: PositiveMoneySchema,
  fee: NonNegativeMoneySchema.optional(),
  provider: z.string().trim().min(1).default("Currency conversion"),
});
export type RecurringFlowConversion = z.infer<
  typeof RecurringFlowConversionSchema
>;

/**
 * An expected regular movement of money: salary landing in an account,
 * a standing order into savings, a loan repayment. Flows feed projections;
 * they never alter recorded balances — reality stays whatever the user logs.
 */
export const RecurringFlowDefinitionShape = {
  name: z.string().min(1, "Give the flow a name"),
  fromAccountId: AccountIdSchema.optional(),
  toAccountId: AccountIdSchema.optional(),
  amount: z.number().positive("Amount must be positive").optional(),
  /** Currency of amount, grossAmount, and a formula floor. */
  currency: CurrencySchema.default(DEFAULT_BASE_CURRENCY),
  /** Expected result when source and destination currencies differ. */
  conversion: RecurringFlowConversionSchema.optional(),
  /** Gross pay before this take-home amount and salary sacrifice are deducted. */
  grossAmount: z.number().positive("Gross amount must be positive").optional(),
  /** Computed against the balance of the liability the flow pays down */
  formula: MinimumPaymentFormulaSchema.optional(),
  compensationKind: CompensationKindSchema.optional(),
  frequency: FlowFrequencySchema,
  endDate: z.iso.date().optional(),
};

const RecurringFlowDefinitionSchema = z.object(RecurringFlowDefinitionShape);
type RecurringFlowDefinition = z.infer<typeof RecurringFlowDefinitionSchema>;

function validateFlowEndpoints(
  flow: RecurringFlowDefinition,
  context: z.RefinementCtx,
) {
  if (flow.fromAccountId == null && flow.toAccountId == null) {
    context.addIssue({
      code: "custom",
      message: "A flow needs a source or a destination account",
    });
  }
  if (flow.fromAccountId === flow.toAccountId) {
    context.addIssue({
      code: "custom",
      message: "Source and destination must differ",
    });
  }
}

function validateFlowAmount(
  flow: RecurringFlowDefinition,
  context: z.RefinementCtx,
) {
  if ((flow.amount != null) === (flow.formula != null)) {
    context.addIssue({
      code: "custom",
      message: "Provide either an amount or a formula, not both",
    });
  }
  if (flow.formula != null && flow.frequency !== "monthly") {
    context.addIssue({
      code: "custom",
      message: "Formula payments must use a monthly frequency",
    });
  }
}

function validateFlowConversion(
  flow: RecurringFlowDefinition,
  context: z.RefinementCtx,
) {
  if (flow.formula != null && flow.conversion != null) {
    context.addIssue({
      code: "custom",
      message: "Formula payments cannot use a currency conversion",
    });
  }
  if (
    flow.conversion != null &&
    flow.conversion.received.currency === flow.currency
  ) {
    context.addIssue({
      code: "custom",
      message: "Converted money must use a different currency",
    });
  }
  if (
    flow.conversion?.fee != null &&
    flow.conversion.fee.currency !== flow.currency
  ) {
    context.addIssue({
      code: "custom",
      message: "Conversion fees must use the sent currency",
    });
  }
}

function validateFlowCompensation(
  flow: RecurringFlowDefinition,
  context: z.RefinementCtx,
) {
  const invalidCompensation =
    flow.compensationKind != null &&
    (flow.fromAccountId != null ||
      flow.toAccountId == null ||
      flow.amount == null ||
      flow.formula != null);
  if (invalidCompensation) {
    context.addIssue({
      code: "custom",
      message:
        "Compensation must be a fixed amount entering an account from outside the portfolio",
    });
  }
  const invalidGrossAmount =
    flow.grossAmount != null &&
    (flow.compensationKind !== "takeHomeIncome" ||
      flow.amount == null ||
      flow.grossAmount < flow.amount);
  if (invalidGrossAmount) {
    context.addIssue({
      code: "custom",
      message:
        "Gross amount is only valid for take-home income and cannot be less than take-home pay",
    });
  }
}

export function validateRecurringFlowDefinition(
  flow: RecurringFlowDefinition,
  context: z.RefinementCtx,
) {
  validateFlowEndpoints(flow, context);
  validateFlowAmount(flow, context);
  validateFlowConversion(flow, context);
  validateFlowCompensation(flow, context);
}

export const RecurringFlowSchema = z
  .object({
    id: z.string().min(1),
    ...RecurringFlowDefinitionShape,
    startDate: z.iso.date(),
  })
  .superRefine(validateRecurringFlowDefinition);

export type RecurringFlow = z.infer<typeof RecurringFlowSchema>;

export function recurringFlowMoney(flow: RecurringFlow): Money | null {
  return flow.amount == null
    ? null
    : { amount: flow.amount, currency: flow.currency };
}

export function recurringFlowReceivedMoney(flow: RecurringFlow): Money | null {
  return flow.conversion?.received ?? recurringFlowMoney(flow);
}

export function recurringFlowFeeMoney(flow: RecurringFlow): Money {
  return flow.conversion?.fee ?? { amount: 0, currency: flow.currency };
}

function monthlyScale(flow: RecurringFlow): number {
  return flow.amount == null || flow.amount === 0
    ? 0
    : monthlyAmount(flow) / flow.amount;
}

export function monthlyReceivedAmount(flow: RecurringFlow): number {
  const received = recurringFlowReceivedMoney(flow);
  return received == null ? 0 : received.amount * monthlyScale(flow);
}

export function monthlyFeeAmount(flow: RecurringFlow): number {
  return recurringFlowFeeMoney(flow).amount * monthlyScale(flow);
}

export function recurringFlowCurrency(flow: RecurringFlow): Currency {
  return flow.currency;
}

const MONTHS_PER_PERIOD: Record<FlowFrequency, number> = {
  weekly: 12 / 52,
  monthly: 1,
  quarterly: 3,
  yearly: 12,
};

/**
 * The flow's monthly-equivalent amount. Formula flows are evaluated against
 * the balance of the liability they pay down (`liabilityBalance`); a paid-off
 * or positive balance means no payment is due.
 */
export function monthlyAmount(
  flow: RecurringFlow,
  liabilityBalance?: number,
): number {
  if (flow.formula != null) {
    const owed = liabilityBalance != null ? Math.max(-liabilityBalance, 0) : 0;
    if (owed === 0) return 0;
    return Math.min(
      Math.max(owed * flow.formula.percentOfBalance, flow.formula.floor),
      owed,
    );
  }
  return (flow.amount ?? 0) / MONTHS_PER_PERIOD[flow.frequency];
}

function nextOccurrence(date: Date, frequency: FlowFrequency): Date {
  switch (frequency) {
    case "weekly":
      return addDays(date, 7);
    case "monthly":
      return addMonths(date, 1);
    case "quarterly":
      return addMonths(date, 3);
    case "yearly":
      return addMonths(date, 12);
  }
}

/** Hard cap so a misconfigured weekly flow can't generate unbounded dates */
const MAX_OCCURRENCES = 2000;

/**
 * Every date the flow falls due from its start through `throughDate`
 * (inclusive), honouring its end date. Pass `afterDateExclusive` to only get
 * occurrences strictly after a date — used to top up already-recorded periods.
 */
export function flowOccurrenceDates(
  flow: RecurringFlow,
  throughDate: string,
  afterDateExclusive?: string,
): string[] {
  const dates: string[] = [];
  let cursor = parseISO(flow.startDate);
  for (let i = 0; i < MAX_OCCURRENCES; i++) {
    const iso = format(cursor, "yyyy-MM-dd");
    if (iso > throughDate) break;
    const withinEnd = flow.endDate == null || iso <= flow.endDate;
    const afterFrom = afterDateExclusive == null || iso > afterDateExclusive;
    if (withinEnd && afterFrom) dates.push(iso);
    cursor = nextOccurrence(cursor, flow.frequency);
  }
  return dates;
}

export type UpcomingFlowOccurrence = {
  date: string;
  flow: RecurringFlow;
  amount: number;
};

/**
 * Every payment due across all flows in [fromDate, throughDate], date-sorted.
 * Formula payments are estimated against the liability's latest balance;
 * a flow with nothing due (debt already cleared) produces no occurrence.
 */
export function upcomingFlowOccurrences(
  flows: RecurringFlow[],
  fromDate: string,
  throughDate: string,
  liabilityBalances: Record<string, number> = {},
): UpcomingFlowOccurrence[] {
  const dayBeforeFrom = format(addDays(parseISO(fromDate), -1), "yyyy-MM-dd");
  const occurrences: UpcomingFlowOccurrence[] = [];
  for (const flow of flows) {
    const liabilityBalance =
      flow.toAccountId != null
        ? liabilityBalances[flow.toAccountId]
        : undefined;
    // Per-occurrence amount: the flow's own amount, not the monthly equivalent
    const amount = flow.formula
      ? monthlyAmount(flow, liabilityBalance)
      : (flow.amount ?? 0);
    if (amount <= 0) continue;
    for (const date of flowOccurrenceDates(flow, throughDate, dayBeforeFrom)) {
      occurrences.push({ date, flow, amount });
    }
  }
  return occurrences.sort((a, b) => a.date.localeCompare(b.date));
}
