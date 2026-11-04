import {
  estimatePropertyValueHistory,
  type HousePriceIndexArchive,
  type HousingValue,
  HousingValueSchema,
  type PropertyValueHistory,
  PropertyValueHistoryInputSchema,
  selectHousePriceIndexRelease,
} from "finance-housing-indices/browser";
import { z } from "zod";
import { AccountIdSchema } from "./account";
import type { AssetTrackerData } from "./assetTrackerData";
import type { AssetTrackerRepository } from "./assetTrackerRepository";

export const PropertyValueSelectionSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("automatic-index") }),
  z.object({
    mode: z.literal("recorded-value"),
    valuationId: z.string().min(1),
  }),
]);
export type PropertyValueSelection = z.infer<
  typeof PropertyValueSelectionSchema
>;

export const SetPropertyValueSelectionInputSchema = z.object({
  accountId: AccountIdSchema,
  anchorValuationId: z.string().min(1),
  valueSelection: PropertyValueSelectionSchema,
});
export type SetPropertyValueSelectionInput = z.infer<
  typeof SetPropertyValueSelectionInputSchema
>;

export const PropertyIndexHistoryDefinitionSchema = z
  .object({
    accountId: AccountIdSchema,
    datasetVersion: z.string().min(1),
    input: PropertyValueHistoryInputSchema,
    valueSelection: PropertyValueSelectionSchema.default({
      mode: "automatic-index",
    }),
  })
  .superRefine((definition, context) => {
    const selection = definition.valueSelection;
    if (
      !definition.input.recordedValuations.some(
        ({ id }) => id === definition.input.anchorValuationId,
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "The anchor valuation must be recorded in the history",
        path: ["input", "anchorValuationId"],
      });
    }
    if (
      selection.mode === "recorded-value" &&
      !definition.input.recordedValuations.some(
        ({ id }) => id === selection.valuationId,
      )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "The selected property valuation must be recorded in the history",
        path: ["valueSelection", "valuationId"],
      });
    }
  });
export type PropertyIndexHistoryDefinition = z.infer<
  typeof PropertyIndexHistoryDefinitionSchema
>;

export type PropertyValueHistoryView =
  | {
      status: "ready";
      accountId: string;
      history: PropertyValueHistory;
      selection: PropertyValueSelection;
      selectedValue: HousingValue;
      selectionExplanation: string;
      recordedValues: HousingValue[];
      anchorValuationId: string;
    }
  | {
      status: "unavailable";
      accountId: string;
      datasetVersion: string;
      message: string;
      selection: PropertyValueSelection;
      selectedValue: HousingValue;
      selectionExplanation: string;
      recordedValues: HousingValue[];
      anchorValuationId: string;
    };

function recordedHousingValue(
  history: PropertyValueHistory,
  valuationId: string,
): HousingValue {
  const value = history.housingValues.find(({ id }) => id === valuationId);
  if (value == null) {
    throw new Error(
      `Recorded property valuation ${valuationId} is unavailable`,
    );
  }
  return value;
}

function recordedInputHousingValue(
  definition: PropertyIndexHistoryDefinition,
  valuationId: string,
): HousingValue {
  const valuation = definition.input.recordedValuations.find(
    ({ id }) => id === valuationId,
  );
  if (valuation == null) {
    throw new Error(
      `Recorded property valuation ${valuationId} is unavailable`,
    );
  }
  let kind: HousingValue["kind"] = "manual-override";
  if (valuation.kind === "purchase-price") kind = "recorded-purchase";
  if (valuation.kind === "formal-valuation") kind = "recorded-valuation";
  return HousingValueSchema.parse({
    id: valuation.id,
    kind,
    amount: valuation.value,
    currency: valuation.currency,
    asOf: valuation.date,
    source: valuation.source,
    dataStatus: valuation.dataStatus,
    revisionNote: valuation.revisionNote,
    uncertainty: valuation.uncertainty,
    explanation: valuation.explanation,
    freshness: valuation.freshness,
  });
}

function selectedValueFromHistory(
  history: PropertyValueHistory,
  selection: PropertyValueSelection,
): { value: HousingValue; explanation: string } {
  if (selection.mode === "recorded-value") {
    return {
      value: recordedHousingValue(history, selection.valuationId),
      explanation:
        "Automatic estimates are off. Net worth and decisions use the selected recorded value.",
    };
  }
  const estimate = history.housingValues
    .filter(({ kind }) => kind === "index-estimate")
    .toSorted((left, right) => left.asOf.localeCompare(right.asOf))
    .at(-1);
  if (estimate != null) {
    return {
      value: estimate,
      explanation:
        "Net worth and decisions use the latest available index estimate from the selected anchor.",
    };
  }
  const anchor = recordedHousingValue(history, history.calculation.anchor.id);
  return {
    value: anchor,
    explanation:
      "No index estimate is available, so net worth and decisions use the recorded anchor value.",
  };
}

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
      const history = estimatePropertyValueHistory(release, definition.input);
      const selected = selectedValueFromHistory(
        history,
        definition.valueSelection,
      );
      return {
        status: "ready",
        accountId: definition.accountId,
        history,
        selection: definition.valueSelection,
        selectedValue: selected.value,
        selectionExplanation: selected.explanation,
        recordedValues: history.housingValues.filter(({ kind }) =>
          [
            "recorded-purchase",
            "recorded-valuation",
            "manual-override",
          ].includes(kind),
        ),
        anchorValuationId: definition.input.anchorValuationId,
      };
    } catch (error) {
      const anchor = recordedInputHousingValue(
        definition,
        definition.valueSelection.mode === "recorded-value"
          ? definition.valueSelection.valuationId
          : definition.input.anchorValuationId,
      );
      return {
        status: "unavailable",
        accountId: definition.accountId,
        datasetVersion: definition.datasetVersion,
        message:
          error instanceof Error
            ? error.message
            : "The indexed property history is unavailable.",
        selection: definition.valueSelection,
        selectedValue: anchor,
        selectionExplanation:
          definition.valueSelection.mode === "recorded-value"
            ? "Automatic estimates are off. Net worth and decisions use the selected recorded value."
            : "Official index data are unavailable, so net worth and decisions use the recorded anchor value.",
        recordedValues: definition.input.recordedValuations.map((valuation) =>
          recordedInputHousingValue(definition, valuation.id),
        ),
        anchorValuationId: definition.input.anchorValuationId,
      };
    }
  });
}

export function applySetPropertyValueSelection(
  data: AssetTrackerData,
  candidate: SetPropertyValueSelectionInput,
): AssetTrackerData {
  const input = SetPropertyValueSelectionInputSchema.parse(candidate);
  let found = false;
  const propertyIndexHistories = (data.propertyIndexHistories ?? []).map(
    (definition) => {
      if (definition.accountId !== input.accountId) return definition;
      found = true;
      return PropertyIndexHistoryDefinitionSchema.parse({
        ...definition,
        input: {
          ...definition.input,
          anchorValuationId: input.anchorValuationId,
        },
        valueSelection: input.valueSelection,
      });
    },
  );
  if (!found) {
    throw new Error(
      `Property value history for ${input.accountId} was not found`,
    );
  }
  return { ...data, propertyIndexHistories };
}

export function withSelectedPropertyValues(
  repository: AssetTrackerRepository,
  views: readonly PropertyValueHistoryView[],
): AssetTrackerRepository {
  return {
    ...repository,
    selectedPropertyValues: new Map(
      views.map((view) => [view.accountId, view.selectedValue]),
    ),
  };
}
