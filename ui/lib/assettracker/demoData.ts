import { accounts } from "@/content/assettracker/accounts";
import { incomeHistory } from "@/content/assettracker/incomeHistory";
import { recurringFlows } from "@/content/assettracker/recurringFlows";
import { snapshots } from "@/content/assettracker/snapshots";
import { transfers } from "@/content/assettracker/transfers";
import {
  exchangeRateObservations,
  holdingObservations,
  instruments,
  priceObservations,
} from "@/content/assettracker/valuations";
import {
  type AssetTrackerData,
  AssetTrackerDataSchema,
} from "@/lib/domain/assettracker/assetTrackerData";
import {
  type Ownership,
  personalOwnership,
} from "@/lib/domain/assettracker/household";

const alexOwnership = personalOwnership("alex");
const samOwnership = personalOwnership("sam");
const equalHouseholdOwnership: Ownership = {
  kind: "shared",
  shares: [
    { memberId: "alex", share: 0.5 },
    { memberId: "sam", share: 0.5 },
  ],
};
const homeOwnership: Ownership = {
  kind: "shared",
  shares: [
    { memberId: "alex", share: 0.6 },
    { memberId: "sam", share: 0.4 },
  ],
};

/** Builds the bundled demo dataset used by the static UI and local adapter. */
export function getDemoAssetTrackerData(): AssetTrackerData {
  return AssetTrackerDataSchema.parse({
    accounts,
    snapshots,
    incomeHistory,
    transfers,
    recurringFlows,
    instruments,
    holdingObservations,
    priceObservations,
    exchangeRateObservations,
    mortgageScenarios: [
      {
        id: "five-year-fix",
        name: "Five-year fix",
        createdAt: "2024-12-01",
        assumptions: {
          purchasePrice: 298_000,
          availableFunds: 85_200,
          depositAmount: 85_200,
          initialAnnualRate: 0.0425,
          termMonths: 274,
          repaymentType: "repayment",
          accrualStartDate: "2024-12-01",
          firstPaymentDate: "2025-01-01",
          fixedPeriodEnd: "2030-01-01",
          followOnAnnualRate: 0.0525,
          refinanceFee: 999,
          purchaseFees: 0,
          taxes: 0,
          transactionCosts: 0,
          monthlyOverpayment: 0,
          overpaymentAllowance: 10_000,
          overpaymentChargeRate: 0.05,
        },
        source: {
          mortgageAccountId: "home-mortgage",
          propertyAccountId: "home",
          snapshotDate: "2024-12-01",
        },
        decisionRecordId: "five-year-fix-decision",
      },
    ],
    decisionRecords: [
      {
        id: "five-year-fix-decision",
        kind: "mortgage",
        title: "Five-year fix",
        scenarioId: "five-year-fix",
        recordedAt: "2024-12-01",
        status: "recorded",
      },
    ],
    household: {
      members: [
        { id: "alex", displayName: "Alex" },
        { id: "sam", displayName: "Sam" },
      ],
      activeScope: { kind: "household" },
    },
    ownership: {
      accounts: {
        "marcus-savings": samOwnership,
        "vanguard-global-all-cap": alexOwnership,
        "trading-212-isa": samOwnership,
        "us-brokerage": alexOwnership,
        "coinbase-btc": alexOwnership,
        "nationwide-current": equalHouseholdOwnership,
        home: homeOwnership,
        "home-mortgage": homeOwnership,
        "amex-credit-card": samOwnership,
        "old-mutual-pension": alexOwnership,
      },
      incomeHistory: Object.fromEntries(
        incomeHistory.map(({ date }) => [date, equalHouseholdOwnership]),
      ),
    },
    settings: {
      expectedAnnualInflation: 0.025,
      targetNetWorth: { amount: 500_000, currency: "GBP" },
      targetNetWorthIsReal: true,
      withdrawalRate: 0.04,
      baseCurrency: "GBP",
      valuationMaxAgeDays: 7,
    },
  });
}
