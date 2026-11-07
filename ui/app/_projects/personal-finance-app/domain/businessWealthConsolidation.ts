import type { Account } from "./account";
import {
  type BusinessValuationTreatment,
  companyValuationAt,
} from "./businessValuation";
import {
  type AccountOwnershipRecord,
  type AccountOwnershipState,
  accountOwnershipAt,
  BUSINESS_WEALTH_CALCULATION_VERSION,
  type CompanyEquityValuation,
  type EntityTransfer,
  effectiveFinancialRecords,
  type FinancialEntityRecord,
  type FinancialRecordLineage,
  type FractionState,
  type HouseholdAccountValue,
  type ShareOwnershipInterest,
  type SignedMonetaryRange,
  type SignedMonetaryState,
  shareOwnershipAt,
} from "./businessWealth";
import type { Currency } from "./currency";
import {
  convertCurrency,
  type ExchangeRateObservation,
  observationAgeDays,
} from "./valuation";

export type HouseholdConsolidationIssue = {
  kind:
    | "missing_account_ownership"
    | "candidate_account_owners"
    | "unsupported_account_ownership"
    | "missing_account_value"
    | "account_value_not_recorded"
    | "unsupported_account_value"
    | "stale_account_value"
    | "missing_share_ownership"
    | "missing_company_valuation"
    | "stale_company_valuation"
    | "company_valuation_not_recorded"
    | "unsupported_company_valuation"
    | "share_fraction_not_recorded"
    | "unsupported_share_ownership"
    | "missing_exchange_rate"
    | "stale_exchange_rate";
  subjectId: string;
  observedAt?: string;
  reason?: string;
};

export type HouseholdWealthContribution = {
  id: string;
  kind: "account" | "business-interest";
  subjectId: string;
  amount: number;
  currency: string;
  range?: SignedMonetaryRange;
  attribution: Array<{
    personEntityId: string;
    fraction: number;
    amount: number;
  }>;
  inputRecordIds: string[];
};

export type HouseholdBusinessReconciliation = {
  companyEntityId: string;
  contributionId: string;
  basis: "direct-valuation" | "underlying-company-position";
  method: CompanyEquityValuation["method"];
  valuationRecordId: string;
  valuationValidAt: string;
  valuationEvidenceAt: string;
  valuationLineage: FinancialRecordLineage;
  wholeCompanyAmount: number;
  selectedOwnershipFraction: number;
  selectedInterestAmount: number;
  outsideOwnershipFraction: number;
  excludedUnderlyingIds: string[];
  operatingReserve: CompanyEquityValuation["operatingReserve"];
};

export type HouseholdWealthConsolidation = {
  calculationVersion: typeof BUSINESS_WEALTH_CALCULATION_VERSION;
  validAt: string;
  asKnownAt: string;
  baseCurrency: string;
  knownSubtotal: number;
  complete: boolean;
  contributions: HouseholdWealthContribution[];
  businessReconciliations: HouseholdBusinessReconciliation[];
  includedContributionIds: string[];
  excludedUnderlyingIds: string[];
  excludedBusinessIds: string[];
  eliminatedTransferIds: string[];
  valuationRecordIds: string[];
  valuationTreatmentRecordIds: string[];
  ownershipRecordIds: string[];
  exchangeRateObservationIds: string[];
  issues: HouseholdConsolidationIssue[];
};

export type HouseholdConsolidationInput = {
  selectedPersonEntityIds: readonly string[];
  validAt: string;
  asKnownAt: string;
  baseCurrency: Currency;
  accounts: readonly Account[];
  accountValues: readonly HouseholdAccountValue[];
  financialEntities: readonly FinancialEntityRecord[];
  accountOwnerships: readonly AccountOwnershipRecord[];
  shareOwnershipInterests: readonly ShareOwnershipInterest[];
  companyEquityValuations: readonly CompanyEquityValuation[];
  companyValuationTreatments?: readonly BusinessValuationTreatment[];
  entityTransfers?: readonly EntityTransfer[];
  exchangeRateObservations?: readonly ExchangeRateObservation[];
  maxValuationAgeDays?: number;
  maxAccountValueAgeDays?: number;
  maxExchangeRateAgeDays?: number;
};

type ConsolidationAccumulator = {
  selectedPeople: ReadonlySet<string>;
  contributions: HouseholdWealthContribution[];
  businessReconciliations: HouseholdBusinessReconciliation[];
  issues: HouseholdConsolidationIssue[];
  excludedUnderlyingIds: Set<string>;
  excludedBusinessIds: Set<string>;
  valuationRecordIds: Set<string>;
  valuationTreatmentRecordIds: Set<string>;
  ownershipRecordIds: Set<string>;
  exchangeRateObservationIds: Set<string>;
};

function containsDate(
  record: { effectiveFrom: string; effectiveTo?: string },
  date: string,
): boolean {
  return (
    record.effectiveFrom <= date &&
    (record.effectiveTo == null || date < record.effectiveTo)
  );
}

function accountValueRecencyKey(value: HouseholdAccountValue): string {
  return `${value.validAt}\u0000${value.acceptedAt}\u0000${value.recordId}`;
}

function latestAccountValueAt(
  records: readonly HouseholdAccountValue[],
  accountId: string,
  validAt: string,
  asKnownAt: string,
): HouseholdAccountValue | null {
  return (
    effectiveFinancialRecords(records, asKnownAt)
      .filter(
        (record) => record.accountId === accountId && record.validAt <= validAt,
      )
      .toSorted((left, right) =>
        accountValueRecencyKey(right).localeCompare(
          accountValueRecencyKey(left),
        ),
      )[0] ?? null
  );
}

function selectedPersonIds(
  input: HouseholdConsolidationInput,
): ReadonlySet<string> {
  const peopleAtDate = new Set(
    effectiveFinancialRecords(input.financialEntities, input.asKnownAt)
      .filter(
        (entity) =>
          entity.kind === "person" && containsDate(entity, input.validAt),
      )
      .map(({ entityId }) => entityId),
  );
  return new Set(
    input.selectedPersonEntityIds.filter((entityId) =>
      peopleAtDate.has(entityId),
    ),
  );
}

function convertContributionAmount(input: {
  amount: number;
  fromCurrency: Currency;
  subjectId: string;
  consolidation: HouseholdConsolidationInput;
  result: ConsolidationAccumulator;
}): { amount: number; rate: number; observationId?: string } | null {
  const conversion = convertCurrency({
    amount: input.amount,
    fromCurrency: input.fromCurrency,
    toCurrency: input.consolidation.baseCurrency,
    date: input.consolidation.validAt,
    observations: input.consolidation.exchangeRateObservations ?? [],
    maxAgeDays:
      input.consolidation.maxExchangeRateAgeDays ?? Number.MAX_SAFE_INTEGER,
    asKnownAt: input.consolidation.asKnownAt,
  });
  if (conversion.status === "ok") {
    if (conversion.observationId != null) {
      input.result.exchangeRateObservationIds.add(conversion.observationId);
    }
    return conversion;
  }
  input.result.issues.push({
    kind:
      conversion.status === "missing"
        ? "missing_exchange_rate"
        : "stale_exchange_rate",
    subjectId: input.subjectId,
    ...(conversion.issue.observedAt == null
      ? {}
      : { observedAt: conversion.issue.observedAt }),
  });
  return null;
}

function unresolvedMonetaryIssue(
  amount: Exclude<SignedMonetaryState, { state: "known" }>,
  subjectId: string,
  notRecordedKind:
    | "account_value_not_recorded"
    | "company_valuation_not_recorded",
  unsupportedKind:
    | "unsupported_account_value"
    | "unsupported_company_valuation",
): HouseholdConsolidationIssue {
  return {
    kind:
      amount.state === "amount-not-recorded"
        ? notRecordedKind
        : unsupportedKind,
    subjectId,
    ...(amount.state === "unsupported" ? { reason: amount.reason } : {}),
  };
}

function accountValueForContribution(
  input: HouseholdConsolidationInput,
  account: Account,
  result: ConsolidationAccumulator,
): {
  value: HouseholdAccountValue;
  amount: number;
  observationId?: string;
} | null {
  const value = latestAccountValueAt(
    input.accountValues,
    account.id,
    input.validAt,
    input.asKnownAt,
  );
  if (value == null) {
    result.issues.push({
      kind: "missing_account_value",
      subjectId: account.id,
    });
    return null;
  }
  if (
    observationAgeDays(value.validAt, input.validAt) >
    (input.maxAccountValueAgeDays ?? Number.MAX_SAFE_INTEGER)
  ) {
    result.issues.push({
      kind: "stale_account_value",
      subjectId: account.id,
      observedAt: value.validAt,
    });
    return null;
  }
  if (value.amount.state !== "known") {
    result.issues.push(
      unresolvedMonetaryIssue(
        value.amount,
        account.id,
        "account_value_not_recorded",
        "unsupported_account_value",
      ),
    );
    return null;
  }
  const converted = convertContributionAmount({
    amount: value.amount.amount,
    fromCurrency: value.amount.currency,
    subjectId: account.id,
    consolidation: input,
    result,
  });
  if (converted == null) return null;
  return {
    value,
    amount: converted.amount,
    ...(converted.observationId == null
      ? {}
      : { observationId: converted.observationId }),
  };
}

function addUnresolvedAccountContribution(
  input: HouseholdConsolidationInput,
  account: Account,
  ownershipRecord: AccountOwnershipRecord,
  ownership: Exclude<AccountOwnershipState, { state: "known" }>,
  result: ConsolidationAccumulator,
): void {
  const candidates = ownership.candidateEntityIds;
  const allCandidatesSelected =
    candidates.length > 0 &&
    candidates.every((entityId) => result.selectedPeople.has(entityId));
  if (allCandidatesSelected) {
    const converted = accountValueForContribution(input, account, result);
    if (converted != null) {
      result.contributions.push({
        id: `account:${account.id}`,
        kind: "account",
        subjectId: account.id,
        amount: converted.amount,
        currency: input.baseCurrency,
        attribution: [],
        inputRecordIds: [
          ownershipRecord.recordId,
          converted.value.recordId,
          ...(converted.observationId == null ? [] : [converted.observationId]),
        ],
      });
    }
  }
  result.issues.push({
    kind:
      ownership.state === "candidate-owners"
        ? "candidate_account_owners"
        : "unsupported_account_ownership",
    subjectId: account.id,
    ...(ownership.state === "unsupported" ? { reason: ownership.reason } : {}),
  });
}

function addKnownAccountContribution(
  input: HouseholdConsolidationInput,
  account: Account,
  ownershipRecord: AccountOwnershipRecord,
  ownership: Extract<AccountOwnershipState, { state: "known" }>,
  result: ConsolidationAccumulator,
): void {
  const allocations = ownership.allocations.filter(({ entityId }) =>
    result.selectedPeople.has(entityId),
  );
  if (allocations.length === 0) return;
  const converted = accountValueForContribution(input, account, result);
  if (converted == null) return;
  const selectedFraction = allocations.reduce(
    (sum, allocation) => sum + allocation.fraction,
    0,
  );
  result.contributions.push({
    id: `account:${account.id}`,
    kind: "account",
    subjectId: account.id,
    amount: converted.amount * selectedFraction,
    currency: input.baseCurrency,
    attribution: allocations.map((allocation) => ({
      personEntityId: allocation.entityId,
      fraction: allocation.fraction,
      amount: converted.amount * allocation.fraction,
    })),
    inputRecordIds: [
      ownershipRecord.recordId,
      converted.value.recordId,
      ...(converted.observationId == null ? [] : [converted.observationId]),
    ],
  });
}

function addAccountContribution(
  input: HouseholdConsolidationInput,
  account: Account,
  result: ConsolidationAccumulator,
): void {
  const ownershipRecord = accountOwnershipAt(
    input.accountOwnerships,
    account.id,
    input.validAt,
    input.asKnownAt,
  );
  if (ownershipRecord == null) {
    result.issues.push({
      kind: "missing_account_ownership",
      subjectId: account.id,
    });
    return;
  }
  result.ownershipRecordIds.add(ownershipRecord.recordId);
  const ownership = ownershipRecord.ownership;
  if (ownership.state !== "known") {
    addUnresolvedAccountContribution(
      input,
      account,
      ownershipRecord,
      ownership,
      result,
    );
    return;
  }
  addKnownAccountContribution(
    input,
    account,
    ownershipRecord,
    ownership,
    result,
  );
}

function selectedCompanyIds(
  input: HouseholdConsolidationInput,
  selectedPeople: ReadonlySet<string>,
): Set<string> {
  const ids = new Set(
    effectiveFinancialRecords(input.shareOwnershipInterests, input.asKnownAt)
      .filter(
        (interest) =>
          selectedPeople.has(interest.ownerEntityId) &&
          containsDate(interest, input.validAt),
      )
      .map(({ companyEntityId }) => companyEntityId),
  );
  for (const treatment of effectiveFinancialRecords(
    input.companyValuationTreatments ?? [],
    input.asKnownAt,
  )) {
    if (containsDate(treatment, input.validAt)) {
      ids.add(treatment.companyEntityId);
    }
  }
  return ids;
}

function addUnresolvedInterestIssue(
  interest: ShareOwnershipInterest & {
    fraction: Exclude<FractionState, { state: "known" }>;
  },
  result: ConsolidationAccumulator,
): void {
  result.issues.push({
    kind:
      interest.fraction.state === "fraction-not-recorded"
        ? "share_fraction_not_recorded"
        : "unsupported_share_ownership",
    subjectId: interest.companyEntityId,
    ...(interest.fraction.state === "unsupported"
      ? { reason: interest.fraction.reason }
      : {}),
  });
}

function companyUnderlyingIds(
  input: HouseholdConsolidationInput,
  companyEntityId: string,
  valuation?: CompanyEquityValuation,
): string[] {
  const accountIds = input.accounts.flatMap((account) => {
    const ownership = accountOwnershipAt(
      input.accountOwnerships,
      account.id,
      input.validAt,
      input.asKnownAt,
    );
    return ownership?.ownership.state === "known" &&
      ownership.ownership.allocations.length === 1 &&
      ownership.ownership.allocations[0]?.entityId === companyEntityId &&
      ownership.ownership.allocations[0]?.fraction === 1
      ? [account.id]
      : [];
  });
  return [
    ...new Set([
      ...accountIds,
      ...(valuation?.inputs?.accountIds ?? []),
      ...(valuation?.inputs?.obligationIds ?? []),
    ]),
  ].sort((left, right) => left.localeCompare(right));
}

function convertValuationRange(
  range: SignedMonetaryRange | undefined,
  rate: number,
  selectedFraction: number,
  baseCurrency: Currency,
): SignedMonetaryRange | undefined {
  if (range == null) return undefined;
  return {
    currency: baseCurrency,
    lowerBound: range.lowerBound * rate * selectedFraction,
    upperBound: range.upperBound * rate * selectedFraction,
  };
}

type KnownShareOwnershipInterest = ShareOwnershipInterest & {
  fraction: Extract<FractionState, { state: "known" }>;
};

function householdInterests(
  input: HouseholdConsolidationInput,
  companyEntityId: string,
  result: ConsolidationAccumulator,
): KnownShareOwnershipInterest[] | null {
  const interests = shareOwnershipAt(
    input.shareOwnershipInterests,
    companyEntityId,
    input.validAt,
    input.asKnownAt,
  ).filter(({ ownerEntityId }) => result.selectedPeople.has(ownerEntityId));
  if (interests.length === 0) {
    result.issues.push({
      kind: "missing_share_ownership",
      subjectId: companyEntityId,
    });
    return null;
  }
  for (const interest of interests) {
    result.ownershipRecordIds.add(interest.recordId);
  }
  const unresolved = interests.find(
    (
      interest,
    ): interest is ShareOwnershipInterest & {
      fraction: Exclude<FractionState, { state: "known" }>;
    } => interest.fraction.state !== "known",
  );
  if (unresolved != null) {
    addUnresolvedInterestIssue(unresolved, result);
    return null;
  }
  return interests.filter(
    (interest): interest is KnownShareOwnershipInterest =>
      interest.fraction.state === "known",
  );
}

function addBusinessContribution(
  input: HouseholdConsolidationInput,
  companyEntityId: string,
  result: ConsolidationAccumulator,
): void {
  const selection = companyValuationAt({
    valuations: input.companyEquityValuations,
    treatments: input.companyValuationTreatments,
    companyEntityId,
    validAt: input.validAt,
    asKnownAt: input.asKnownAt,
    maxAgeDays: input.maxValuationAgeDays ?? Number.MAX_SAFE_INTEGER,
  });
  if (selection.status === "excluded") {
    result.excludedBusinessIds.add(companyEntityId);
    result.valuationTreatmentRecordIds.add(selection.treatment.recordId);
    for (const id of companyUnderlyingIds(input, companyEntityId)) {
      result.excludedUnderlyingIds.add(id);
    }
    return;
  }
  if (selection.treatmentRecordId != null) {
    result.valuationTreatmentRecordIds.add(selection.treatmentRecordId);
  }

  const knownInterests = householdInterests(input, companyEntityId, result);
  if (knownInterests == null) return;
  if (selection.status === "missing") {
    result.issues.push({
      kind: "missing_company_valuation",
      subjectId: companyEntityId,
    });
    return;
  }
  const valuation = selection.valuation;
  result.valuationRecordIds.add(valuation.recordId);
  const underlyingIds = companyUnderlyingIds(input, companyEntityId, valuation);
  for (const id of underlyingIds) result.excludedUnderlyingIds.add(id);
  if (selection.status === "stale") {
    result.issues.push({
      kind: "stale_company_valuation",
      subjectId: companyEntityId,
      observedAt: valuation.validAt,
    });
    return;
  }
  if (valuation.amount.state !== "known") {
    result.issues.push(
      unresolvedMonetaryIssue(
        valuation.amount,
        companyEntityId,
        "company_valuation_not_recorded",
        "unsupported_company_valuation",
      ),
    );
    return;
  }
  const converted = convertContributionAmount({
    amount: valuation.amount.amount,
    fromCurrency: valuation.amount.currency,
    subjectId: companyEntityId,
    consolidation: input,
    result,
  });
  if (converted == null) return;
  const selectedFraction = knownInterests.reduce(
    (total, interest) => total + interest.fraction.fraction,
    0,
  );
  const attribution = knownInterests.map((interest) => ({
    personEntityId: interest.ownerEntityId,
    fraction: interest.fraction.fraction,
    amount: converted.amount * interest.fraction.fraction,
  }));
  const contributionId = `business-interest:${companyEntityId}`;
  result.contributions.push({
    id: contributionId,
    kind: "business-interest",
    subjectId: companyEntityId,
    amount: converted.amount * selectedFraction,
    currency: input.baseCurrency,
    ...(valuation.range == null
      ? {}
      : {
          range: convertValuationRange(
            valuation.range,
            converted.rate,
            selectedFraction,
            input.baseCurrency,
          ),
        }),
    attribution,
    inputRecordIds: [
      valuation.recordId,
      ...knownInterests.map(({ recordId }) => recordId),
      ...(converted.observationId == null ? [] : [converted.observationId]),
    ],
  });
  result.businessReconciliations.push({
    companyEntityId,
    contributionId,
    basis:
      valuation.method === "adjusted-net-assets"
        ? "underlying-company-position"
        : "direct-valuation",
    method: valuation.method,
    valuationRecordId: valuation.recordId,
    valuationValidAt: valuation.validAt,
    valuationEvidenceAt: valuation.evidenceAt,
    valuationLineage: valuation.lineage,
    wholeCompanyAmount: converted.amount,
    selectedOwnershipFraction: selectedFraction,
    selectedInterestAmount: converted.amount * selectedFraction,
    outsideOwnershipFraction: Math.max(0, 1 - selectedFraction),
    excludedUnderlyingIds: underlyingIds,
    operatingReserve: valuation.operatingReserve,
  });
}

function internalTransferIds(
  input: HouseholdConsolidationInput,
  selectedCompanyEntityIds: ReadonlySet<string>,
  selectedPeople: ReadonlySet<string>,
): string[] {
  const consolidatedEntityIds = new Set([
    ...selectedPeople,
    ...selectedCompanyEntityIds,
  ]);
  return effectiveFinancialRecords(input.entityTransfers ?? [], input.asKnownAt)
    .filter((transfer) => containsDate(transfer, input.validAt))
    .flatMap((transfer) => {
      const source = transfer.legs.find(
        ({ role }) => role === "source",
      )?.endpoint;
      const destination = transfer.legs.find(
        ({ role }) => role === "destination",
      )?.endpoint;
      return source?.kind === "entity" &&
        destination?.kind === "entity" &&
        consolidatedEntityIds.has(source.entityId) &&
        consolidatedEntityIds.has(destination.entityId)
        ? [transfer.recordId]
        : [];
    })
    .sort((left, right) => left.localeCompare(right));
}

export function consolidateHouseholdWealth(
  input: HouseholdConsolidationInput,
): HouseholdWealthConsolidation {
  const selectedPeople = selectedPersonIds(input);
  const selectedCompanies = selectedCompanyIds(input, selectedPeople);
  const result: ConsolidationAccumulator = {
    selectedPeople,
    contributions: [],
    businessReconciliations: [],
    issues: [],
    excludedUnderlyingIds: new Set(),
    excludedBusinessIds: new Set(),
    valuationRecordIds: new Set(),
    valuationTreatmentRecordIds: new Set(),
    ownershipRecordIds: new Set(),
    exchangeRateObservationIds: new Set(),
  };

  for (const account of input.accounts) {
    addAccountContribution(input, account, result);
  }
  for (const companyId of selectedCompanies) {
    addBusinessContribution(input, companyId, result);
  }

  const contributions = result.contributions.filter(
    (contribution) =>
      contribution.kind !== "account" ||
      !result.excludedUnderlyingIds.has(contribution.subjectId),
  );
  return {
    calculationVersion: BUSINESS_WEALTH_CALCULATION_VERSION,
    validAt: input.validAt,
    asKnownAt: input.asKnownAt,
    baseCurrency: input.baseCurrency,
    knownSubtotal: contributions.reduce(
      (sum, contribution) => sum + contribution.amount,
      0,
    ),
    complete: result.issues.length === 0,
    contributions,
    businessReconciliations: result.businessReconciliations,
    includedContributionIds: contributions.map(({ id }) => id),
    excludedUnderlyingIds: [...result.excludedUnderlyingIds].sort(
      (left, right) => left.localeCompare(right),
    ),
    excludedBusinessIds: [...result.excludedBusinessIds].sort((left, right) =>
      left.localeCompare(right),
    ),
    eliminatedTransferIds: internalTransferIds(
      input,
      selectedCompanies,
      selectedPeople,
    ),
    valuationRecordIds: [...result.valuationRecordIds].sort((left, right) =>
      left.localeCompare(right),
    ),
    valuationTreatmentRecordIds: [...result.valuationTreatmentRecordIds].sort(
      (left, right) => left.localeCompare(right),
    ),
    ownershipRecordIds: [...result.ownershipRecordIds].sort((left, right) =>
      left.localeCompare(right),
    ),
    exchangeRateObservationIds: [...result.exchangeRateObservationIds].sort(
      (left, right) => left.localeCompare(right),
    ),
    issues: result.issues,
  };
}
