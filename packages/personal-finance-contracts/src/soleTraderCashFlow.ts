import type { FinancialFact } from "./sideIncome";

export type SoleTraderExpenseCategory =
  | "direct"
  | "bookkeeping"
  | "accountancy"
  | "other";

export type SoleTraderExpenseTreatment = {
  factId: string;
  taxTreatment: "allowable" | "disallowable";
  category: SoleTraderExpenseCategory;
};

export type CashFactAmount = {
  factId: string;
  amountPence: number;
};

export type SoleTraderCashPeriodInput = {
  id: string;
  startsOn: string;
  endsOn: string;
  invoiceReceipts: CashFactAmount[];
  expensePayments: CashFactAmount[];
  personalWithdrawalsPence: number;
  taxReserveTransferPence: number;
};

export type SoleTraderCashFlowInput = {
  openingAvailableCashPence: number;
  openingTaxReservePence: number;
  periods: SoleTraderCashPeriodInput[];
};

type CashFlowIssue = {
  code: string;
  detail: string;
};

const sum = (values: readonly number[]) =>
  values.reduce((total, value) => total + value, 0);

const amountByFact = (entries: readonly CashFactAmount[]) => {
  const amounts = new Map<string, number>();
  for (const entry of entries) {
    amounts.set(entry.factId, (amounts.get(entry.factId) ?? 0) + entry.amountPence);
  }
  return amounts;
};

const factsInPeriod = (
  facts: readonly FinancialFact[],
  startsOn: string,
  endsOn: string,
) => facts.filter((fact) => startsOn <= fact.occurredOn && fact.occurredOn <= endsOn);

const validatePeriods = (
  periods: readonly SoleTraderCashPeriodInput[],
): CashFlowIssue[] => {
  const issues: CashFlowIssue[] = [];
  for (let index = 0; index < periods.length; index += 1) {
    const period = periods[index];
    const previous = periods[index - 1];
    if (period === undefined) continue;
    if (period.startsOn > period.endsOn) {
      issues.push({
        code: "invalid-cash-period",
        detail: `${period.id} ends before it starts.`,
      });
    }
    if (previous !== undefined && period.startsOn <= previous.endsOn) {
      issues.push({
        code: "overlapping-cash-periods",
        detail: `${period.id} overlaps ${previous.id}.`,
      });
    }
  }
  return issues;
};

const validateFactAmounts = ({
  amounts,
  factsById,
  missingCode,
  missingLabel,
  excessCode,
  excessLabel,
}: {
  amounts: Map<string, number>;
  factsById: Map<string, FinancialFact>;
  missingCode: string;
  missingLabel: string;
  excessCode: string;
  excessLabel: string;
}): CashFlowIssue[] => {
  const issues: CashFlowIssue[] = [];
  for (const [factId, amountPence] of amounts) {
    const fact = factsById.get(factId);
    if (fact === undefined) {
      issues.push({ code: missingCode, detail: `${factId} ${missingLabel}.` });
    } else if (amountPence > fact.amount.minorUnits) {
      issues.push({ code: excessCode, detail: `${factId} ${excessLabel}.` });
    }
  }
  return issues;
};

export function calculateSoleTraderCashFlow({
  cashFlow,
  expenseFacts,
  expenseTreatments,
  revenueFacts,
}: {
  cashFlow: SoleTraderCashFlowInput;
  expenseFacts: FinancialFact[];
  expenseTreatments: SoleTraderExpenseTreatment[];
  revenueFacts: FinancialFact[];
}) {
  const revenueById = new Map(revenueFacts.map((fact) => [fact.id, fact]));
  const expenseById = new Map(expenseFacts.map((fact) => [fact.id, fact]));
  const treatmentById = new Map(
    expenseTreatments.map((treatment) => [treatment.factId, treatment]),
  );
  const orderedPeriods = [...cashFlow.periods].sort((left, right) =>
    left.startsOn.localeCompare(right.startsOn),
  );
  const allReceipts = amountByFact(
    orderedPeriods.flatMap((period) => period.invoiceReceipts),
  );
  const allExpensePayments = amountByFact(
    orderedPeriods.flatMap((period) => period.expensePayments),
  );
  const issues = [
    ...validatePeriods(orderedPeriods),
    ...validateFactAmounts({
      amounts: allReceipts,
      factsById: revenueById,
      missingCode: "unknown-revenue-receipt",
      missingLabel: "is not a selected sole-trader revenue fact",
      excessCode: "revenue-over-received",
      excessLabel: "has receipts above its invoiced amount",
    }),
    ...validateFactAmounts({
      amounts: allExpensePayments,
      factsById: expenseById,
      missingCode: "unknown-expense-payment",
      missingLabel: "is not a selected sole-trader expense fact",
      excessCode: "expense-overpaid",
      excessLabel: "has payments above its recorded cost",
    }),
  ];

  let availableCashPence = cashFlow.openingAvailableCashPence;
  let taxReservePence = cashFlow.openingTaxReservePence;
  let cumulativeInvoicedPence = 0;
  let cumulativeReceivedPence = 0;
  const periods = orderedPeriods.map((period) => {
    const invoicedPence = sum(
      factsInPeriod(revenueFacts, period.startsOn, period.endsOn).map(
        (fact) => fact.amount.minorUnits,
      ),
    );
    const costsIncurredPence = sum(
      factsInPeriod(expenseFacts, period.startsOn, period.endsOn).map(
        (fact) => fact.amount.minorUnits,
      ),
    );
    const cashReceivedPence = sum(
      period.invoiceReceipts.map((receipt) => receipt.amountPence),
    );
    const costsPaidPence = sum(
      period.expensePayments.map((payment) => payment.amountPence),
    );
    const bookkeepingPaidPence = sum(
      period.expensePayments
        .filter(
          (payment) => treatmentById.get(payment.factId)?.category === "bookkeeping",
        )
        .map((payment) => payment.amountPence),
    );
    const accountancyPaidPence = sum(
      period.expensePayments
        .filter(
          (payment) => treatmentById.get(payment.factId)?.category === "accountancy",
        )
        .map((payment) => payment.amountPence),
    );
    availableCashPence +=
      cashReceivedPence -
      costsPaidPence -
      period.personalWithdrawalsPence -
      period.taxReserveTransferPence;
    taxReservePence += period.taxReserveTransferPence;
    cumulativeInvoicedPence += invoicedPence;
    cumulativeReceivedPence += cashReceivedPence;
    return {
      id: period.id,
      startsOn: period.startsOn,
      endsOn: period.endsOn,
      invoicedRevenuePence: invoicedPence,
      cashReceivedPence,
      unpaidInvoicesPence: Math.max(
        0,
        cumulativeInvoicedPence - cumulativeReceivedPence,
      ),
      costsIncurredPence,
      costsPaidPence,
      bookkeepingPaidPence,
      accountancyPaidPence,
      personalWithdrawalsPence: period.personalWithdrawalsPence,
      taxReserveTransferPence: period.taxReserveTransferPence,
      availableCashPence,
      taxReservePence,
    };
  });

  return {
    periods,
    totals: {
      invoicedRevenuePence: sum(revenueFacts.map((fact) => fact.amount.minorUnits)),
      cashReceivedPence: sum([...allReceipts.values()]),
      unpaidInvoicesPence: Math.max(
        0,
        sum(revenueFacts.map((fact) => fact.amount.minorUnits)) -
          sum([...allReceipts.values()]),
      ),
      costsIncurredPence: sum(expenseFacts.map((fact) => fact.amount.minorUnits)),
      costsPaidPence: sum([...allExpensePayments.values()]),
      bookkeepingCostsPence: sum(
        expenseFacts
          .filter(
            (fact) => treatmentById.get(fact.id)?.category === "bookkeeping",
          )
          .map((fact) => fact.amount.minorUnits),
      ),
      accountancyCostsPence: sum(
        expenseFacts
          .filter(
            (fact) => treatmentById.get(fact.id)?.category === "accountancy",
          )
          .map((fact) => fact.amount.minorUnits),
      ),
      personalWithdrawalsPence: sum(
        orderedPeriods.map((period) => period.personalWithdrawalsPence),
      ),
      availableCashPence,
      taxReservePence,
    },
    issues,
  };
}

export type SoleTraderCashFlowResult = ReturnType<
  typeof calculateSoleTraderCashFlow
>;
