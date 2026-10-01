import datasetJson from "../artifacts/releases/2026.10.0.json";
import {
  type InflationDataset,
  InflationDatasetSchema,
  type InflationDatasetRelease,
  type InflationIndex,
} from "./schema";

const artifact: unknown = datasetJson;

export const inflationDataset: InflationDataset =
  InflationDatasetSchema.parse(artifact);

export const onsInflationArchive = {
  releases: inflationDataset.releases,
};

export function latestOnsInflationRelease(
  index: InflationIndex,
): InflationDatasetRelease | null {
  return (
    inflationDataset.releases
      .filter((release) => release.index === index)
      .toSorted((left, right) =>
        `${right.source.releaseVersion}:${right.versionId}`.localeCompare(
          `${left.source.releaseVersion}:${left.versionId}`,
        ),
      )[0] ?? null
  );
}
