import type { HouseholdTaxEstimate } from "finance-tax-rules/household-tax";
import {
  type ExpectedReturnChange,
  effectiveExpectedReturn,
} from "@/lib/domain/assettracker/account";
import type { AssetTrackerRepository } from "@/lib/domain/assettracker/assetTrackerRepository";
import type { AccountSummaryView } from "@/lib/domain/assettracker/assetTrackerViews";
import type { Money } from "@/lib/domain/assettracker/money";
import {
  convertMoneyAtDate,
  latestValuedBalances,
} from "@/lib/domain/assettracker/portfolioValuation";
import {
  monthlyAmount,
  type RecurringFlow,
} from "@/lib/domain/assettracker/recurringFlow";
import type { TaxPositionData } from "@/lib/domain/assettracker/taxPosition";
import { ACCOUNT_COLORS } from "./presentation";

const EXTERNAL_INCOME_NODE = "__external_income";
const EXTERNAL_SPENDING_NODE = "__external_spending";
const EXPECTED_RETURNS_NODE = "__expected_returns";
const EXPECTED_LOSSES_NODE = "__expected_losses";
const INTEREST_CHARGED_NODE = "__interest_charged";
const GROSS_PAY_NODE = "__gross_pay";
const TAX_NODE = "__tax";
const PAYROLL_DEDUCTIONS_NODE = "__payroll_deductions";
const AFTER_TAX_INCOME_NODE = "__after_tax_income";
const MIN_SYNTHETIC_FLOW = 1;

export type FlowSankeyAccount = Partial<AccountSummaryView> &
  Pick<
    AccountSummaryView,
    "expectedAnnualReturn" | "id" | "isOpen" | "latestBalance" | "name"
  > & {
    expectedReturnChanges?: ExpectedReturnChange[];
    linkedAccountId?: string;
  };

export type FlowSankeyNode = {
  id: string;
  name: string;
  color: string;
};

export type FlowSankeyLink = {
  source: number;
  target: number;
  value: number;
  label: string;
  sourceName: string;
  targetName: string;
};

export type FlowSankeyData = {
  nodes: FlowSankeyNode[];
  links: FlowSankeyLink[];
  taxYear?: string;
};

export type FlowSankeyTaxInput = {
  estimate: HouseholdTaxEstimate;
  records: TaxPositionData;
};

type FlowSankeyBuilder = {
  addLink: (
    sourceId: string,
    targetId: string,
    value: number,
    label: string,
  ) => void;
};

function accountColor(index: number): string {
  return ACCOUNT_COLORS[index % ACCOUNT_COLORS.length] ?? ACCOUNT_COLORS[0];
}

function nodeName(id: string, account?: FlowSankeyAccount): string {
  switch (id) {
    case EXTERNAL_INCOME_NODE:
      return "External income";
    case EXTERNAL_SPENDING_NODE:
      return "External spending";
    case EXPECTED_RETURNS_NODE:
      return "Expected returns";
    case EXPECTED_LOSSES_NODE:
      return "Expected losses";
    case INTEREST_CHARGED_NODE:
      return "Interest charged";
    case GROSS_PAY_NODE:
      return "Gross pay";
    case TAX_NODE:
      return "Tax and deductions";
    case PAYROLL_DEDUCTIONS_NODE:
      return "Other payroll deductions";
    case AFTER_TAX_INCOME_NODE:
      return "After-tax employment income";
    default:
      return account?.name ?? id;
  }
}

function nodeColor(id: string, index: number): string {
  switch (id) {
    case EXTERNAL_INCOME_NODE:
    case EXTERNAL_SPENDING_NODE:
      return "hsl(220, 10%, 60%)";
    case EXPECTED_RETURNS_NODE:
      return "hsl(145, 55%, 45%)";
    case EXPECTED_LOSSES_NODE:
      return "hsl(20, 75%, 55%)";
    case INTEREST_CHARGED_NODE:
    case TAX_NODE:
    case PAYROLL_DEDUCTIONS_NODE:
      return "hsl(350, 65%, 55%)";
    case GROSS_PAY_NODE:
      return "hsl(205, 65%, 48%)";
    case AFTER_TAX_INCOME_NODE:
      return "hsl(175, 50%, 42%)";
    default:
      return accountColor(index);
  }
}

function monthlyExpectedChange(balance: number, annualRate: number): number {
  if (annualRate <= -1 || !Number.isFinite(annualRate)) return 0;
  return balance * ((1 + annualRate) ** (1 / 12) - 1);
}

function recurringFlowValue(
  flow: RecurringFlow,
  liabilityBalances: Record<string, number>,
): number {
  const liabilityBalance =
    flow.toAccountId != null ? liabilityBalances[flow.toAccountId] : undefined;
  return flow.formula
    ? monthlyAmount(flow, liabilityBalance)
    : monthlyAmount(flow);
}

function grossRecurringFlowValue(flow: RecurringFlow): number {
  if (flow.amount == null || flow.grossAmount == null) return 0;
  return monthlyAmount(flow) * (flow.grossAmount / flow.amount);
}

function addRecurringFlowLink(
  flow: RecurringFlow,
  liabilityBalances: Record<string, number>,
  builder: FlowSankeyBuilder,
  grossPay: number,
  pensionFitsWithinGrossPay: boolean,
): void {
  const value = recurringFlowValue(flow, liabilityBalances);
  if (
    grossPay > 0 &&
    flow.compensationKind === "takeHomeIncome" &&
    flow.grossAmount != null
  ) {
    builder.addLink(
      GROSS_PAY_NODE,
      flow.toAccountId ?? EXTERNAL_SPENDING_NODE,
      value,
      flow.name,
    );
    return;
  }
  if (
    grossPay > 0 &&
    pensionFitsWithinGrossPay &&
    flow.compensationKind === "employeePension"
  ) {
    builder.addLink(
      GROSS_PAY_NODE,
      flow.toAccountId ?? EXTERNAL_SPENDING_NODE,
      value,
      flow.name,
    );
    return;
  }
  builder.addLink(
    flow.fromAccountId ?? EXTERNAL_INCOME_NODE,
    flow.toAccountId ?? EXTERNAL_SPENDING_NODE,
    value,
    flow.name,
  );
}

function addPayrollGapLinks({
  builder,
  employeePension,
  estimatedEmploymentTax,
  grossPay,
  pensionFitsWithinGrossPay,
  takeHomePay,
}: {
  builder: FlowSankeyBuilder;
  employeePension: number;
  estimatedEmploymentTax: number | null;
  grossPay: number;
  pensionFitsWithinGrossPay: boolean;
  takeHomePay: number;
}): void {
  if (grossPay <= 0) return;
  const payrollGap =
    grossPay - takeHomePay - (pensionFitsWithinGrossPay ? employeePension : 0);
  const taxAndNi = estimatedEmploymentTax ?? payrollGap;
  if (taxAndNi > 0) {
    builder.addLink(
      GROSS_PAY_NODE,
      TAX_NODE,
      taxAndNi,
      estimatedEmploymentTax == null
        ? "Tax and deductions"
        : "Estimated Income Tax and National Insurance",
    );
  }
  const otherDeductions = payrollGap - taxAndNi;
  if (estimatedEmploymentTax != null && otherDeductions > 0) {
    builder.addLink(
      GROSS_PAY_NODE,
      PAYROLL_DEDUCTIONS_NODE,
      otherDeductions,
      "Other payroll deductions",
    );
  }
}

function addRecurringFlowLinks(
  flows: RecurringFlow[],
  liabilityBalances: Record<string, number>,
  builder: FlowSankeyBuilder,
  estimatedEmploymentTax: number | null,
): boolean {
  const grossPayFlows = flows.filter(
    (flow) =>
      flow.compensationKind === "takeHomeIncome" && flow.grossAmount != null,
  );
  const grossPay = grossPayFlows.reduce(
    (total, flow) => total + grossRecurringFlowValue(flow),
    0,
  );
  const employeePensionFlows = flows.filter(
    (flow) => flow.compensationKind === "employeePension",
  );
  const takeHomePay = grossPayFlows.reduce(
    (total, flow) => total + recurringFlowValue(flow, liabilityBalances),
    0,
  );
  const employeePension = employeePensionFlows.reduce(
    (total, flow) => total + recurringFlowValue(flow, liabilityBalances),
    0,
  );
  const allocatedGrossPay = takeHomePay + employeePension;
  const allocationTolerance =
    Math.max(1, grossPay, allocatedGrossPay) * Number.EPSILON * 4;
  const pensionFitsWithinGrossPay =
    grossPay + allocationTolerance >= allocatedGrossPay;

  if (grossPay > 0) {
    builder.addLink(
      EXTERNAL_INCOME_NODE,
      GROSS_PAY_NODE,
      grossPay,
      "Gross salary",
    );
  }

  for (const flow of flows) {
    addRecurringFlowLink(
      flow,
      liabilityBalances,
      builder,
      grossPay,
      pensionFitsWithinGrossPay,
    );
  }

  addPayrollGapLinks({
    builder,
    employeePension,
    estimatedEmploymentTax,
    grossPay,
    pensionFitsWithinGrossPay,
    takeHomePay,
  });

  return grossPay > 0;
}

function monthlyIncoming(
  accountId: string,
  flows: RecurringFlow[],
  liabilityBalances: Record<string, number>,
): number {
  return flows.reduce((total, flow) => {
    if (flow.toAccountId !== accountId) return total;
    return total + recurringFlowValue(flow, liabilityBalances);
  }, 0);
}

function monthlyOutgoing(
  flowAccountId: string,
  flows: RecurringFlow[],
): number {
  return flows.reduce((total, flow) => {
    if (flow.fromAccountId !== flowAccountId) return total;
    return total + monthlyAmount(flow);
  }, 0);
}

function monthlyNetFlow(
  accountId: string,
  flows: RecurringFlow[],
  liabilityBalances: Record<string, number>,
): number {
  return (
    monthlyIncoming(accountId, flows, liabilityBalances) -
    monthlyOutgoing(accountId, flows)
  );
}

function addLinkedLiabilityPrincipalFlow(
  account: FlowSankeyAccount,
  interestCharged: number,
  flows: RecurringFlow[],
  liabilityBalances: Record<string, number>,
  builder: FlowSankeyBuilder,
) {
  if (account.linkedAccountId == null) return;

  const principal = Math.max(
    0,
    monthlyNetFlow(account.id, flows, liabilityBalances) - interestCharged,
  );
  if (principal < MIN_SYNTHETIC_FLOW) return;

  builder.addLink(
    account.id,
    account.linkedAccountId,
    principal,
    "Principal repayment",
  );
}

function addNegativeExpectedChangeLink(
  account: FlowSankeyAccount,
  value: number,
  flows: RecurringFlow[],
  liabilityBalances: Record<string, number>,
  builder: FlowSankeyBuilder,
) {
  if ((account.latestBalance ?? 0) < 0) {
    builder.addLink(
      account.id,
      INTEREST_CHARGED_NODE,
      value,
      "Interest charged",
    );
    addLinkedLiabilityPrincipalFlow(
      account,
      value,
      flows,
      liabilityBalances,
      builder,
    );
    return;
  }

  builder.addLink(account.id, EXPECTED_LOSSES_NODE, value, "Expected loss");
}

function addSyntheticFlowLinks(
  accounts: FlowSankeyAccount[],
  flows: RecurringFlow[],
  liabilityBalances: Record<string, number>,
  builder: FlowSankeyBuilder,
  asOfDate: string,
) {
  for (const account of accounts) {
    const balance = account.latestBalance ?? 0;
    if (balance === 0) continue;

    const rate = effectiveExpectedReturn(account, asOfDate);
    if (rate === 0) continue;

    const change = monthlyExpectedChange(balance, rate);
    const value = Math.abs(change);
    if (value < MIN_SYNTHETIC_FLOW) continue;

    if (change > 0) {
      builder.addLink(
        EXPECTED_RETURNS_NODE,
        account.id,
        value,
        "Expected return",
      );
    } else {
      addNegativeExpectedChangeLink(
        account,
        value,
        flows,
        liabilityBalances,
        builder,
      );
    }
  }
}

function roundCurrencyValue(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function monthlyTaxAmount(amountPence: number): number {
  return amountPence / 100 / 12;
}

function estimatedEmploymentTax(taxInput?: FlowSankeyTaxInput): number | null {
  if (!taxInput?.estimate.available) return null;
  return monthlyTaxAmount(
    taxInput.estimate.people.reduce(
      (total, person) =>
        total +
        person.incomeTax.amountPence +
        person.nationalInsurance.amountPence,
      0,
    ),
  );
}

function addDistributedTaxLinks<T extends { accountId: string; id: string }>(
  records: readonly T[],
  amountPence: number,
  weight: (record: T) => number,
  label: string,
  openAccountIds: ReadonlySet<string>,
  builder: FlowSankeyBuilder,
) {
  const totalWeight = records.reduce(
    (total, record) => total + Math.max(0, weight(record)),
    0,
  );
  if (amountPence <= 0 || totalWeight <= 0) return;

  for (const record of records) {
    if (!openAccountIds.has(record.accountId)) continue;
    const share = Math.max(0, weight(record)) / totalWeight;
    builder.addLink(
      record.accountId,
      TAX_NODE,
      monthlyTaxAmount(amountPence * share),
      label,
    );
  }
}

function addTaxEstimateLinks(
  taxInput: FlowSankeyTaxInput | undefined,
  hasGrossPayFlow: boolean,
  openAccountIds: ReadonlySet<string>,
  builder: FlowSankeyBuilder,
) {
  if (!taxInput?.estimate.available) return;

  const incomeById = new Map(
    taxInput.records.income.map((record) => [record.id, record]),
  );
  const disposalById = new Map(
    taxInput.records.disposals.map((record) => [record.id, record]),
  );
  const employmentTaxPence = taxInput.estimate.people.reduce(
    (total, person) =>
      total +
      person.incomeTax.amountPence +
      person.nationalInsurance.amountPence,
    0,
  );

  if (!hasGrossPayFlow) {
    const employmentRecordIds = new Set(
      taxInput.estimate.people.flatMap(({ incomeTax }) => incomeTax.recordIds),
    );
    const employmentPence = [...employmentRecordIds].reduce(
      (total, id) => total + (incomeById.get(id)?.amountPence ?? 0),
      0,
    );
    builder.addLink(
      EXTERNAL_INCOME_NODE,
      GROSS_PAY_NODE,
      monthlyTaxAmount(employmentPence),
      "Recorded employment income",
    );
    builder.addLink(
      GROSS_PAY_NODE,
      TAX_NODE,
      monthlyTaxAmount(employmentTaxPence),
      "Estimated Income Tax and National Insurance",
    );
    builder.addLink(
      GROSS_PAY_NODE,
      AFTER_TAX_INCOME_NODE,
      monthlyTaxAmount(Math.max(0, employmentPence - employmentTaxPence)),
      "Income after estimated tax and NI",
    );
  }

  for (const person of taxInput.estimate.people) {
    const savingsInterest = person.savingsTax.recordIds.flatMap((id) => {
      const record = incomeById.get(id);
      return record?.kind === "savings-interest" && record.accountId != null
        ? [record as typeof record & { accountId: string }]
        : [];
    });
    addDistributedTaxLinks(
      savingsInterest,
      person.savingsTax.amountPence,
      ({ amountPence }) => amountPence,
      "Estimated savings interest tax",
      openAccountIds,
      builder,
    );

    const dividends = person.dividendTax.recordIds.flatMap((id) => {
      const record = incomeById.get(id);
      return record?.kind === "dividend" && record.accountId != null
        ? [record as typeof record & { accountId: string }]
        : [];
    });
    addDistributedTaxLinks(
      dividends,
      person.dividendTax.amountPence,
      ({ amountPence }) => amountPence,
      "Estimated Dividend Tax",
      openAccountIds,
      builder,
    );

    const disposals = person.capitalGainsTax.recordIds.flatMap((id) => {
      const record = disposalById.get(id);
      return record == null ? [] : [record];
    });
    addDistributedTaxLinks(
      disposals,
      person.capitalGainsTax.amountPence,
      ({ proceedsPence, allowableCostPence, lossesAppliedPence }) =>
        Math.max(0, proceedsPence - allowableCostPence - lossesAppliedPence),
      "Estimated Capital Gains Tax",
      openAccountIds,
      builder,
    );
  }
}

export function buildFlowSankeyData(
  accounts: FlowSankeyAccount[],
  flows: RecurringFlow[],
  liabilityBalances: Record<string, number>,
  asOfDate: string,
  taxInput?: FlowSankeyTaxInput,
): FlowSankeyData {
  const openAccounts = accounts.filter((account) => account.isOpen);
  const openAccountIds = new Set(openAccounts.map((account) => account.id));
  const activeFlows = flows.filter(
    (flow) =>
      (flow.fromAccountId == null || openAccountIds.has(flow.fromAccountId)) &&
      (flow.toAccountId == null || openAccountIds.has(flow.toAccountId)),
  );
  const accountById = new Map(
    openAccounts.map((account) => [account.id, account]),
  );
  const nodeIndexes = new Map<string, number>();
  const nodes: FlowSankeyNode[] = [];
  const linkTotals = new Map<string, FlowSankeyLink>();

  function addNode(id: string): number {
    const existing = nodeIndexes.get(id);
    if (existing != null) return existing;

    const account = accountById.get(id);
    const index = nodes.length;
    nodes.push({
      id,
      name: nodeName(id, account),
      color: nodeColor(id, index),
    });
    nodeIndexes.set(id, index);
    return index;
  }

  const builder: FlowSankeyBuilder = {
    addLink(sourceId, targetId, value, label) {
      const roundedValue = roundCurrencyValue(value);
      if (roundedValue <= 0) return;

      const source = addNode(sourceId);
      const target = addNode(targetId);
      const key = `${source}->${target}`;
      const existing = linkTotals.get(key);
      if (existing) {
        existing.value = roundCurrencyValue(existing.value + roundedValue);
        const labels = new Set(existing.label.split(", "));
        labels.add(label);
        existing.label = Array.from(labels).join(", ");
        return;
      }

      linkTotals.set(key, {
        source,
        target,
        value: roundedValue,
        label,
        sourceName: nodes[source]?.name ?? sourceId,
        targetName: nodes[target]?.name ?? targetId,
      });
    },
  };

  const hasGrossPayFlow = addRecurringFlowLinks(
    activeFlows,
    liabilityBalances,
    builder,
    estimatedEmploymentTax(taxInput),
  );
  addTaxEstimateLinks(taxInput, hasGrossPayFlow, openAccountIds, builder);
  addSyntheticFlowLinks(
    openAccounts,
    activeFlows,
    liabilityBalances,
    builder,
    asOfDate,
  );

  return {
    nodes,
    links: Array.from(linkTotals.values()).map((link) => ({
      ...link,
      value: roundCurrencyValue(link.value),
    })),
    ...(taxInput?.estimate.available
      ? { taxYear: taxInput.estimate.taxYear }
      : {}),
  };
}

function convertFlowMoney(
  repository: AssetTrackerRepository,
  value: Money,
  date: string,
): number | null {
  return convertMoneyAtDate(repository, value, date);
}

function baseFlow(
  flow: RecurringFlow,
  currency: RecurringFlow["currency"],
  id: string,
  name: string,
  amount: number,
  fromAccountId: string | undefined,
  toAccountId: string | undefined,
): RecurringFlow {
  return {
    ...flow,
    id,
    name,
    fromAccountId,
    toAccountId,
    amount,
    currency,
    conversion: undefined,
    formula: undefined,
    compensationKind: undefined,
    grossAmount: undefined,
  };
}

function resolveConvertedFlow(
  repository: AssetTrackerRepository,
  flow: RecurringFlow,
  sent: number,
  date: string,
): { accounts: FlowSankeyAccount[]; flows: RecurringFlow[] } | null {
  const conversion = flow.conversion;
  if (conversion == null) return null;
  const received = convertFlowMoney(repository, conversion.received, date);
  const fee = convertFlowMoney(
    repository,
    conversion.fee ?? { amount: 0, currency: flow.currency },
    date,
  );
  if (received == null || fee == null) return null;
  const conversionId = `__conversion:${flow.id}`;
  const sentWithFee = sent + fee;
  const difference = sentWithFee - received;
  const flows = [
    baseFlow(
      flow,
      repository.settings.baseCurrency,
      `${flow.id}:sent`,
      flow.name,
      sentWithFee,
      flow.fromAccountId,
      conversionId,
    ),
    baseFlow(
      flow,
      repository.settings.baseCurrency,
      `${flow.id}:received`,
      flow.name,
      received,
      conversionId,
      flow.toAccountId,
    ),
  ];
  if (difference > 0) {
    flows.push(
      baseFlow(
        flow,
        repository.settings.baseCurrency,
        `${flow.id}:cost`,
        "Conversion fee and spread",
        difference,
        conversionId,
        undefined,
      ),
    );
  } else if (difference < 0) {
    flows.push(
      baseFlow(
        flow,
        repository.settings.baseCurrency,
        `${flow.id}:benefit`,
        "Conversion rate benefit",
        Math.abs(difference),
        undefined,
        conversionId,
      ),
    );
  }
  return {
    accounts: [
      {
        id: conversionId,
        name: conversion.provider,
        isOpen: true,
        latestBalance: 0,
        expectedAnnualReturn: 0,
      },
    ],
    flows,
  };
}

function resolveFlowInBaseCurrency(
  repository: AssetTrackerRepository,
  flow: RecurringFlow,
  date: string,
): { accounts: FlowSankeyAccount[]; flows: RecurringFlow[] } | null {
  if (flow.amount == null) {
    const floor =
      flow.formula == null
        ? null
        : convertFlowMoney(
            repository,
            { amount: flow.formula.floor, currency: flow.currency },
            date,
          );
    if (flow.formula != null && floor == null) return null;
    return {
      accounts: [],
      flows: [
        {
          ...flow,
          currency: repository.settings.baseCurrency,
          formula:
            flow.formula == null
              ? undefined
              : { ...flow.formula, floor: floor ?? 0 },
        },
      ],
    };
  }

  const sent = convertFlowMoney(
    repository,
    { amount: flow.amount, currency: flow.currency },
    date,
  );
  const gross =
    flow.grossAmount == null
      ? undefined
      : convertFlowMoney(
          repository,
          { amount: flow.grossAmount, currency: flow.currency },
          date,
        );
  if (sent == null || gross === null) return null;
  if (flow.conversion == null) {
    return {
      accounts: [],
      flows: [
        {
          ...flow,
          amount: sent,
          grossAmount: gross,
          currency: repository.settings.baseCurrency,
        },
      ],
    };
  }

  return resolveConvertedFlow(repository, flow, sent, date);
}

export function buildBaseCurrencyFlowSankeyData(
  repository: AssetTrackerRepository,
  accounts: FlowSankeyAccount[],
  date: string,
  taxInput?: FlowSankeyTaxInput,
): FlowSankeyData {
  const balances = latestValuedBalances(repository);
  if (balances == null) return { nodes: [], links: [] };
  const baseAccounts = accounts.map((account) => ({
    ...account,
    latestBalance: balances.get(account.id) ?? 0,
  }));
  const resolved = repository.recurringFlows.map((flow) =>
    resolveFlowInBaseCurrency(repository, flow, date),
  );
  if (resolved.some((item) => item == null)) return { nodes: [], links: [] };
  const conversionAccounts = resolved.flatMap((item) => item?.accounts ?? []);
  const flows = resolved.flatMap((item) => item?.flows ?? []);
  const liabilityBalances = Object.fromEntries(
    baseAccounts.map((account) => [account.id, account.latestBalance ?? 0]),
  );
  return buildFlowSankeyData(
    [...baseAccounts, ...conversionAccounts],
    flows,
    liabilityBalances,
    date,
    taxInput,
  );
}
