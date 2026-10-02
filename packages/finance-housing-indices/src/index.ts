import { createHash } from "node:crypto";
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
  const release = HousePriceIndexReleaseSchema.parse(candidate);
  if (
    current.releases.some(
      ({ source }) => source.checksum === release.source.checksum,
    )
  ) {
    return current;
  }
  return HousePriceIndexArchiveSchema.parse({
    releases: [...current.releases, release].toSorted((left, right) =>
      `${left.source.publishedAt}:${left.versionId}`.localeCompare(
        `${right.source.publishedAt}:${right.versionId}`,
      ),
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

export type HousePriceIndexReleaseStore = {
  hasRelease(checksum: string): Promise<boolean>;
  putRawSource(objectKey: string, raw: string): Promise<void>;
  putRelease(release: HousePriceIndexRelease): Promise<void>;
};

export async function storeHousePriceIndexRelease(
  store: HousePriceIndexReleaseStore,
  input: { raw: string; release: HousePriceIndexRelease },
): Promise<"stored" | "unchanged"> {
  const release = HousePriceIndexReleaseSchema.parse(input.release);
  const checksum = `sha256:${createHash("sha256").update(input.raw).digest("hex")}`;
  if (checksum !== release.source.checksum) {
    throw new Error("UK HPI raw source does not match the release checksum");
  }
  if (await store.hasRelease(release.source.checksum)) return "unchanged";
  await store.putRawSource(release.source.rawObjectKey, input.raw);
  await store.putRelease(release);
  return "stored";
}

export * from "./schema";
