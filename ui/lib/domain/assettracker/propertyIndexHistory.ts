import {
  estimatePropertyValueHistory,
  type HousePriceIndexArchive,
  type PropertyValueHistory,
  PropertyValueHistoryInputSchema,
  selectHousePriceIndexRelease,
} from "finance-housing-indices/browser";
import { z } from "zod";
import { AccountIdSchema } from "./account";

export const PropertyIndexHistoryDefinitionSchema = z.object({
  accountId: AccountIdSchema,
  datasetVersion: z.string().min(1),
  input: PropertyValueHistoryInputSchema,
});
export type PropertyIndexHistoryDefinition = z.infer<
  typeof PropertyIndexHistoryDefinitionSchema
>;

export type PropertyValueHistoryView =
  | {
      status: "ready";
      accountId: string;
      history: PropertyValueHistory;
    }
  | {
      status: "unavailable";
      accountId: string;
      datasetVersion: string;
      message: string;
    };

export function buildPropertyValueHistoryViews(
  definitions: readonly PropertyIndexHistoryDefinition[],
  archive: HousePriceIndexArchive,
): PropertyValueHistoryView[] {
  return definitions.map((definition) => {
    try {
      const release = selectHousePriceIndexRelease(
        archive,
        definition.datasetVersion,
      );
      return {
        status: "ready",
        accountId: definition.accountId,
        history: estimatePropertyValueHistory(release, definition.input),
      };
    } catch (error) {
      return {
        status: "unavailable",
        accountId: definition.accountId,
        datasetVersion: definition.datasetVersion,
        message:
          error instanceof Error
            ? error.message
            : "The indexed property history is unavailable.",
      };
    }
  });
}
