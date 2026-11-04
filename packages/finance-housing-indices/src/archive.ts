import { z } from "zod";
import {
  type HousePriceIndexArchive,
  HousePriceIndexArchiveSchema,
  type HousePriceIndexObservation,
  type HousePriceIndexRelease,
  HousePriceIndexReleaseSchema,
  type HousePropertyType,
} from "./schema";

export type HousePriceIndexErrorCode =
  | "release_unavailable"
  | "observation_unavailable";

export class HousePriceIndexError extends Error {
  constructor(
    readonly code: HousePriceIndexErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "HousePriceIndexError";
  }
}

export type HousePriceIndexQuery = {
  geographyCode: string;
  propertyType: HousePropertyType;
  anchorDate: string;
  targetDate: string;
};

export type HousePriceIndexComparison = {
  releaseVersionId: string;
  anchor: HousePriceIndexObservation;
  target: HousePriceIndexObservation;
  ratio: number;
};

function monthForDate(date: string): string {
  return z.iso.date().parse(date).slice(0, 7);
}

function observationAt(
  release: HousePriceIndexRelease,
  geographyCode: string,
  propertyType: HousePropertyType,
  period: string,
): HousePriceIndexObservation {
  const observation = release.observations.find(
    (candidate) =>
      candidate.geographyCode === geographyCode &&
      candidate.propertyType === propertyType &&
      candidate.period === period,
  );
  if (observation == null) {
    throw new HousePriceIndexError(
      "observation_unavailable",
      `UK HPI has no ${propertyType} observation for ${geographyCode} in ${period}`,
    );
  }
  return observation;
}

function releaseChronologyKey(release: HousePriceIndexRelease): string {
  return `${release.source.publishedAt}:${release.source.retrievedAt}:${release.versionId}`;
}

function observationKey(observation: HousePriceIndexObservation): string {
  return `${observation.period}:${observation.geographyCode}:${observation.propertyType}`;
}

function sourcedValuesChanged(
  previous: HousePriceIndexObservation,
  observation: HousePriceIndexObservation,
): boolean {
  return (
    previous.index !== observation.index ||
    previous.averagePrice !== observation.averagePrice ||
    previous.salesVolume !== observation.salesVolume
  );
}

function markRevisedObservations(
  archive: HousePriceIndexArchive,
  candidate: HousePriceIndexRelease,
): HousePriceIndexRelease {
  const candidateChronologyKey = releaseChronologyKey(candidate);
  const previousObservations = new Map<string, HousePriceIndexObservation>();
  const priorReleases = archive.releases
    .filter(
      (release) => releaseChronologyKey(release) < candidateChronologyKey,
    )
    .toSorted((left, right) =>
      releaseChronologyKey(right).localeCompare(releaseChronologyKey(left)),
    );

  for (const release of priorReleases) {
    for (const observation of release.observations) {
      const key = observationKey(observation);
      if (!previousObservations.has(key)) {
        previousObservations.set(key, observation);
      }
    }
  }

  return HousePriceIndexReleaseSchema.parse({
    ...candidate,
    observations: candidate.observations.map((observation) => {
      const previous = previousObservations.get(observationKey(observation));
      const revised =
        observation.revisionStatus === "revised" ||
        previous?.revisionStatus === "revised" ||
        (previous != null && sourcedValuesChanged(previous, observation));
      return revised
        ? { ...observation, revisionStatus: "revised" }
        : observation;
    }),
  });
}

export function compareHousePriceIndices(
  release: HousePriceIndexRelease,
  query: HousePriceIndexQuery,
): HousePriceIndexComparison {
  const anchor = observationAt(
    release,
    query.geographyCode,
    query.propertyType,
    monthForDate(query.anchorDate),
  );
  const target = observationAt(
    release,
    query.geographyCode,
    query.propertyType,
    monthForDate(query.targetDate),
  );
  return {
    releaseVersionId: release.versionId,
    anchor,
    target,
    ratio: target.index / anchor.index,
  };
}

export function ingestHousePriceIndexRelease(
  archive: HousePriceIndexArchive,
  candidate: HousePriceIndexRelease,
): HousePriceIndexArchive {
  const current = HousePriceIndexArchiveSchema.parse(archive);
  const parsedCandidate = HousePriceIndexReleaseSchema.parse(candidate);
  if (
    current.releases.some(
      ({ source }) => source.checksum === parsedCandidate.source.checksum,
    )
  ) {
    return current;
  }
  const release = markRevisedObservations(current, parsedCandidate);
  return HousePriceIndexArchiveSchema.parse({
    releases: [...current.releases, release].toSorted((left, right) =>
      releaseChronologyKey(left).localeCompare(releaseChronologyKey(right)),
    ),
  });
}

export function selectHousePriceIndexRelease(
  archive: HousePriceIndexArchive,
  versionId: string,
): HousePriceIndexRelease {
  const release = archive.releases.find(
    (candidate) => candidate.versionId === versionId,
  );
  if (release == null) {
    throw new HousePriceIndexError(
      "release_unavailable",
      `UK HPI release ${versionId} is unavailable`,
    );
  }
  return release;
}
