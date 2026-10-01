import { z } from "zod";
import {
  type InflationDatasetArchive,
  InflationDatasetArchiveSchema,
  type InflationDatasetRelease,
  InflationDatasetReleaseSchema,
  type InflationFrequency,
  type InflationIndex,
} from "./schema";

export type InflationErrorCode =
  | "dataset_unavailable"
  | "future_period_unavailable"
  | "missing_period"
  | "period_unavailable"
  | "unsupported_currency";

export class InflationDataError extends Error {
  constructor(
    readonly code: InflationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "InflationDataError";
  }
}

function periodForDate(date: string, frequency: InflationFrequency): string {
  const parsed = z.iso.date().parse(date);
  return frequency === "monthly" ? parsed.slice(0, 7) : parsed.slice(0, 4);
}

function indexLevelAt(
  release: InflationDatasetRelease,
  date: string,
): { period: string; value: number } {
  const period = periodForDate(date, release.source.frequency);
  const observation = release.observations.find(
    (candidate) => candidate.period === period,
  );
  if (observation != null) return observation;

  if (period > release.source.coverageThrough) {
    throw new InflationDataError(
      "future_period_unavailable",
      `${release.index} is available through ${release.source.coverageThrough}; ${period} has not been published`,
    );
  }
  if (period < release.source.coverageFrom) {
    throw new InflationDataError(
      "period_unavailable",
      `${release.index} starts at ${release.source.coverageFrom}; ${period} is outside its coverage`,
    );
  }
  throw new InflationDataError(
    "missing_period",
    `${release.index} has no ${release.source.frequency} observation for ${period}`,
  );
}

export function selectInflationDataset(
  archive: InflationDatasetArchive,
  index: InflationIndex,
  versionId: string,
): InflationDatasetRelease {
  const release = archive.releases.find(
    (candidate) =>
      candidate.index === index && candidate.versionId === versionId,
  );
  if (release == null) {
    throw new InflationDataError(
      "dataset_unavailable",
      `${index} dataset version ${versionId} is unavailable`,
    );
  }
  return release;
}

export function ingestInflationRelease(
  archive: InflationDatasetArchive,
  candidate: InflationDatasetRelease,
): InflationDatasetArchive {
  const current = InflationDatasetArchiveSchema.parse(archive);
  const release = InflationDatasetReleaseSchema.parse(candidate);
  const alreadyStored = current.releases.some(
    (stored) =>
      stored.index === release.index &&
      stored.versionId === release.versionId &&
      stored.source.checksum === release.source.checksum,
  );
  if (alreadyStored) return current;

  return InflationDatasetArchiveSchema.parse({
    releases: [...current.releases, release].toSorted((a, b) =>
      `${a.source.releaseVersion}:${a.index}:${a.versionId}`.localeCompare(
        `${b.source.releaseVersion}:${b.index}:${b.versionId}`,
      ),
    ),
  });
}

export type InflationAdjustmentInput = {
  amount: number;
  currency: string;
  sourceDate: string;
  referenceDate: string;
};

export type InflationAdjustment = {
  amount: number;
  index: InflationIndex;
  datasetVersion: string;
  sourcePeriod: string;
  sourceIndexLevel: number;
  referencePeriod: string;
  referenceIndexLevel: number;
};

/**
 * Expresses an amount in reference-date pounds using an exact index ratio.
 * Monthly datasets map dates to their calendar month. Annual datasets map all
 * dates in a year to that year's observation. Missing observations and future
 * periods fail rather than carrying a value forward.
 */
export function adjustForInflation(
  release: InflationDatasetRelease,
  input: InflationAdjustmentInput,
): InflationAdjustment {
  if (input.currency !== "GBP") {
    throw new InflationDataError(
      "unsupported_currency",
      `${release.index} is a UK price index and cannot adjust ${input.currency} values`,
    );
  }
  if (!Number.isFinite(input.amount)) {
    throw new TypeError("Inflation adjustment amount must be finite");
  }
  const source = indexLevelAt(release, input.sourceDate);
  const reference = indexLevelAt(release, input.referenceDate);
  return {
    amount: input.amount * (reference.value / source.value),
    index: release.index,
    datasetVersion: release.versionId,
    sourcePeriod: source.period,
    sourceIndexLevel: source.value,
    referencePeriod: reference.period,
    referenceIndexLevel: reference.value,
  };
}

export function inflationDatasetDisclosure(
  release: InflationDatasetRelease,
  referenceDate: string,
  currency: string,
): {
  indexLabel: string;
  referencePeriod: string;
  releaseLabel: string;
  sourceLabel: string;
  warning: string | null;
} {
  const referencePeriod = periodForDate(
    referenceDate,
    release.source.frequency,
  );
  let warning: string | null = null;
  if (currency !== "GBP") {
    warning = `${release.index} only supports GBP comparisons.`;
  } else if (referencePeriod > release.source.coverageThrough) {
    warning = `${referencePeriod} is not available. The latest published period is ${release.source.coverageThrough}.`;
  } else if (release.index === "RPI") {
    warning =
      "RPI is a legacy measure and is not interchangeable with CPI or CPIH.";
  }
  let indexLabel: string;
  if (release.index === "CPIH") {
    indexLabel = "CPIH, including owner occupiers' housing costs";
  } else if (release.index === "CPI") {
    indexLabel = "CPI, excluding owner occupiers' housing costs";
  } else {
    indexLabel = "RPI, Retail Prices Index";
  }
  return {
    indexLabel,
    referencePeriod,
    releaseLabel: `ONS ${release.source.releaseVersion}, dataset ${release.versionId}`,
    sourceLabel: `${release.source.seriesId}, ${release.source.frequency}, ${release.source.geography}`,
    warning,
  };
}

export * from "./schema";
