import type { Account } from "./account";
import { DEFAULT_VALUATION_MAX_AGE_DAYS } from "./assetTrackerData";
import type { AssetTrackerRepository } from "./assetTrackerRepository";
import type { BalanceSnapshot } from "./balanceSnapshot";
import { type Currency, DEFAULT_BASE_CURRENCY } from "./currency";
import type { Money } from "./money";
import {
  convertCurrency,
  effectiveObservations,
  type HoldingObservation,
  latestObservation,
  observationAgeDays,
  type ValuationIssue,
} from "./valuation";

export type AccountValuation = {
  accountId: string;
  date: string;
  baseCurrency: Currency;
  value: number | null;
  nativeValue: number | null;
  nativeCurrency: Currency | null;
  issues: ValuationIssue[];
  inputObservationIds: string[];
};

function latestSnapshot(
  snapshots: readonly BalanceSnapshot[],
  accountId: string,
  date: string,
): BalanceSnapshot | null {
  return (
    snapshots
      .filter(
        (snapshot) => snapshot.accountId === accountId && snapshot.date <= date,
      )
      .toSorted((a, b) => b.date.localeCompare(a.date))[0] ?? null
  );
}

function valueLegacyBalance(
  repository: AssetTrackerRepository,
  account: Account,
  date: string,
  asKnownAt?: string,
): AccountValuation {
  const baseCurrency =
    repository.settings.baseCurrency ?? DEFAULT_BASE_CURRENCY;
  const snapshot = latestSnapshot(repository.snapshots, account.id, date);
  if (snapshot == null) {
    return {
      accountId: account.id,
      date,
      baseCurrency,
      value: null,
      nativeValue: null,
      nativeCurrency: account.currency,
      issues: [],
      inputObservationIds: [],
    };
  }
  const converted = convertCurrency({
    amount: snapshot.balance,
    fromCurrency: account.currency,
    toCurrency: baseCurrency,
    date,
    observations: repository.exchangeRateObservations,
    maxAgeDays:
      repository.settings.valuationMaxAgeDays ?? DEFAULT_VALUATION_MAX_AGE_DAYS,
    asKnownAt,
  });
  if (converted.status !== "ok") {
    return {
      accountId: account.id,
      date,
      baseCurrency,
      value: null,
      nativeValue: snapshot.balance,
      nativeCurrency: account.currency,
      issues: [{ ...converted.issue, accountId: account.id }],
      inputObservationIds: [],
    };
  }
  return {
    accountId: account.id,
    date,
    baseCurrency,
    value: converted.amount,
    nativeValue: snapshot.balance,
    nativeCurrency: account.currency,
    issues: [],
    inputObservationIds:
      converted.observationId == null ? [] : [converted.observationId],
  };
}

type HoldingValuePart = {
  value: number | null;
  nativeValue: number | null;
  issues: ValuationIssue[];
  inputObservationIds: string[];
};

function valueInstrumentHolding(input: {
  repository: AssetTrackerRepository;
  account: Account;
  holdings: readonly HoldingObservation[];
  instrumentId: string;
  date: string;
  baseCurrency: Currency;
  maxAgeDays: number;
  asKnownAt?: string;
}): HoldingValuePart {
  const holding = latestObservation(
    input.holdings.filter(
      (observation) => observation.instrumentId === input.instrumentId,
    ),
    input.date,
    input.asKnownAt,
  );
  if (holding == null || holding.quantity === 0) {
    return { value: 0, nativeValue: 0, issues: [], inputObservationIds: [] };
  }
  const instrument = input.repository.instruments.get(input.instrumentId);
  if (instrument == null) {
    return {
      value: null,
      nativeValue: null,
      issues: [],
      inputObservationIds: [],
    };
  }
  const price = latestObservation(
    input.repository.priceObservations.filter(
      (observation) => observation.instrumentId === input.instrumentId,
    ),
    input.date,
    input.asKnownAt,
  );
  if (price == null) {
    return {
      value: null,
      nativeValue: null,
      issues: [
        {
          kind: "missing_price",
          date: input.date,
          accountId: input.account.id,
          instrumentId: input.instrumentId,
          currency: instrument.currency,
        },
      ],
      inputObservationIds: [holding.id],
    };
  }
  if (observationAgeDays(price.validAt, input.date) > input.maxAgeDays) {
    return {
      value: null,
      nativeValue: null,
      issues: [
        {
          kind: "stale_price",
          date: input.date,
          accountId: input.account.id,
          instrumentId: input.instrumentId,
          currency: price.currency,
          observedAt: price.validAt,
        },
      ],
      inputObservationIds: [holding.id, price.id],
    };
  }
  const marketValue = holding.quantity * price.price;
  const converted = convertCurrency({
    amount: marketValue,
    fromCurrency: price.currency,
    toCurrency: input.baseCurrency,
    date: input.date,
    observations: input.repository.exchangeRateObservations,
    maxAgeDays: input.maxAgeDays,
    asKnownAt: input.asKnownAt,
  });
  if (converted.status !== "ok") {
    return {
      value: null,
      nativeValue:
        price.currency === input.account.currency ? marketValue : null,
      issues: [
        {
          ...converted.issue,
          accountId: input.account.id,
          instrumentId: input.instrumentId,
        },
      ],
      inputObservationIds: [holding.id, price.id],
    };
  }
  return {
    value: converted.amount,
    nativeValue: price.currency === input.account.currency ? marketValue : null,
    issues: [],
    inputObservationIds: [
      holding.id,
      price.id,
      ...(converted.observationId == null ? [] : [converted.observationId]),
    ],
  };
}

function valueHoldings(
  repository: AssetTrackerRepository,
  account: Account,
  date: string,
  asKnownAt?: string,
): AccountValuation | null {
  const known = effectiveObservations(
    repository.holdingObservations.filter(
      (observation) =>
        observation.accountId === account.id && observation.validAt <= date,
    ),
    asKnownAt,
  );
  if (known.length === 0) return null;

  const baseCurrency =
    repository.settings.baseCurrency ?? DEFAULT_BASE_CURRENCY;
  const maxAgeDays =
    repository.settings.valuationMaxAgeDays ?? DEFAULT_VALUATION_MAX_AGE_DAYS;
  const instrumentIds = new Set(
    known.map((observation) => observation.instrumentId),
  );
  const parts = [...instrumentIds]
    .sort((a, b) => a.localeCompare(b))
    .map((instrumentId) =>
      valueInstrumentHolding({
        repository,
        account,
        holdings: known,
        instrumentId,
        date,
        baseCurrency,
        maxAgeDays,
        asKnownAt,
      }),
    );
  const issues = parts.flatMap((part) => part.issues);
  const inputObservationIds = parts.flatMap((part) => part.inputObservationIds);
  const value = parts.reduce((sum, part) => sum + (part.value ?? 0), 0);
  const nativeValueAvailable = parts.every((part) => part.nativeValue != null);
  const nativeValue = parts.reduce(
    (sum, part) => sum + (part.nativeValue ?? 0),
    0,
  );

  return {
    accountId: account.id,
    date,
    baseCurrency,
    value: issues.length === 0 ? value : null,
    nativeValue: nativeValueAvailable ? nativeValue : null,
    nativeCurrency: nativeValueAvailable ? account.currency : null,
    issues,
    inputObservationIds,
  };
}

/** Values an account in the household base currency on a valid-time date. */
export function valueAccountAtDate(
  repository: AssetTrackerRepository,
  account: Account,
  date: string,
  asKnownAt?: string,
): AccountValuation {
  return (
    valueHoldings(repository, account, date, asKnownAt) ??
    valueLegacyBalance(repository, account, date, asKnownAt)
  );
}

export function convertAccountAmountAtDate(
  repository: AssetTrackerRepository,
  accountId: string,
  amount: number,
  date: string,
  asKnownAt?: string,
): number | null {
  const account = repository.accounts.get(accountId);
  if (account == null) return null;
  const converted = convertCurrency({
    amount,
    fromCurrency: account.currency,
    toCurrency: repository.settings.baseCurrency ?? DEFAULT_BASE_CURRENCY,
    date,
    observations: repository.exchangeRateObservations,
    maxAgeDays:
      repository.settings.valuationMaxAgeDays ?? DEFAULT_VALUATION_MAX_AGE_DAYS,
    asKnownAt,
  });
  return converted.status === "ok" ? converted.amount : null;
}

export function convertMoneyAtDate(
  repository: AssetTrackerRepository,
  value: Money,
  date: string,
  asKnownAt?: string,
): number | null {
  const converted = convertCurrency({
    amount: value.amount,
    fromCurrency: value.currency,
    toCurrency: repository.settings.baseCurrency,
    date,
    observations: repository.exchangeRateObservations,
    maxAgeDays: repository.settings.valuationMaxAgeDays,
    asKnownAt,
  });
  return converted.status === "ok" ? converted.amount : null;
}

export type PortfolioValuation = {
  date: string;
  baseCurrency: Currency;
  total: number | null;
  partialTotal: number;
  byAccount: Map<string, AccountValuation>;
  issues: ValuationIssue[];
};

export function valuePortfolioAtDate(
  repository: AssetTrackerRepository,
  date: string,
  asKnownAt?: string,
): PortfolioValuation {
  const byAccount = new Map<string, AccountValuation>();
  const issues: ValuationIssue[] = [];
  let partialTotal = 0;
  for (const account of repository.accounts.values()) {
    if (account.closedAt != null && account.closedAt <= date) continue;
    const valuation = valueAccountAtDate(repository, account, date, asKnownAt);
    byAccount.set(account.id, valuation);
    issues.push(...valuation.issues);
    partialTotal += valuation.value ?? 0;
  }
  return {
    date,
    baseCurrency: repository.settings.baseCurrency ?? DEFAULT_BASE_CURRENCY,
    total: issues.length === 0 ? partialTotal : null,
    partialTotal,
    byAccount,
    issues,
  };
}

export function valuationDates(repository: AssetTrackerRepository): string[] {
  return [
    ...new Set([
      ...repository.snapshots.map((snapshot) => snapshot.date),
      ...repository.capitalFlows.map((flow) => flow.date),
      ...repository.holdingObservations.map(
        (observation) => observation.validAt,
      ),
      ...repository.priceObservations.map((observation) => observation.validAt),
      ...repository.exchangeRateObservations.map(
        (observation) => observation.validAt,
      ),
    ]),
  ].sort((a, b) => a.localeCompare(b));
}

/** Base-currency balances for the latest fully valued portfolio state. */
export function latestValuedBalances(
  repository: AssetTrackerRepository,
): Map<string, number> | null {
  const date = valuationDates(repository).at(-1);
  if (date == null) return new Map();
  const valuation = valuePortfolioAtDate(repository, date);
  if (valuation.total == null) return null;
  const balances = new Map<string, number>();
  for (const [accountId, accountValuation] of valuation.byAccount) {
    if (accountValuation.value != null) {
      balances.set(accountId, accountValuation.value);
    }
  }
  return balances;
}
