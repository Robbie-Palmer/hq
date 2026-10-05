import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { inflationDataset } from "./data";
import { ONS_INFLATION_SOURCES } from "./ons";
import {
  type InflationDataset,
  InflationDatasetSchema,
  type InflationDatasetRelease,
} from "./schema";

const canonicalJson = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

const nextPeriod = (period: string, frequency: "monthly" | "annual") => {
  if (frequency === "annual") return String(Number(period) + 1);
  const [yearText, monthText] = period.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  return month === 12
    ? `${year + 1}-01`
    : `${year}-${String(month + 1).padStart(2, "0")}`;
};

const validateContinuousCoverage = (release: InflationDatasetRelease) => {
  for (let index = 1; index < release.observations.length; index += 1) {
    const previous = release.observations[index - 1];
    const current = release.observations[index];
    assert(previous && current, `${release.versionId} has an empty interval`);
    assert(
      current.period === nextPeriod(previous.period, release.source.frequency),
      `${release.versionId} is missing an observation after ${previous.period}`,
    );
  }
};

export const validateDataset = (input: unknown): InflationDataset => {
  const dataset = InflationDatasetSchema.parse(input);
  const releaseKeys = dataset.releases.map(
    ({ index, versionId }) => `${index}:${versionId}`,
  );
  assert(
    new Set(releaseKeys).size === releaseKeys.length,
    "Inflation release IDs must be unique within each index",
  );

  const registry = new Map(
    ONS_INFLATION_SOURCES.map((source) => [source.index, source]),
  );
  for (const release of dataset.releases) {
    const source = registry.get(release.index);
    assert(source, `${release.index} has no source registry entry`);
    assert(
      release.source.datasetId === source.datasetId &&
        release.source.seriesId === source.seriesId &&
        release.source.frequency === source.frequency &&
        release.source.baseDefinition === source.baseDefinition &&
        release.source.geography === source.geography &&
        release.source.sourceUrl === source.sourceUrl,
      `${release.versionId} does not match the ${release.index} source registry`,
    );
    assert(
      release.source.coverageFrom === source.requiredFrom,
      `${release.versionId} does not include required history from ${source.requiredFrom}`,
    );
    validateContinuousCoverage(release);
  }

  for (const requiredIndex of ["CPI", "CPIH"] as const) {
    assert(
      dataset.releases.some(({ index }) => index === requiredIndex),
      `${requiredIndex} has no reviewed release`,
    );
  }
  for (const source of ONS_INFLATION_SOURCES) {
    assert(source.sourceUrl.startsWith("https://www.ons.gov.uk/"));
    assert(source.csvUrl.startsWith("https://www.ons.gov.uk/"));
    if (source.api != null) {
      assert(source.api.documentationUrl.startsWith("https://developer.ons.gov.uk/"));
      if (source.api.status === "retired") {
        assert(source.api.retiredReason, `${source.index} needs a retirement reason`);
      }
    }
  }
  return dataset;
};

export const buildArtifacts = (
  _packageRoot: string,
  input: unknown = inflationDataset,
) => {
  const dataset = validateDataset(input);
  const releasePath = `artifacts/releases/${dataset.datasetVersion}.json`;
  const releaseContent = canonicalJson(dataset);

  const latestByIndex = new Map<string, InflationDatasetRelease>();
  for (const release of dataset.releases) {
    const current = latestByIndex.get(release.index);
    if (
      current == null ||
      `${release.source.releaseVersion}:${release.versionId}` >
        `${current.source.releaseVersion}:${current.versionId}`
    ) {
      latestByIndex.set(release.index, release);
    }
  }

  const common = {
    datasetVersion: dataset.datasetVersion,
    releasedAt: dataset.releasedAt,
    supersedes: dataset.supersedes,
    corrections: dataset.corrections,
    dataLicence: dataset.dataLicence,
  };
  const coverage = {
    ...common,
    currency: "GBP",
    indices: ONS_INFLATION_SOURCES.map((source) => {
      const release = latestByIndex.get(source.index);
      return {
        index: source.index,
        role: source.role,
        available: release != null,
        datasetId: source.datasetId,
        seriesId: source.seriesId,
        frequency: source.frequency,
        baseDefinition: source.baseDefinition,
        geography: source.geography,
        requiredFrom: source.requiredFrom,
        coverageThrough: release?.source.coverageThrough ?? null,
        releaseVersion: release?.source.releaseVersion ?? null,
        releaseVersionId: release?.versionId ?? null,
        apiStatus: source.api?.status ?? "not-configured",
        fallback: "ONS time-series CSV",
      };
    }),
    adjustment: {
      method: "reference-index-level / source-index-level",
      monthlyDates: "calendar-month observation",
      annualDates: "calendar-year observation",
      missingPeriods: "unavailable",
      futurePeriods: "unavailable",
      indexSubstitution: "never",
    },
  };
  const coveragePath = `artifacts/coverage-matrix/${dataset.datasetVersion}.json`;
  const coverageContent = canonicalJson(coverage);
  const manifest = {
    ...common,
    artifacts: [
      { path: releasePath, sha256: sha256(releaseContent) },
      { path: coveragePath, sha256: sha256(coverageContent) },
    ],
    sources: dataset.releases.map(({ index, versionId, source }) => ({
      index,
      versionId,
      datasetId: source.datasetId,
      seriesId: source.seriesId,
      sourceUrl: source.sourceUrl,
      releaseVersion: source.releaseVersion,
      retrievedAt: source.retrievedAt,
      sourceContentSha256: source.checksum.replace(/^sha256:/, ""),
    })),
  };

  return new Map([
    [releasePath, releaseContent],
    [coveragePath, coverageContent],
    ["artifacts/manifest.json", canonicalJson(manifest)],
  ]);
};
