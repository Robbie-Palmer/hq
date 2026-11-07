import type {
  ExchangeRateObservation,
  FinancialRecordLineage,
  HouseholdAccountValue,
} from "@/app/_projects/personal-finance-app/domain";
import { businessWealthFixture } from "./businessWealth";

const lineage = (
  sourceId: string,
  parentRecordIds: string[] = [],
): FinancialRecordLineage => ({
  kind: "derived",
  sourceId,
  sourceRevision: "synthetic-valuation-v1",
  parentRecordIds,
});

export function businessValuationFixture() {
  const data = businessWealthFixture();
  const companyCash = data.accounts.find(({ id }) => id === "company-cash");
  if (companyCash == null)
    throw new Error("fixture has no company cash account");
  companyCash.currency = "USD";
  data.entityObligations.push({
    recordId: "northstar-vat-2026",
    obligationId: "northstar-vat-2026",
    entityId: "company:northstar",
    kind: "vat",
    jurisdiction: "GB",
    periodStart: "2026-07-01",
    periodEnd: "2026-09-30",
    dueDate: "2026-11-07",
    status: "due",
    amount: { state: "known", currency: "GBP", amount: 10_000 },
    effectiveFrom: "2026-09-30",
    acceptedAt: "2026-10-01T08:00:00.000Z",
    lineage: lineage("vat-return-2026"),
  });

  const accountValues: HouseholdAccountValue[] = [
    {
      recordId: "company-cash-value-2026-09-30",
      accountId: "company-cash",
      validAt: "2026-09-30",
      acceptedAt: "2026-10-01T08:00:00.000Z",
      amount: { state: "known", currency: "USD", amount: 250_000 },
    },
    {
      recordId: "company-loan-value-2026-09-30",
      accountId: "company-loan",
      validAt: "2026-09-30",
      acceptedAt: "2026-10-01T08:00:00.000Z",
      amount: { state: "known", currency: "GBP", amount: 50_000 },
    },
    {
      recordId: "alex-cash-value-2026-09-30",
      accountId: "alex-cash",
      validAt: "2026-09-30",
      acceptedAt: "2026-10-01T08:00:00.000Z",
      amount: { state: "known", currency: "GBP", amount: 20_000 },
    },
    {
      recordId: "shared-cash-value-2026-09-30",
      accountId: "shared-cash",
      validAt: "2026-09-30",
      acceptedAt: "2026-10-01T08:00:00.000Z",
      amount: { state: "known", currency: "GBP", amount: 10_000 },
    },
  ];
  const exchangeRateObservations: ExchangeRateObservation[] = [
    {
      id: "usd-gbp-2026-09-30",
      fromCurrency: "USD",
      toCurrency: "GBP",
      rate: 0.8,
      validAt: "2026-09-30",
      acceptedAt: "2026-10-01T07:00:00.000Z",
      source: {
        kind: "provider",
        id: "synthetic-fx-provider",
        label: "Synthetic closing rate",
      },
    },
  ];

  return {
    data,
    accountValues,
    exchangeRateObservations,
    calculationInput: {
      recordId: "northstar-ana-2026-09-30",
      companyEntityId: "company:northstar",
      validAt: "2026-09-30",
      calculatedAt: "2026-10-01T09:00:00.000Z",
      acceptedAt: "2026-10-01T09:00:00.000Z",
      currency: "GBP" as const,
      lineage: lineage("northstar-adjusted-net-assets"),
      accountIds: ["company-cash", "company-loan"],
      obligationIds: ["northstar-corporation-tax-2026", "northstar-vat-2026"],
      accounts: data.accounts,
      accountOwnerships: data.accountOwnerships,
      accountValues,
      obligations: data.entityObligations,
      exchangeRateObservations,
      maxInputAgeDays: 31,
      maxExchangeRateAgeDays: 7,
      operatingReserve: {
        amount: {
          state: "known" as const,
          currency: "GBP" as const,
          amount: 30_000,
        },
        assumptionId: "northstar-operating-reserve-2026",
      },
    },
  };
}
