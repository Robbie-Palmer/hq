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
