import { type ExpectedReturnChange, effectiveExpectedReturn } from "./account";
import { todayIsoDate } from "./assetTrackerCommands";
import type { AccountSummaryView } from "./assetTrackerViews";
import { ACCOUNT_COLORS } from "./constants";
import { monthlyAmount, type RecurringFlow } from "./recurringFlow";

const EXTERNAL_INCOME_NODE = "__external_income";
const EXTERNAL_SPENDING_NODE = "__external_spending";
const EXPECTED_RETURNS_NODE = "__expected_returns";
const EXPECTED_LOSSES_NODE = "__expected_losses";
const INTEREST_CHARGED_NODE = "__interest_charged";
const GROSS_PAY_NODE = "__gross_pay";
const TAX_NODE = "__tax";
const MIN_SYNTHETIC_FLOW = 1;

type FlowSankeyAccount = AccountSummaryView & {
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
      return "hsl(350, 65%, 55%)";
    case GROSS_PAY_NODE:
      return "hsl(205, 65%, 48%)";
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

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing function predates the complexity limit; new violations remain prohibited.
function addRecurringFlowLinks(
  flows: RecurringFlow[],
  liabilityBalances: Record<string, number>,
  builder: FlowSankeyBuilder,
) {
  const grossPayFlows = flows.filter(
    (flow) =>
      flow.compensationKind === "takeHomeIncome" && flow.grossAmount != null,
  );
  const grossPay = grossPayFlows.reduce(
    (total, flow) =>
      total +
      (flow.amount == null || flow.grossAmount == null
        ? 0
        : monthlyAmount(flow) * (flow.grossAmount / flow.amount)),
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
    if (
      grossPay > 0 &&
      flow.compensationKind === "takeHomeIncome" &&
      flow.grossAmount != null
    ) {
      builder.addLink(
        GROSS_PAY_NODE,
        flow.toAccountId ?? EXTERNAL_SPENDING_NODE,
        recurringFlowValue(flow, liabilityBalances),
        flow.name,
      );
      continue;
    }
    if (
      grossPay > 0 &&
      pensionFitsWithinGrossPay &&
      flow.compensationKind === "employeePension"
    ) {
      builder.addLink(
        GROSS_PAY_NODE,
        flow.toAccountId ?? EXTERNAL_SPENDING_NODE,
        recurringFlowValue(flow, liabilityBalances),
        flow.name,
      );
      continue;
    }
    builder.addLink(
      flow.fromAccountId ?? EXTERNAL_INCOME_NODE,
      flow.toAccountId ?? EXTERNAL_SPENDING_NODE,
      recurringFlowValue(flow, liabilityBalances),
      flow.name,
    );
  }

  if (grossPay > 0) {
    const taxAndDeductions =
      grossPay -
      takeHomePay -
      (pensionFitsWithinGrossPay ? employeePension : 0);
    if (taxAndDeductions > 0) {
      builder.addLink(
        GROSS_PAY_NODE,
        TAX_NODE,
        taxAndDeductions,
        "Tax and deductions",
      );
    }
  }
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
) {
  const today = todayIsoDate();
  for (const account of accounts) {
    const balance = account.latestBalance ?? 0;
    if (balance === 0) continue;

    const rate = effectiveExpectedReturn(account, today);
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

export function buildFlowSankeyData(
  accounts: FlowSankeyAccount[],
  flows: RecurringFlow[],
  liabilityBalances: Record<string, number>,
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

  addRecurringFlowLinks(activeFlows, liabilityBalances, builder);
  addSyntheticFlowLinks(openAccounts, activeFlows, liabilityBalances, builder);

  return {
    nodes,
    links: Array.from(linkTotals.values()).map((link) => ({
      ...link,
      value: roundCurrencyValue(link.value),
    })),
  };
}
