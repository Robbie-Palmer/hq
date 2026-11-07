import { z } from "zod";
import { type Account, isLiability } from "./account";
import {
  accountOwnershipAt,
  type CompanyEquityValuation,
  type EntityObligation,
  effectiveFinancialRecords,
  type FinancialRecordLineage,
  FinancialRecordLineageSchema,
  type HouseholdAccountValue,
  type MonetaryState,
} from "./businessWealth";
import type { Currency } from "./currency";
import {
  convertCurrency,
  type ExchangeRateObservation,
  observationAgeDays,
} from "./valuation";

export const ADJUSTED_NET_ASSETS_CALCULATION_VERSION =
  "adjusted-net-assets-v1" as const;

const RecordIdSchema = z.string().trim().min(1);

const ValuationTreatmentRecordShape = {
  recordId: RecordIdSchema,
  companyEntityId: z.string().trim().min(1),
  effectiveFrom: z.iso.date(),
  effectiveTo: z.iso.date().optional(),
  acceptedAt: z.iso.datetime({ offset: true }),
  lineage: FinancialRecordLineageSchema,
  correctsId: RecordIdSchema.optional(),
};

export const BusinessValuationTreatmentSchema = z.discriminatedUnion("kind", [
  z.object({
    ...ValuationTreatmentRecordShape,
    kind: z.literal("value"),
  }),
  z.object({
    ...ValuationTreatmentRecordShape,
    kind: z.literal("exclude"),
    reason: z.string().trim().min(1),
  }),
]);
export type BusinessValuationTreatment = z.infer<
  typeof BusinessValuationTreatmentSchema
>;

export type AdjustedNetAssetsIssue = {
  kind:
    | "missing_company_account"
    | "account_not_owned_by_company"
    | "missing_account_value"
    | "account_value_not_recorded"
    | "unsupported_account_value"
    | "stale_account_value"
    | "missing_obligation"
    | "obligation_amount_not_recorded"
    | "unsupported_obligation_amount"
    | "missing_exchange_rate"
    | "stale_exchange_rate";
  subjectId: string;
  observedAt?: string;
  reason?: string;
};

export type AdjustedNetAssetsComponent = {
  kind: "asset" | "liability" | "obligation";
  subjectId: string;
  sourceAmount: number;
  sourceCurrency: Currency;
  amount: number;
  currency: Currency;
  inputRecordId: string;
  exchangeRateObservationId?: string;
};

export type AdjustedNetAssetsResult = {
  valuation: CompanyEquityValuation;
  knownSubtotal: number;
  complete: boolean;
  components: AdjustedNetAssetsComponent[];
  issues: AdjustedNetAssetsIssue[];
};

type OperatingReserveInput = {
  amount: MonetaryState;
  assumptionId: string;
};

type AdjustedNetAssetsInput = {
  recordId: string;
  companyEntityId: string;
  validAt: string;
  calculatedAt: string;
  acceptedAt: string;
  currency: Currency;
  lineage: FinancialRecordLineage;
  accountIds: readonly string[];
  obligationIds: readonly string[];
  accounts: readonly Account[];
  accountOwnerships: Parameters<typeof accountOwnershipAt>[0];
  accountValues: readonly HouseholdAccountValue[];
  obligations: readonly EntityObligation[];
  exchangeRateObservations: readonly ExchangeRateObservation[];
  maxInputAgeDays: number;
  maxExchangeRateAgeDays: number;
  operatingReserve?: OperatingReserveInput;
  correctsId?: string;
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

function latestAccountValueAt(
  records: readonly HouseholdAccountValue[],
  accountId: string,
  validAt: string,
  asKnownAt: string,
): HouseholdAccountValue | null {
  return (
    effectiveFinancialRecords(
      records.filter((record) => record.accountId === accountId),
      asKnownAt,
    )
      .filter((record) => record.validAt <= validAt)
      .toSorted(
        (left, right) =>
          right.validAt.localeCompare(left.validAt) ||
          right.acceptedAt.localeCompare(left.acceptedAt) ||
          right.recordId.localeCompare(left.recordId),
      )[0] ?? null
  );
}

function obligationAt(
  records: readonly EntityObligation[],
  obligationId: string,
  companyEntityId: string,
  validAt: string,
  asKnownAt: string,
): EntityObligation | null {
  return (
    effectiveFinancialRecords(
      records.filter(
        (record) =>
          record.obligationId === obligationId &&
          record.entityId === companyEntityId,
      ),
      asKnownAt,
    )
      .filter((record) => containsDate(record, validAt))
      .toSorted(
        (left, right) =>
          right.effectiveFrom.localeCompare(left.effectiveFrom) ||
          right.acceptedAt.localeCompare(left.acceptedAt) ||
          right.recordId.localeCompare(left.recordId),
      )[0] ?? null
  );
}

function convertComponent(input: {
  amount: number;
  currency: Currency;
  subjectId: string;
  validAt: string;
  targetCurrency: Currency;
  exchangeRateObservations: readonly ExchangeRateObservation[];
  maxExchangeRateAgeDays: number;
  asKnownAt: string;
}):
  | { status: "ok"; amount: number; exchangeRateObservationId?: string }
  | { status: "unresolved"; issue: AdjustedNetAssetsIssue } {
  const conversion = convertCurrency({
    amount: input.amount,
    fromCurrency: input.currency,
    toCurrency: input.targetCurrency,
    date: input.validAt,
    observations: input.exchangeRateObservations,
    maxAgeDays: input.maxExchangeRateAgeDays,
    asKnownAt: input.asKnownAt,
  });
  if (conversion.status === "ok") {
    return {
      status: "ok",
      amount: conversion.amount,
      ...(conversion.observationId == null
        ? {}
        : { exchangeRateObservationId: conversion.observationId }),
    };
  }
  return {
    status: "unresolved",
    issue: {
      kind:
        conversion.status === "missing"
          ? "missing_exchange_rate"
          : "stale_exchange_rate",
      subjectId: input.subjectId,
      ...(conversion.issue.observedAt == null
        ? {}
        : { observedAt: conversion.issue.observedAt }),
    },
  };
}

function addAccountComponent(
  input: AdjustedNetAssetsInput,
  accountId: string,
  components: AdjustedNetAssetsComponent[],
  issues: AdjustedNetAssetsIssue[],
): void {
  const account = input.accounts.find(({ id }) => id === accountId);
  if (account == null) {
    issues.push({ kind: "missing_company_account", subjectId: accountId });
    return;
  }
  const ownership = accountOwnershipAt(
    input.accountOwnerships,
    accountId,
    input.validAt,
    input.acceptedAt,
  );
  if (
    ownership?.ownership.state !== "known" ||
    ownership.ownership.allocations.length !== 1 ||
    ownership.ownership.allocations[0]?.entityId !== input.companyEntityId ||
    ownership.ownership.allocations[0]?.fraction !== 1
  ) {
    issues.push({
      kind: "account_not_owned_by_company",
      subjectId: accountId,
    });
    return;
  }
  const value = latestAccountValueAt(
    input.accountValues,
    accountId,
    input.validAt,
    input.acceptedAt,
  );
  if (value == null) {
    issues.push({ kind: "missing_account_value", subjectId: accountId });
    return;
  }
  if (
    observationAgeDays(value.validAt, input.validAt) > input.maxInputAgeDays
  ) {
    issues.push({
      kind: "stale_account_value",
      subjectId: accountId,
      observedAt: value.validAt,
    });
    return;
  }
  if (value.amount.state === "amount-not-recorded") {
    issues.push({
      kind: "account_value_not_recorded",
      subjectId: accountId,
    });
    return;
  }
  if (value.amount.state === "unsupported") {
    issues.push({
      kind: "unsupported_account_value",
      subjectId: accountId,
      reason: value.amount.reason,
    });
    return;
  }
  const conversion = convertComponent({
    amount: Math.abs(value.amount.amount),
    currency: value.amount.currency,
    subjectId: accountId,
    validAt: input.validAt,
    targetCurrency: input.currency,
    exchangeRateObservations: input.exchangeRateObservations,
    maxExchangeRateAgeDays: input.maxExchangeRateAgeDays,
    asKnownAt: input.acceptedAt,
  });
  if (conversion.status === "unresolved") {
    issues.push(conversion.issue);
    return;
  }
  const liability = isLiability(account.assetType);
  components.push({
    kind: liability ? "liability" : "asset",
    subjectId: accountId,
    sourceAmount: value.amount.amount,
    sourceCurrency: value.amount.currency,
    amount: liability ? -conversion.amount : conversion.amount,
    currency: input.currency,
    inputRecordId: value.recordId,
    ...(conversion.exchangeRateObservationId == null
      ? {}
      : {
          exchangeRateObservationId: conversion.exchangeRateObservationId,
        }),
  });
}

function addObligationComponent(
  input: AdjustedNetAssetsInput,
  obligationId: string,
  components: AdjustedNetAssetsComponent[],
  issues: AdjustedNetAssetsIssue[],
): void {
  const obligation = obligationAt(
    input.obligations,
    obligationId,
    input.companyEntityId,
    input.validAt,
    input.acceptedAt,
  );
  if (obligation == null) {
    issues.push({ kind: "missing_obligation", subjectId: obligationId });
    return;
  }
  if (obligation.status === "paid") return;
  if (obligation.amount.state === "amount-not-recorded") {
    issues.push({
      kind: "obligation_amount_not_recorded",
      subjectId: obligationId,
    });
    return;
  }
  if (obligation.amount.state === "unsupported") {
    issues.push({
      kind: "unsupported_obligation_amount",
      subjectId: obligationId,
      reason: obligation.amount.reason,
    });
    return;
  }
  const conversion = convertComponent({
    amount: obligation.amount.amount,
    currency: obligation.amount.currency,
    subjectId: obligationId,
    validAt: input.validAt,
    targetCurrency: input.currency,
    exchangeRateObservations: input.exchangeRateObservations,
    maxExchangeRateAgeDays: input.maxExchangeRateAgeDays,
    asKnownAt: input.acceptedAt,
  });
  if (conversion.status === "unresolved") {
    issues.push(conversion.issue);
    return;
  }
  components.push({
    kind: "obligation",
    subjectId: obligationId,
    sourceAmount: obligation.amount.amount,
    sourceCurrency: obligation.amount.currency,
    amount: -conversion.amount,
    currency: input.currency,
    inputRecordId: obligation.recordId,
    ...(conversion.exchangeRateObservationId == null
      ? {}
      : {
          exchangeRateObservationId: conversion.exchangeRateObservationId,
        }),
  });
}

function unresolvedAdjustedNetAssetsAmount(
  currency: Currency,
  issues: readonly AdjustedNetAssetsIssue[],
): CompanyEquityValuation["amount"] {
  const unsupported = issues.find(({ kind }) => kind.startsWith("unsupported"));
  if (unsupported != null) {
    return {
      state: "unsupported",
      currency,
      reason:
        unsupported.reason ?? "Adjusted net assets has unsupported inputs",
    };
  }
  return { state: "amount-not-recorded", currency };
}

export function calculateAdjustedNetAssets(
  input: AdjustedNetAssetsInput,
): AdjustedNetAssetsResult {
  const components: AdjustedNetAssetsComponent[] = [];
  const issues: AdjustedNetAssetsIssue[] = [];
  for (const accountId of new Set(input.accountIds)) {
    addAccountComponent(input, accountId, components, issues);
  }
  for (const obligationId of new Set(input.obligationIds)) {
    addObligationComponent(input, obligationId, components, issues);
  }

  const knownSubtotal = components.reduce(
    (total, component) => total + component.amount,
    0,
  );
  const accountObservationIds = components
    .filter(({ kind }) => kind === "asset")
    .map(({ inputRecordId }) => inputRecordId);
  const liabilityAccountObservationIds = components
    .filter(({ kind }) => kind === "liability")
    .map(({ inputRecordId }) => inputRecordId);
  const obligationInputIds = components
    .filter(({ kind }) => kind === "obligation")
    .map(({ inputRecordId }) => inputRecordId);
  const exchangeRateObservationIds = [
    ...new Set(
      components.flatMap(({ exchangeRateObservationId }) =>
        exchangeRateObservationId == null ? [] : [exchangeRateObservationId],
      ),
    ),
  ];
  const assumptionIds =
    input.operatingReserve == null ? [] : [input.operatingReserve.assumptionId];
  const parentRecordIds = [
    ...new Set([
      ...input.lineage.parentRecordIds,
      ...accountObservationIds,
      ...liabilityAccountObservationIds,
      ...obligationInputIds,
      ...exchangeRateObservationIds,
      ...assumptionIds,
    ]),
  ];
  const amount =
    issues.length === 0
      ? ({
          state: "known",
          currency: input.currency,
          amount: knownSubtotal,
        } as const)
      : unresolvedAdjustedNetAssetsAmount(input.currency, issues);

  return {
    valuation: {
      recordId: input.recordId,
      companyEntityId: input.companyEntityId,
      validAt: input.validAt,
      acceptedAt: input.acceptedAt,
      method: "adjusted-net-assets",
      evidenceKind: "calculation",
      evidenceAt: input.calculatedAt,
      amount,
      ...(input.operatingReserve == null
        ? {}
        : {
            operatingReserve: {
              amount: input.operatingReserve.amount,
              unavailableForExtraction: true as const,
              assumptionId: input.operatingReserve.assumptionId,
            },
          }),
      lineage: { ...input.lineage, parentRecordIds },
      ...(input.correctsId == null ? {} : { correctsId: input.correctsId }),
      inputs: {
        accountIds: [...new Set(input.accountIds)],
        accountObservationIds,
        liabilityAccountObservationIds,
        obligationIds: obligationInputIds,
        exchangeRateObservationIds,
        assumptionIds,
        calculationVersion: ADJUSTED_NET_ASSETS_CALCULATION_VERSION,
      },
    },
    knownSubtotal,
    complete: issues.length === 0,
    components,
    issues,
  };
}

function activeTreatmentAt(
  treatments: readonly BusinessValuationTreatment[],
  companyEntityId: string,
  validAt: string,
  asKnownAt: string,
): BusinessValuationTreatment | null {
  return (
    effectiveFinancialRecords(
      treatments.filter(
        (treatment) => treatment.companyEntityId === companyEntityId,
      ),
      asKnownAt,
    )
      .filter((treatment) => containsDate(treatment, validAt))
      .toSorted(
        (left, right) =>
          right.effectiveFrom.localeCompare(left.effectiveFrom) ||
          right.acceptedAt.localeCompare(left.acceptedAt) ||
          right.recordId.localeCompare(left.recordId),
      )[0] ?? null
  );
}

export function companyValuationAt(input: {
  valuations: readonly CompanyEquityValuation[];
  treatments?: readonly BusinessValuationTreatment[];
  companyEntityId: string;
  validAt: string;
  asKnownAt: string;
  maxAgeDays: number;
}):
  | {
      status: "available";
      valuation: CompanyEquityValuation;
      treatmentRecordId?: string;
    }
  | {
      status: "excluded";
      treatment: Extract<BusinessValuationTreatment, { kind: "exclude" }>;
    }
  | { status: "missing"; treatmentRecordId?: string }
  | {
      status: "stale";
      valuation: CompanyEquityValuation;
      ageDays: number;
      treatmentRecordId?: string;
    } {
  const treatment = activeTreatmentAt(
    input.treatments ?? [],
    input.companyEntityId,
    input.validAt,
    input.asKnownAt,
  );
  if (treatment?.kind === "exclude") {
    return { status: "excluded", treatment };
  }
  const valuation =
    effectiveFinancialRecords(
      input.valuations.filter(
        (record) => record.companyEntityId === input.companyEntityId,
      ),
      input.asKnownAt,
    )
      .filter((record) => record.validAt <= input.validAt)
      .toSorted(
        (left, right) =>
          right.validAt.localeCompare(left.validAt) ||
          right.acceptedAt.localeCompare(left.acceptedAt) ||
          right.recordId.localeCompare(left.recordId),
      )[0] ?? null;
  if (valuation == null) {
    return {
      status: "missing",
      ...(treatment == null ? {} : { treatmentRecordId: treatment.recordId }),
    };
  }
  const ageDays = observationAgeDays(valuation.validAt, input.validAt);
  if (ageDays > input.maxAgeDays) {
    return {
      status: "stale",
      valuation,
      ageDays,
      ...(treatment == null ? {} : { treatmentRecordId: treatment.recordId }),
    };
  }
  return {
    status: "available",
    valuation,
    ...(treatment == null ? {} : { treatmentRecordId: treatment.recordId }),
  };
}
