import {
  addMonths,
  differenceInCalendarMonths,
  format,
  isAfter,
  max,
  parseISO,
} from "date-fns";
import {
  type Account,
  type AccountAccessPolicy,
  accountLiquidity,
  effectiveExpectedReturn,
  isLiability,
  type TaxWrapper,
  type WithdrawalTaxTreatment,
} from "./account";

export type RetirementCapitalAccount = Pick<
  Account,
  | "id"
  | "name"
  | "provider"
  | "assetType"
  | "liquidity"
  | "taxWrapper"
  | "accessPolicy"
  | "expectedAnnualReturn"
  | "expectedReturnChanges"
> & {
  balance: number;
};

export type RetirementHousingRelease = {
  id: string;
  date: string;
  sourcePropertyAccountId: string;
  destinationAccountId: string;
  grossProceeds: number;
  retainedHousingValue: number;
  tax: number;
  fees: number;
  liabilitySettlements: Array<{ accountId: string; amount: number }>;
};

export type RetirementCapitalScenario = {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
  annualSpending: number;
  accounts: RetirementCapitalAccount[];
  /** Only listed accounts may fund spending, in this exact order. */
  withdrawalOrder: string[];
  housingReleases?: RetirementHousingRelease[];
};

export type RetirementWithdrawal = {
  accountId: string;
  accountName: string;
  taxWrapper: TaxWrapper;
  grossWithdrawal: number;
  tax: number;
  fee: number;
  netSpendingCash: number;
};

export type RetirementCapitalRestriction = {
  accountId: string;
  accountName: string;
  reason:
    | "not-selected"
    | "ordinary-spending-disabled"
    | "access-date-required"
    | "not-yet-accessible"
    | "unsupported-tax-treatment";
  detail: string;
};

export type AppliedHousingRelease = RetirementHousingRelease & {
  netReleasedCapital: number;
};

export type RetirementCapitalForecastPoint = {
  date: string;
  spendingRequired: number;
  withdrawals: RetirementWithdrawal[];
  grossWithdrawal: number;
  tax: number;
  fees: number;
  netSpendingCash: number;
  spendingShortfall: number;
  accessibleCapital: number;
  restrictedCapital: number;
  totalNetWorth: number;
  restrictions: RetirementCapitalRestriction[];
  housingReleases: AppliedHousingRelease[];
};

export type RetirementWithdrawalOrderItem = {
  accountId: string;
  accountName: string;
  taxWrapper: TaxWrapper;
};

export type RetirementCapitalForecast = {
  scenarioId: string;
  label: string;
  openingNetWorth: number;
  openingAccessibleCapital: number;
  openingRestrictedCapital: number;
  withdrawalOrder: RetirementWithdrawalOrderItem[];
  points: RetirementCapitalForecastPoint[];
  accessibleCapitalExhaustionDate: string | null;
  endingNetWorth: number;
};

type AccountState = RetirementCapitalAccount & { balance: number };

type ResolvedAccess = {
  accessible: boolean;
  restriction: RetirementCapitalRestriction | null;
  taxRate: number;
  feeRate: number;
};

type ResolvedAccountAccessPolicy = AccountAccessPolicy & {
  taxTreatment: WithdrawalTaxTreatment;
  canFundOrdinarySpending: boolean;
};

const roundMoney = (amount: number): number =>
  Math.round((amount + Number.EPSILON) * 100) / 100;

function taxWrapper(account: RetirementCapitalAccount): TaxWrapper {
  return account.taxWrapper ?? "taxable";
}

function defaultAccessPolicy(
  account: RetirementCapitalAccount,
): ResolvedAccountAccessPolicy {
  const wrapper = taxWrapper(account);
  const taxTreatment: WithdrawalTaxTreatment =
    wrapper === "isa"
      ? { kind: "tax-free" }
      : {
          kind: "unsupported",
          reason: `${wrapper} withdrawal tax has not been configured`,
        };
  return {
    accessDelayMonths: 0,
    withdrawalFeeRate: 0,
    taxTreatment,
    canFundOrdinarySpending:
      !isLiability(account.assetType) &&
      account.assetType !== "property" &&
      accountLiquidity(account) !== "illiquid",
  };
}

function accountAccessPolicy(
  account: RetirementCapitalAccount,
): ResolvedAccountAccessPolicy {
  const defaults = defaultAccessPolicy(account);
  return {
    ...defaults,
    ...account.accessPolicy,
    taxTreatment: account.accessPolicy?.taxTreatment ?? defaults.taxTreatment,
    canFundOrdinarySpending:
      account.accessPolicy?.canFundOrdinarySpending ??
      defaults.canFundOrdinarySpending,
  };
}

function restriction(
  account: RetirementCapitalAccount,
  reason: RetirementCapitalRestriction["reason"],
  detail: string,
): RetirementCapitalRestriction {
  return {
    accountId: account.id,
    accountName: account.name,
    reason,
    detail,
  };
}

function resolveAccess(
  account: RetirementCapitalAccount,
  selectedAccountIds: ReadonlySet<string>,
  scenarioStartDate: string,
  date: string,
): ResolvedAccess {
  const policy = accountAccessPolicy(account);
  if (!selectedAccountIds.has(account.id)) {
    return {
      accessible: false,
      restriction: restriction(
        account,
        "not-selected",
        "The selected withdrawal order does not include this account",
      ),
      taxRate: 0,
      feeRate: policy.withdrawalFeeRate,
    };
  }
  if (!policy.canFundOrdinarySpending || isLiability(account.assetType)) {
    return {
      accessible: false,
      restriction: restriction(
        account,
        "ordinary-spending-disabled",
        "This account cannot fund ordinary spending",
      ),
      taxRate: 0,
      feeRate: policy.withdrawalFeeRate,
    };
  }
  if (taxWrapper(account) === "pension" && policy.accessibleFromDate == null) {
    return {
      accessible: false,
      restriction: restriction(
        account,
        "access-date-required",
        "A pension access date is required before the balance can fund spending",
      ),
      taxRate: 0,
      feeRate: policy.withdrawalFeeRate,
    };
  }
  const delayedDate = format(
    addMonths(parseISO(scenarioStartDate), policy.accessDelayMonths),
    "yyyy-MM-dd",
  );
  const accessibleFromDate =
    policy.accessibleFromDate == null
      ? delayedDate
      : format(
          max([parseISO(delayedDate), parseISO(policy.accessibleFromDate)]),
          "yyyy-MM-dd",
        );
  if (date < accessibleFromDate) {
    return {
      accessible: false,
      restriction: restriction(
        account,
        "not-yet-accessible",
        `Available from ${accessibleFromDate}`,
      ),
      taxRate: 0,
      feeRate: policy.withdrawalFeeRate,
    };
  }
  if (policy.taxTreatment.kind === "unsupported") {
    return {
      accessible: false,
      restriction: restriction(
        account,
        "unsupported-tax-treatment",
        policy.taxTreatment.reason,
      ),
      taxRate: 0,
      feeRate: policy.withdrawalFeeRate,
    };
  }
  return {
    accessible: true,
    restriction: null,
    taxRate:
      policy.taxTreatment.kind === "fixed-rate" ? policy.taxTreatment.rate : 0,
    feeRate: policy.withdrawalFeeRate,
  };
}

function validateHousingRelease(
  release: RetirementHousingRelease,
  accountsById: ReadonlyMap<string, RetirementCapitalAccount>,
  scenarioStartDate: string,
  scenarioEndDate: string,
): void {
  const property = accountsById.get(release.sourcePropertyAccountId);
  const destination = accountsById.get(release.destinationAccountId);
  if (property?.assetType !== "property") {
    throw new Error(
      `Housing release "${release.id}" needs a property source account`,
    );
  }
  if (destination == null || isLiability(destination.assetType)) {
    throw new Error(
      `Housing release "${release.id}" needs an asset destination account`,
    );
  }
  const settlementTotal = release.liabilitySettlements.reduce(
    (sum, settlement) => sum + settlement.amount,
    0,
  );
  const hasInvalidSettlement = release.liabilitySettlements.some(
    (settlement) =>
      settlement.amount < 0 ||
      !isLiability(accountsById.get(settlement.accountId)?.assetType ?? "cash"),
  );
  const netReleasedCapital =
    release.grossProceeds -
    release.retainedHousingValue -
    release.tax -
    release.fees -
    settlementTotal;
  const amounts = [
    release.grossProceeds,
    release.retainedHousingValue,
    release.tax,
    release.fees,
    netReleasedCapital,
  ];
  if (
    release.date < scenarioStartDate ||
    releaseForecastDate(release.date, scenarioStartDate, scenarioEndDate) ==
      null ||
    amounts.some((amount) => amount < 0) ||
    hasInvalidSettlement
  ) {
    throw new Error(`Housing release "${release.id}" has invalid amounts`);
  }
}

function releaseForecastDate(
  releaseDate: string,
  scenarioStartDate: string,
  scenarioEndDate: string,
): string | null {
  const start = parseISO(scenarioStartDate);
  let month = Math.max(
    differenceInCalendarMonths(parseISO(releaseDate), start),
    0,
  );
  let forecastDate = format(addMonths(start, month), "yyyy-MM-dd");
  if (forecastDate < releaseDate) {
    month += 1;
    forecastDate = format(addMonths(start, month), "yyyy-MM-dd");
  }
  return forecastDate <= scenarioEndDate ? forecastDate : null;
}

function validateScenario(scenario: RetirementCapitalScenario): void {
  if (scenario.endDate < scenario.startDate) {
    throw new Error(
      "Retirement forecast end date must not precede its start date",
    );
  }
  if (
    !Number.isFinite(scenario.annualSpending) ||
    scenario.annualSpending < 0
  ) {
    throw new Error("Annual retirement spending must be a non-negative number");
  }
  const accountsById = new Map(
    scenario.accounts.map((account) => [account.id, account]),
  );
  if (accountsById.size !== scenario.accounts.length) {
    throw new Error("Retirement forecast account IDs must be unique");
  }
  const selected = new Set(scenario.withdrawalOrder);
  if (selected.size !== scenario.withdrawalOrder.length) {
    throw new Error("Retirement withdrawal order cannot contain duplicates");
  }
  for (const accountId of scenario.withdrawalOrder) {
    if (!accountsById.has(accountId)) {
      throw new Error(`Unknown retirement withdrawal account "${accountId}"`);
    }
  }
  for (const release of scenario.housingReleases ?? []) {
    validateHousingRelease(
      release,
      accountsById,
      scenario.startDate,
      scenario.endDate,
    );
  }
}

function applyMonthlyReturns(
  states: Map<string, AccountState>,
  date: string,
): void {
  for (const state of states.values()) {
    const monthlyReturn =
      (1 + effectiveExpectedReturn(state, date)) ** (1 / 12) - 1;
    state.balance = roundMoney(state.balance * (1 + monthlyReturn));
  }
}

function applyHousingReleases(
  releases: readonly RetirementHousingRelease[],
  states: Map<string, AccountState>,
): AppliedHousingRelease[] {
  return releases.map((release) => {
    const property = states.get(release.sourcePropertyAccountId);
    const destination = states.get(release.destinationAccountId);
    if (property == null || destination == null) {
      throw new Error(
        `Housing release "${release.id}" references a missing account`,
      );
    }
    let settlementTotal = 0;
    const appliedSettlements: RetirementHousingRelease["liabilitySettlements"] =
      [];
    for (const settlement of release.liabilitySettlements) {
      const liability = states.get(settlement.accountId);
      if (liability == null) {
        throw new Error(
          `Housing release "${release.id}" references a missing liability`,
        );
      }
      const appliedAmount = Math.min(
        settlement.amount,
        Math.max(-liability.balance, 0),
      );
      liability.balance = roundMoney(liability.balance + appliedAmount);
      settlementTotal += appliedAmount;
      appliedSettlements.push({
        accountId: settlement.accountId,
        amount: appliedAmount,
      });
    }
    const netReleasedCapital = roundMoney(
      release.grossProceeds -
        release.retainedHousingValue -
        release.tax -
        release.fees -
        settlementTotal,
    );
    property.balance = release.retainedHousingValue;
    destination.balance = roundMoney(destination.balance + netReleasedCapital);
    return {
      ...release,
      liabilitySettlements: appliedSettlements,
      netReleasedCapital,
    };
  });
}

function capitalPosition(
  accounts: readonly RetirementCapitalAccount[],
  states: ReadonlyMap<string, AccountState>,
  selectedAccountIds: ReadonlySet<string>,
  scenarioStartDate: string,
  date: string,
): {
  accessibleCapital: number;
  restrictedCapital: number;
  totalNetWorth: number;
  restrictions: RetirementCapitalRestriction[];
} {
  let accessibleCapital = 0;
  let restrictedCapital = 0;
  let totalNetWorth = 0;
  const restrictions: RetirementCapitalRestriction[] = [];
  for (const account of accounts) {
    const balance = states.get(account.id)?.balance ?? 0;
    totalNetWorth += balance;
    if (balance <= 0) continue;
    const access = resolveAccess(
      account,
      selectedAccountIds,
      scenarioStartDate,
      date,
    );
    if (access.accessible) {
      accessibleCapital += balance * (1 - access.taxRate - access.feeRate);
    } else {
      restrictedCapital += balance;
      if (access.restriction != null) restrictions.push(access.restriction);
    }
  }
  return {
    accessibleCapital: roundMoney(Math.max(accessibleCapital, 0)),
    restrictedCapital: roundMoney(restrictedCapital),
    totalNetWorth: roundMoney(totalNetWorth),
    restrictions,
  };
}

function withdrawSpending(input: {
  accountsById: ReadonlyMap<string, RetirementCapitalAccount>;
  states: Map<string, AccountState>;
  withdrawalOrder: readonly string[];
  selectedAccountIds: ReadonlySet<string>;
  scenarioStartDate: string;
  date: string;
  spendingRequired: number;
}): { withdrawals: RetirementWithdrawal[]; spendingShortfall: number } {
  let remainingSpending = input.spendingRequired;
  const withdrawals: RetirementWithdrawal[] = [];
  for (const accountId of input.withdrawalOrder) {
    if (remainingSpending <= 0) break;
    const account = input.accountsById.get(accountId);
    const state = input.states.get(accountId);
    if (account == null || state == null || state.balance <= 0) continue;
    const access = resolveAccess(
      account,
      input.selectedAccountIds,
      input.scenarioStartDate,
      input.date,
    );
    const netRate = 1 - access.taxRate - access.feeRate;
    if (!access.accessible || netRate <= 0) continue;
    const grossWithdrawal = Math.min(
      state.balance,
      remainingSpending / netRate,
    );
    const tax = grossWithdrawal * access.taxRate;
    const fee = grossWithdrawal * access.feeRate;
    const netSpendingCash = grossWithdrawal - tax - fee;
    state.balance = roundMoney(state.balance - grossWithdrawal);
    remainingSpending = Math.max(remainingSpending - netSpendingCash, 0);
    withdrawals.push({
      accountId,
      accountName: account.name,
      taxWrapper: taxWrapper(account),
      grossWithdrawal: roundMoney(grossWithdrawal),
      tax: roundMoney(tax),
      fee: roundMoney(fee),
      netSpendingCash: roundMoney(netSpendingCash),
    });
  }
  return {
    withdrawals,
    spendingShortfall: roundMoney(remainingSpending),
  };
}

function sumWithdrawals(
  withdrawals: readonly RetirementWithdrawal[],
  field: "grossWithdrawal" | "tax" | "fee" | "netSpendingCash",
): number {
  return roundMoney(
    withdrawals.reduce((sum, withdrawal) => sum + withdrawal[field], 0),
  );
}

function projectRetirementMonth(input: {
  scenario: RetirementCapitalScenario;
  accountsById: ReadonlyMap<string, RetirementCapitalAccount>;
  states: Map<string, AccountState>;
  selectedAccountIds: ReadonlySet<string>;
  releases: readonly RetirementHousingRelease[];
  date: string;
  monthlySpending: number;
  applyReturns: boolean;
}): RetirementCapitalForecastPoint {
  if (input.applyReturns) applyMonthlyReturns(input.states, input.date);
  const housingReleases = applyHousingReleases(input.releases, input.states);
  const { withdrawals, spendingShortfall } = withdrawSpending({
    accountsById: input.accountsById,
    states: input.states,
    withdrawalOrder: input.scenario.withdrawalOrder,
    selectedAccountIds: input.selectedAccountIds,
    scenarioStartDate: input.scenario.startDate,
    date: input.date,
    spendingRequired: input.monthlySpending,
  });
  const position = capitalPosition(
    input.scenario.accounts,
    input.states,
    input.selectedAccountIds,
    input.scenario.startDate,
    input.date,
  );
  return {
    date: input.date,
    spendingRequired: roundMoney(input.monthlySpending),
    withdrawals,
    grossWithdrawal: sumWithdrawals(withdrawals, "grossWithdrawal"),
    tax: sumWithdrawals(withdrawals, "tax"),
    fees: sumWithdrawals(withdrawals, "fee"),
    netSpendingCash: sumWithdrawals(withdrawals, "netSpendingCash"),
    spendingShortfall,
    ...position,
    housingReleases,
  };
}

export function projectRetirementCapital(
  scenario: RetirementCapitalScenario,
): RetirementCapitalForecast {
  validateScenario(scenario);
  const accountsById = new Map(
    scenario.accounts.map((account) => [account.id, account]),
  );
  const states = new Map(
    scenario.accounts.map((account) => [
      account.id,
      { ...account, balance: account.balance },
    ]),
  );
  const selectedAccountIds = new Set(scenario.withdrawalOrder);
  const opening = capitalPosition(
    scenario.accounts,
    states,
    selectedAccountIds,
    scenario.startDate,
    scenario.startDate,
  );
  const releasesByDate = new Map<string, RetirementHousingRelease[]>();
  for (const release of scenario.housingReleases ?? []) {
    const forecastDate = releaseForecastDate(
      release.date,
      scenario.startDate,
      scenario.endDate,
    ) as string;
    const releases = releasesByDate.get(forecastDate) ?? [];
    releases.push(release);
    releasesByDate.set(forecastDate, releases);
  }

  const points: RetirementCapitalForecastPoint[] = [];
  const monthlySpending = scenario.annualSpending / 12;
  let date = scenario.startDate;
  let monthIndex = 0;
  let accessibleCapitalExhaustionDate: string | null = null;
  while (!isAfter(parseISO(date), parseISO(scenario.endDate))) {
    const point = projectRetirementMonth({
      scenario,
      accountsById,
      states,
      selectedAccountIds,
      releases: releasesByDate.get(date) ?? [],
      date,
      monthlySpending,
      applyReturns: monthIndex > 0,
    });
    if (
      point.spendingShortfall > 0 &&
      accessibleCapitalExhaustionDate == null
    ) {
      accessibleCapitalExhaustionDate = date;
    }
    points.push(point);
    monthIndex += 1;
    date = format(
      addMonths(parseISO(scenario.startDate), monthIndex),
      "yyyy-MM-dd",
    );
  }

  return {
    scenarioId: scenario.id,
    label: scenario.label,
    openingNetWorth: opening.totalNetWorth,
    openingAccessibleCapital: opening.accessibleCapital,
    openingRestrictedCapital: opening.restrictedCapital,
    withdrawalOrder: scenario.withdrawalOrder.map((accountId) => {
      const account = accountsById.get(accountId) as RetirementCapitalAccount;
      return {
        accountId,
        accountName: account.name,
        taxWrapper: taxWrapper(account),
      };
    }),
    points,
    accessibleCapitalExhaustionDate,
    endingNetWorth: points.at(-1)?.totalNetWorth ?? opening.totalNetWorth,
  };
}

export function compareRetirementCapitalScenarios(
  scenarios: readonly RetirementCapitalScenario[],
): RetirementCapitalForecast[] {
  return scenarios.map(projectRetirementCapital);
}
