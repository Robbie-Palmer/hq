import { addMonths, format, parseISO } from "date-fns";
import { z } from "zod";

const DatedAmountSchema = z.object({
  date: z.iso.date(),
  amount: z.number().nonnegative(),
});

export const MortgageTermsSchema = z.object({
  firstPaymentDate: z.iso.date(),
  remainingTermMonths: z.number().int().positive(),
  overpaymentAllowance: z
    .object({
      amount: z.number().nonnegative(),
      chargeRate: z.number().min(0).max(1),
    })
    .optional(),
  fees: z.array(DatedAmountSchema).default([]),
  overpayments: z.array(DatedAmountSchema).default([]),
  termChanges: z
    .array(
      z.object({
        date: z.iso.date(),
        remainingTermMonths: z.number().int().positive(),
      }),
    )
    .default([]),
});
export type MortgageTerms = z.infer<typeof MortgageTermsSchema>;

export type MortgageRateChange = {
  date: string;
  rate: number;
};

export type MortgageRepaymentType = "repayment" | "interest-only";

export type MortgageScheduleRow = {
  date: string;
  openingBalance: number;
  annualRate: number;
  scheduledPayment: number;
  interest: number;
  principal: number;
  fees: number;
  overpayment: number;
  overpaymentCharge: number;
  totalDue: number;
  closingBalance: number;
};

export type MortgageCashFlowSummary = {
  annualRequiredCashFlow: number;
  annualEconomicCost: number;
  annualPrincipal: number;
  payoffDate: string;
};

function paymentIndexAfter(firstPaymentDate: string, boundaryDate: string) {
  const first = parseISO(firstPaymentDate);
  let index = 0;
  while (
    index < 1_200 &&
    format(addMonths(first, index), "yyyy-MM-dd") <= boundaryDate
  ) {
    index += 1;
  }
  return index;
}

function paymentIndexAtOrAfter(firstPaymentDate: string, date: string) {
  const first = parseISO(firstPaymentDate);
  let index = 0;
  while (
    index < 1_200 &&
    format(addMonths(first, index), "yyyy-MM-dd") < date
  ) {
    index += 1;
  }
  return index;
}

/** Moves repayment assumptions past a newer recorded balance boundary. */
export function advanceMortgageTerms(
  input: MortgageTerms,
  recordedThroughDate: string,
): MortgageTerms {
  const terms = MortgageTermsSchema.parse(input);
  const elapsed = paymentIndexAfter(
    terms.firstPaymentDate,
    recordedThroughDate,
  );
  const futureFirstPayment = format(
    addMonths(parseISO(terms.firstPaymentDate), elapsed),
    "yyyy-MM-dd",
  );
  const activeTermChange = terms.termChanges
    .filter((change) => change.date <= recordedThroughDate)
    .toSorted((a, b) => a.date.localeCompare(b.date))
    .at(-1);
  let remainingTermMonths = Math.max(terms.remainingTermMonths - elapsed, 1);
  if (activeTermChange != null) {
    const changeIndex = paymentIndexAtOrAfter(
      terms.firstPaymentDate,
      activeTermChange.date,
    );
    remainingTermMonths = Math.max(
      activeTermChange.remainingTermMonths - Math.max(elapsed - changeIndex, 0),
      1,
    );
  }
  return {
    firstPaymentDate: futureFirstPayment,
    remainingTermMonths,
    ...(terms.overpaymentAllowance == null
      ? {}
      : { overpaymentAllowance: terms.overpaymentAllowance }),
    fees: terms.fees.filter((entry) => entry.date > recordedThroughDate),
    overpayments: terms.overpayments.filter(
      (entry) => entry.date > recordedThroughDate,
    ),
    termChanges: terms.termChanges.filter(
      (change) => change.date > recordedThroughDate,
    ),
  };
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function paymentFor(balance: number, annualRate: number, months: number) {
  if (months <= 0) return balance;
  const monthlyRate = annualRate / 12;
  if (monthlyRate === 0) return balance / months;
  return (
    (balance * monthlyRate * (1 + monthlyRate) ** months) /
    ((1 + monthlyRate) ** months - 1)
  );
}

function amountOn(
  entries: readonly { date: string; amount: number }[],
  date: string,
): number {
  return entries
    .filter((entry) => entry.date === date)
    .reduce((sum, entry) => sum + entry.amount, 0);
}

function rateOn(
  initialRate: number,
  changes: readonly MortgageRateChange[],
  date: string,
): number {
  return (
    changes
      .filter((change) => change.date <= date)
      .toSorted((a, b) => a.date.localeCompare(b.date))
      .at(-1)?.rate ?? initialRate
  );
}

function daysBetween(startDate: string, endDate: string): number {
  const millisecondsPerDay = 24 * 60 * 60 * 1_000;
  return Math.max(
    0,
    Math.round(
      (parseISO(endDate).getTime() - parseISO(startDate).getTime()) /
        millisecondsPerDay,
    ),
  );
}

function paymentDate(firstPaymentDate: string, index: number): string {
  return format(addMonths(parseISO(firstPaymentDate), index), "yyyy-MM-dd");
}

function activeTermChange(terms: MortgageTerms, date: string) {
  return terms.termChanges
    .filter((change) => change.date <= date)
    .toSorted((a, b) => a.date.localeCompare(b.date))
    .at(-1);
}

function interestForPeriod(input: {
  balance: number;
  annualRate: number;
  date: string;
  index: number;
  accrualStartDate?: string;
}): number {
  if (input.index > 0 || input.accrualStartDate == null) {
    return input.balance * (input.annualRate / 12);
  }
  return (
    input.balance *
    input.annualRate *
    (daysBetween(input.accrualStartDate, input.date) / 365)
  );
}

function scheduledPaymentFor(input: {
  balance: number;
  interest: number;
  repaymentPayment: number;
  repaymentType: MortgageRepaymentType;
  remainingMonths: number;
}): number {
  if (input.repaymentType === "repayment") {
    return Math.min(input.repaymentPayment, input.balance + input.interest);
  }
  const principalAtMaturity = input.remainingMonths <= 1 ? input.balance : 0;
  return Math.min(
    input.interest + principalAtMaturity,
    input.balance + input.interest,
  );
}

function overpaymentFor(input: {
  terms: MortgageTerms;
  date: string;
  requested: number;
  maximum: number;
  annualAllowanceUsed: Map<string, number>;
}): { overpayment: number; charge: number } {
  const overpayment = Math.min(input.requested, input.maximum);
  const allowance = input.terms.overpaymentAllowance;
  const allowanceYear = input.date.slice(0, 4);
  const allowanceUsed = input.annualAllowanceUsed.get(allowanceYear) ?? 0;
  const penaltyFreeRemaining = Math.max(
    (allowance?.amount ?? Number.POSITIVE_INFINITY) - allowanceUsed,
    0,
  );
  const penaltyFreeOverpayment = Math.min(overpayment, penaltyFreeRemaining);
  input.annualAllowanceUsed.set(
    allowanceYear,
    allowanceUsed + penaltyFreeOverpayment,
  );
  return {
    overpayment,
    charge:
      Math.max(overpayment - penaltyFreeOverpayment, 0) *
      (allowance?.chargeRate ?? 0),
  };
}

/**
 * Builds a forward repayment schedule from a recorded balance. The recorded
 * balance is the boundary between history and assumptions, so changing a
 * future rate, term, fee, or overpayment never rewrites past payments.
 */
export function buildMortgageSchedule(input: {
  openingBalance: number;
  initialAnnualRate: number;
  rateChanges?: readonly MortgageRateChange[];
  terms: MortgageTerms;
  repaymentType?: MortgageRepaymentType;
  monthlyOverpayment?: number;
  /** Enables daily interest for a short or long first payment period. */
  accrualStartDate?: string;
}): MortgageScheduleRow[] {
  const terms = MortgageTermsSchema.parse(input.terms);
  const rateChanges = input.rateChanges ?? [];
  const repaymentType = input.repaymentType ?? "repayment";
  const monthlyOverpayment = Math.max(input.monthlyOverpayment ?? 0, 0);
  let balance = Math.abs(input.openingBalance);
  let remainingMonths = terms.remainingTermMonths;
  let payment = 0;
  let previousRate: number | null = null;
  let previousTermChangeDate: string | null = null;
  const rows: MortgageScheduleRow[] = [];
  const annualAllowanceUsed = new Map<string, number>();

  for (let index = 0; balance > 0 && index < 1_200; index++) {
    const date = paymentDate(terms.firstPaymentDate, index);
    const termChange = activeTermChange(terms, date);
    const currentRate = rateOn(input.initialAnnualRate, rateChanges, date);
    const changedTerm =
      termChange != null && termChange.date !== previousTermChangeDate;
    if (changedTerm) remainingMonths = termChange.remainingTermMonths;
    if (index === 0 || currentRate !== previousRate || changedTerm) {
      payment = paymentFor(balance, currentRate, remainingMonths);
    }

    const openingBalance = balance;
    const interest = interestForPeriod({
      balance: openingBalance,
      annualRate: currentRate,
      date,
      index,
      accrualStartDate: input.accrualStartDate,
    });
    const scheduledPayment = scheduledPaymentFor({
      balance: openingBalance,
      interest,
      repaymentPayment: payment,
      repaymentType,
      remainingMonths,
    });
    const scheduledPrincipal = Math.max(scheduledPayment - interest, 0);
    const requestedOverpayment =
      amountOn(terms.overpayments, date) + monthlyOverpayment;
    const { overpayment, charge: overpaymentCharge } = overpaymentFor({
      terms,
      date,
      requested: requestedOverpayment,
      maximum: Math.max(openingBalance - scheduledPrincipal, 0),
      annualAllowanceUsed,
    });
    const principal = Math.min(
      scheduledPrincipal + overpayment,
      openingBalance,
    );
    const fees = amountOn(terms.fees, date);
    // Mortgage ledgers settle in currency units. Carrying fractions of a penny
    // can otherwise leave a phantom final payment after a full overpayment.
    balance = roundMoney(Math.max(openingBalance - principal, 0));
    rows.push({
      date,
      openingBalance: roundMoney(openingBalance),
      annualRate: currentRate,
      scheduledPayment: roundMoney(scheduledPayment),
      interest: roundMoney(interest),
      principal: roundMoney(principal),
      fees: roundMoney(fees),
      overpayment: roundMoney(overpayment),
      overpaymentCharge: roundMoney(overpaymentCharge),
      totalDue: roundMoney(
        scheduledPayment + overpayment + overpaymentCharge + fees,
      ),
      closingBalance: roundMoney(balance),
    });
    remainingMonths -= 1;
    previousRate = currentRate;
    previousTermChangeDate = termChange?.date ?? null;
  }

  if (balance > 0) {
    throw new Error("Mortgage schedule did not repay within 100 years");
  }
  return rows;
}

export function summarizeMortgageCashFlow(
  schedule: readonly MortgageScheduleRow[],
  asOfDate: string,
): MortgageCashFlowSummary | null {
  const future = schedule.filter((row) => row.date >= asOfDate);
  const payoffDate = future.at(-1)?.date;
  if (payoffDate == null) return null;
  const nextYear = future.slice(0, 12);
  return {
    annualRequiredCashFlow: roundMoney(
      nextYear.reduce((sum, row) => sum + row.totalDue, 0),
    ),
    annualEconomicCost: roundMoney(
      nextYear.reduce(
        (sum, row) => sum + row.interest + row.fees + row.overpaymentCharge,
        0,
      ),
    ),
    annualPrincipal: roundMoney(
      nextYear.reduce((sum, row) => sum + row.principal, 0),
    ),
    payoffDate,
  };
}
