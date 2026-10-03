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
