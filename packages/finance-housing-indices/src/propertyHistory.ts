import { z } from "zod";
import {
  type HousePriceIndexObservation,
  type HousePriceIndexRelease,
  HousePriceIndexReleaseSchema,
  HousePropertyTypeSchema,
} from "./schema";

export const PropertyValuationKindSchema = z.enum([
  "purchase-price",
  "formal-valuation",
  "manual-valuation",
]);
export type PropertyValuationKind = z.infer<
  typeof PropertyValuationKindSchema
>;

export const RecordedPropertyValuationSchema = z.object({
  id: z.string().min(1),
  date: z.iso.date(),
  value: z.number().positive(),
  currency: z.literal("GBP"),
  kind: PropertyValuationKindSchema,
  sourceLabel: z.string().min(1).optional(),
});
export type RecordedPropertyValuation = z.infer<
  typeof RecordedPropertyValuationSchema
>;

export const HousePriceIndexSeriesCandidateSchema = z
  .object({
    geographyCode: z.string().min(1),
    propertyType: HousePropertyTypeSchema,
    geographyMatch: z.enum(["exact", "broader", "national"]),
    propertyTypeMatch: z.enum(["exact", "all"]),
  })
  .refine(
    (candidate) =>
      candidate.propertyTypeMatch !== "all" ||
      candidate.propertyType === "all",
    {
      message: "An all-property fallback must select the all-property series",
      path: ["propertyType"],
    },
  );
export type HousePriceIndexSeriesCandidate = z.infer<
  typeof HousePriceIndexSeriesCandidateSchema
>;

export const PropertyValueHistoryInputSchema = z
  .object({
    recordedValuations: z.array(RecordedPropertyValuationSchema).min(1),
    anchorValuationId: z.string().min(1),
    targetDates: z.array(z.iso.date()).min(1),
    seriesHierarchy: z
      .array(HousePriceIndexSeriesCandidateSchema)
      .min(1),
  })
  .superRefine((input, context) => {
    const valuationIds = input.recordedValuations.map(({ id }) => id);
    if (new Set(valuationIds).size !== valuationIds.length) {
      context.addIssue({
        code: "custom",
        message: "Recorded property valuations must have unique IDs",
        path: ["recordedValuations"],
      });
    }
    if (new Set(input.targetDates).size !== input.targetDates.length) {
      context.addIssue({
        code: "custom",
        message: "Property history target dates must be unique",
        path: ["targetDates"],
      });
    }
    const seriesKeys = input.seriesHierarchy.map(
      ({ geographyCode, propertyType }) =>
        `${geographyCode}:${propertyType}`,
    );
    if (new Set(seriesKeys).size !== seriesKeys.length) {
      context.addIssue({
        code: "custom",
        message: "Property index fallback candidates must be unique",
        path: ["seriesHierarchy"],
      });
    }
  });

export type PropertyValueHistoryInput = z.input<
  typeof PropertyValueHistoryInputSchema
>;

export type PropertyHistoryErrorCode =
  | "anchor_unavailable"
  | "series_unavailable";

export class PropertyHistoryError extends Error {
  constructor(
    readonly code: PropertyHistoryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PropertyHistoryError";
  }
}

export const PROPERTY_INDEX_FORMULA =
  "estimatedValue = anchorValue * (targetIndexLevel / anchorIndexLevel)" as const;

export type SelectedHousePriceIndexSeries =
  HousePriceIndexSeriesCandidate & {
    geographyName: string;
    hierarchyPosition: number;
    fallback: boolean;
    label: string;
  };

export type SkippedHousePriceIndexSeries = {
  candidate: HousePriceIndexSeriesCandidate;
  reason: "anchor-period-unavailable";
};

export type PropertyIndexCalculation = {
  method: "uk-hpi-index-ratio";
  formula: typeof PROPERTY_INDEX_FORMULA;
  anchor: RecordedPropertyValuation & {
    period: string;
    indexLevel: number;
    provisional: boolean;
  };
  series: SelectedHousePriceIndexSeries;
  skippedSeries: SkippedHousePriceIndexSeries[];
  dataset: {
    provider: "HM Land Registry";
    name: "UK House Price Index";
    versionId: string;
    releasePeriod: string;
    publishedAt: string;
    checksum: string;
  };
};

export type IndexedPropertyValueEstimate = {
  kind: "index-estimate";
  date: string;
  period: string;
  value: number;
  currency: "GBP";
  targetIndexLevel: number;
  provisional: boolean;
};

export type UnavailablePropertyValueEstimate = {
  kind: "index-unavailable";
  date: string;
  period: string;
  reason: "index-period-unavailable";
};

export type PropertyValueEstimate =
  | IndexedPropertyValueEstimate
  | UnavailablePropertyValueEstimate;

export type PropertyValueHistory = {
  recordedValuations: RecordedPropertyValuation[];
  calculation: PropertyIndexCalculation;
  estimates: PropertyValueEstimate[];
};

function monthForDate(date: string): string {
  return date.slice(0, 7);
}

function indexObservation(
  release: HousePriceIndexRelease,
  candidate: HousePriceIndexSeriesCandidate,
  period: string,
): HousePriceIndexObservation | undefined {
  return release.observations.find(
    (observation) =>
      observation.geographyCode === candidate.geographyCode &&
      observation.propertyType === candidate.propertyType &&
      observation.period === period,
  );
}

function seriesLabel(
  candidate: HousePriceIndexSeriesCandidate,
  observation: HousePriceIndexObservation,
): string {
  const series = `${observation.geographyName}, ${candidate.propertyType}`;
  if (candidate.geographyMatch === "national") {
    return `National fallback: ${series}`;
  }
  if (candidate.geographyMatch === "broader") {
    return `Broader geography fallback: ${series}`;
  }
  if (candidate.propertyTypeMatch === "all") {
    return `Property-type fallback: ${series}`;
  }
  return `Exact match: ${series}`;
}

function selectSeries(
  release: HousePriceIndexRelease,
  hierarchy: readonly HousePriceIndexSeriesCandidate[],
  anchorPeriod: string,
): {
  selected: SelectedHousePriceIndexSeries;
  anchorObservation: HousePriceIndexObservation;
  skipped: SkippedHousePriceIndexSeries[];
} {
  const skipped: SkippedHousePriceIndexSeries[] = [];
  for (const [index, candidate] of hierarchy.entries()) {
    const observation = indexObservation(release, candidate, anchorPeriod);
    if (observation == null) {
      skipped.push({ candidate, reason: "anchor-period-unavailable" });
      continue;
    }
    return {
      selected: {
        ...candidate,
        geographyName: observation.geographyName,
        hierarchyPosition: index + 1,
        fallback:
          index > 0 ||
          candidate.geographyMatch !== "exact" ||
          candidate.propertyTypeMatch !== "exact",
        label: seriesLabel(candidate, observation),
      },
      anchorObservation: observation,
      skipped,
    };
  }
  throw new PropertyHistoryError(
    "series_unavailable",
    `No property index fallback candidate has an observation for ${anchorPeriod}`,
  );
}

/**
 * Rebases one recorded property value through a single series from a pinned UK
 * HPI release. Recorded values and derived estimates stay in separate arrays.
 * Missing target periods remain unavailable rather than borrowing another
 * period or changing series partway through the history.
 */
export function estimatePropertyValueHistory(
  candidateRelease: HousePriceIndexRelease,
  candidateInput: PropertyValueHistoryInput,
): PropertyValueHistory {
  const release = HousePriceIndexReleaseSchema.parse(candidateRelease);
  const input = PropertyValueHistoryInputSchema.parse(candidateInput);
  const anchor = input.recordedValuations.find(
    ({ id }) => id === input.anchorValuationId,
  );
  if (anchor == null) {
    throw new PropertyHistoryError(
      "anchor_unavailable",
      `Recorded property valuation ${input.anchorValuationId} is unavailable`,
    );
  }

  const anchorPeriod = monthForDate(anchor.date);
  const { selected, anchorObservation, skipped } = selectSeries(
    release,
    input.seriesHierarchy,
    anchorPeriod,
  );
  const estimates = input.targetDates
    .toSorted((left, right) => left.localeCompare(right))
    .map<PropertyValueEstimate>((date) => {
      const period = monthForDate(date);
      const target = indexObservation(release, selected, period);
      if (target == null) {
        return {
          kind: "index-unavailable",
          date,
          period,
          reason: "index-period-unavailable",
        };
      }
      return {
        kind: "index-estimate",
        date,
        period,
        value: anchor.value * (target.index / anchorObservation.index),
        currency: anchor.currency,
        targetIndexLevel: target.index,
        provisional: target.provisional,
      };
    });

  return {
    recordedValuations: input.recordedValuations,
    calculation: {
      method: "uk-hpi-index-ratio",
      formula: PROPERTY_INDEX_FORMULA,
      anchor: {
        ...anchor,
        period: anchorPeriod,
        indexLevel: anchorObservation.index,
        provisional: anchorObservation.provisional,
      },
      series: selected,
      skippedSeries: skipped,
      dataset: {
        provider: release.source.provider,
        name: release.source.dataset,
        versionId: release.versionId,
        releasePeriod: release.source.releasePeriod,
        publishedAt: release.source.publishedAt,
        checksum: release.source.checksum,
      },
    },
    estimates,
  };
}
