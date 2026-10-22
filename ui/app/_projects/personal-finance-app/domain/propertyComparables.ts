import {
  ComparableSalesQuerySchema,
  findComparableSales,
  findNorthernIrelandMarketTrend,
  type HousePriceIndexArchive,
  type HousePriceMarketTrend,
  HousePriceMarketTrendQuerySchema,
  type PricePaidArchive,
  selectHousePriceIndexRelease,
  selectPricePaidRelease,
} from "finance-housing-indices/browser";
import { z } from "zod";
import { AccountIdSchema } from "./account";

export const PropertyComparableSearchDefinitionSchema = z.object({
  accountId: AccountIdSchema,
  datasetVersion: z.string().min(1),
  query: ComparableSalesQuerySchema,
  marketTrend: z
    .object({
      datasetVersion: z.string().min(1),
      query: HousePriceMarketTrendQuerySchema,
    })
    .optional(),
});
export type PropertyComparableSearchDefinition = z.infer<
  typeof PropertyComparableSearchDefinitionSchema
>;

type ComparableSalesResult = ReturnType<typeof findComparableSales>;
type UnsupportedComparableSalesResult = Extract<
  ComparableSalesResult,
  { status: "unsupported-region" }
>;

export type PropertyMarketTrendView =
  | { status: "ready"; trend: HousePriceMarketTrend }
  | { status: "unavailable"; datasetVersion: string; message: string };

export type PropertyComparableView =
  | ({ accountId: string } & Exclude<
      ComparableSalesResult,
      UnsupportedComparableSalesResult
    >)
  | ({
      accountId: string;
      marketTrend?: PropertyMarketTrendView;
    } & UnsupportedComparableSalesResult)
  | {
      status: "unavailable";
      accountId: string;
      datasetVersion: string;
      message: string;
    };

export function buildPropertyComparableViews(
  definitions: readonly PropertyComparableSearchDefinition[],
  pricePaidArchive: PricePaidArchive,
  housePriceIndexArchive: HousePriceIndexArchive,
): PropertyComparableView[] {
  return definitions.map((definition) => {
    try {
      const release = selectPricePaidRelease(
        pricePaidArchive,
        definition.datasetVersion,
      );
      const result = findComparableSales(release, definition.query);
      const view = {
        accountId: definition.accountId,
        ...result,
      };
      if (
        result.status !== "unsupported-region" ||
        result.nation !== "northern-ireland" ||
        definition.marketTrend == null
      ) {
        return view;
      }
      try {
        const indexRelease = selectHousePriceIndexRelease(
          housePriceIndexArchive,
          definition.marketTrend.datasetVersion,
        );
        return {
          ...view,
          marketTrend: {
            status: "ready",
            trend: findNorthernIrelandMarketTrend(
              indexRelease,
              definition.marketTrend.query,
            ),
          },
        };
      } catch (error) {
        return {
          ...view,
          marketTrend: {
            status: "unavailable",
            datasetVersion: definition.marketTrend.datasetVersion,
            message:
              error instanceof Error
                ? error.message
                : "Northern Ireland market-trend evidence is unavailable.",
          },
        };
      }
    } catch (error) {
      return {
        status: "unavailable",
        accountId: definition.accountId,
        datasetVersion: definition.datasetVersion,
        message:
          error instanceof Error
            ? error.message
            : "Completed-sale comparables are unavailable.",
      };
    }
  });
}
