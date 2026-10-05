import { createHash } from "node:crypto";
import { parseCsv } from "ts-base/csv";
import { ENGLISH_MONTH_ABBREVIATIONS } from "ts-base/dates";
import { fetchWithRetry } from "ts-base/http";
import {
  type InflationDatasetRelease,
  InflationDatasetReleaseSchema,
  type InflationIndex,
} from "./schema";

const MONTH_NUMBERS = new Map(
  ENGLISH_MONTH_ABBREVIATIONS.map((month, index) => [
    month.toUpperCase(),
    String(index + 1).padStart(2, "0"),
  ]),
);

export type OnsInflationSourceSpec = {
  index: InflationIndex;
  role: "primary" | "alternative" | "legacy";
  seriesId: string;
  datasetId: "MM23";
  baseDefinition: string;
  geography: "United Kingdom";
  frequency: "monthly";
  requiredFrom: string;
  sourceUrl: string;
  csvUrl: string;
  api?: {
    status: "active" | "retired";
    datasetId: string;
    edition: string;
    geography: string;
    aggregate: string;
    documentationUrl: string;
    retiredReason?: string;
  };
};

const ONS_DATASET_PATH = "/economy/inflationandpriceindices/timeseries";

function csvUrl(seriesId: string): string {
  const uri = `${ONS_DATASET_PATH}/${seriesId.toLowerCase()}/mm23`;
  return `https://www.ons.gov.uk/generator?format=csv&uri=${encodeURIComponent(uri)}`;
}

export const ONS_INFLATION_SOURCES: readonly OnsInflationSourceSpec[] = [
  {
    index: "CPI",
    role: "alternative",
    seriesId: "D7BT",
    datasetId: "MM23",
    baseDefinition: "2015=100",
    geography: "United Kingdom",
    frequency: "monthly",
    requiredFrom: "1988-01",
    sourceUrl:
      "https://www.ons.gov.uk/economy/inflationandpriceindices/timeseries/d7bt/mm23",
    csvUrl: csvUrl("D7BT"),
  },
  {
    index: "CPIH",
    role: "primary",
    seriesId: "L522",
    datasetId: "MM23",
    baseDefinition: "2015=100",
    geography: "United Kingdom",
    frequency: "monthly",
    requiredFrom: "1988-01",
    sourceUrl:
      "https://www.ons.gov.uk/economy/inflationandpriceindices/timeseries/l522/mm23",
    csvUrl: csvUrl("L522"),
    api: {
      status: "retired",
      datasetId: "cpih01",
      edition: "time-series",
      geography: "K02000001",
      aggregate: "CP00",
      documentationUrl: "https://developer.ons.gov.uk/observations/cmd/",
      retiredReason:
        "ONS stopped updating this API after January 2026 and directs users to published tables and time-series datasets.",
    },
  },
  {
    index: "RPI",
    role: "legacy",
    seriesId: "CHAW",
    datasetId: "MM23",
    baseDefinition: "January 1987=100",
    geography: "United Kingdom",
    frequency: "monthly",
    requiredFrom: "1987-01",
    sourceUrl:
      "https://www.ons.gov.uk/economy/inflationandpriceindices/timeseries/chaw/mm23",
    csvUrl: csvUrl("CHAW"),
  },
] as const;

function releaseDateFromCsv(value: string): string {
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(value);
  const day = match?.[1];
  const month = match?.[2];
  const year = match?.[3];
  if (day == null || month == null || year == null) {
    throw new Error(`Invalid ONS release date: ${value}`);
  }
  return `${year}-${month}-${day}`;
}

function checksum(payload: string): string {
  return `sha256:${createHash("sha256").update(payload).digest("hex")}`;
}

function assertContinuousMonthlyCoverage(periods: readonly string[]): void {
  for (let index = 1; index < periods.length; index += 1) {
    const previous = periods[index - 1];
    if (previous == null) throw new Error("ONS monthly series is empty");
    const [yearText, monthText] = previous.split("-");
    const year = Number(yearText);
    const month = Number(monthText);
    const expected =
      month === 12
        ? `${year + 1}-01`
        : `${year}-${String(month + 1).padStart(2, "0")}`;
    if (periods[index] !== expected) {
      throw new Error(
        `ONS monthly series is missing ${expected} between ${periods[index - 1]} and ${periods[index]}`,
      );
    }
  }
}

function buildRelease(
  spec: OnsInflationSourceSpec,
  payload: string,
  releaseVersion: string,
  retrievedAt: string,
  observations: Array<{ period: string; value: number }>,
  sourceUrl: string,
): InflationDatasetRelease {
  const selected = observations
    .filter(({ period }) => period >= spec.requiredFrom)
    .toSorted((a, b) => a.period.localeCompare(b.period));
  if (selected[0]?.period !== spec.requiredFrom) {
    throw new Error(
      `${spec.index} does not cover the required first period ${spec.requiredFrom}`,
    );
  }
  assertContinuousMonthlyCoverage(selected.map(({ period }) => period));
  const digest = checksum(payload);
  return InflationDatasetReleaseSchema.parse({
    versionId: `${releaseVersion}:${digest.slice("sha256:".length, 19)}`,
    index: spec.index,
    source: {
      provider: "Office for National Statistics",
      datasetId: spec.datasetId,
      seriesId: spec.seriesId,
      frequency: "monthly",
      baseDefinition: spec.baseDefinition,
      geography: spec.geography,
      coverageFrom: selected[0].period,
      coverageThrough: selected.at(-1)?.period,
      sourceUrl,
      releaseVersion,
      retrievedAt,
      checksum: digest,
    },
    observations: selected,
  });
}

export function parseOnsInflationCsv(
  spec: OnsInflationSourceSpec,
  csv: string,
  retrievedAt: string,
): InflationDatasetRelease {
  const rows = parseCsv(csv);
  const metadata = new Map(rows.slice(0, 8).map((row) => [row[0], row[1]]));
  if (metadata.get("CDID")?.toUpperCase() !== spec.seriesId) {
    throw new Error(`ONS CSV did not contain expected series ${spec.seriesId}`);
  }
  if (metadata.get("Source dataset ID")?.toUpperCase() !== spec.datasetId) {
    throw new Error(
      `ONS CSV did not contain expected dataset ${spec.datasetId}`,
    );
  }
  const releaseVersion = releaseDateFromCsv(metadata.get("Release date") ?? "");
  const observations = rows.flatMap((row) => {
    const label = row[0];
    const rawValue = row[1];
    if (label == null || rawValue == null) return [];
    const match = /^(\d{4}) ([A-Z]{3})$/.exec(label);
    const year = match?.[1];
    const monthLabel = match?.[2];
    if (year == null || monthLabel == null) return [];
    const month = MONTH_NUMBERS.get(monthLabel);
    const value = Number(rawValue);
    return month == null || !Number.isFinite(value) || value <= 0
      ? []
      : [{ period: `${year}-${month}`, value }];
  });
  return buildRelease(
    spec,
    csv,
    releaseVersion,
    retrievedAt,
    observations,
    spec.sourceUrl,
  );
}

type OnsApiObservationResponse = {
  observations?: Array<{
    observation?: string;
    dimensions?: { Time?: { label?: string } };
  }>;
};

export function parseOnsApiInflationObservations(
  spec: OnsInflationSourceSpec,
  response: OnsApiObservationResponse,
  releaseVersion: string,
  retrievedAt: string,
  sourceUrl: string,
): InflationDatasetRelease {
  const observations = (response.observations ?? []).flatMap((item) => {
    const match = /^([A-Z][a-z]{2})-(\d{2})$/.exec(
      item.dimensions?.Time?.label ?? "",
    );
    const monthLabel = match?.[1];
    const year = match?.[2];
    const month =
      monthLabel == null
        ? undefined
        : MONTH_NUMBERS.get(monthLabel.toUpperCase());
    const value = Number(item.observation);
    return month == null ||
      year == null ||
      !Number.isFinite(value) ||
      value <= 0
      ? []
      : [
          {
            period: `${Number(year) >= 80 ? "19" : "20"}${year}-${month}`,
            value,
          },
        ];
  });
  const payload = JSON.stringify(response);
  return buildRelease(
    spec,
    payload,
    releaseVersion,
    retrievedAt,
    observations,
    sourceUrl,
  );
}

async function fetchOnsResource(
  url: string,
  fetchImpl: typeof fetch = fetch,
  attempts = 3,
): Promise<Response> {
  const response = await fetchWithRetry(url, {
    attempts,
    fetch: fetchImpl,
    init: { headers: { Accept: "*/*" } },
  });
  if (!response.ok) {
    throw new Error(`ONS request failed with status ${response.status}`);
  }
  return response;
}

type OnsVersionsResponse = {
  items?: Array<{ version?: number; release_date?: string }>;
};

export async function fetchOnsInflationRelease(
  spec: OnsInflationSourceSpec,
  options: {
    fetchImpl?: typeof fetch;
    retrievedAt?: string;
    attempts?: number;
  } = {},
): Promise<InflationDatasetRelease> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const retrievedAt = options.retrievedAt ?? new Date().toISOString();
  const attempts = options.attempts ?? 3;
  if (spec.api?.status === "active") {
    const root = `https://api.beta.ons.gov.uk/v1/datasets/${spec.api.datasetId}/editions/${spec.api.edition}/versions`;
    const versionsResponse = await fetchOnsResource(
      `${root}?limit=1`,
      fetchImpl,
      attempts,
    );
    const versions = (await versionsResponse.json()) as OnsVersionsResponse;
    const latest = versions.items?.[0];
    if (latest?.version == null || latest.release_date == null) {
      throw new Error(
        `ONS API did not return a published ${spec.index} version`,
      );
    }
    const observationsUrl = `${root}/${latest.version}/observations?time=*&geography=${encodeURIComponent(spec.api.geography)}&aggregate=${encodeURIComponent(spec.api.aggregate)}`;
    const observationsResponse = await fetchOnsResource(
      observationsUrl,
      fetchImpl,
      attempts,
    );
    const observations =
      (await observationsResponse.json()) as OnsApiObservationResponse;
    return parseOnsApiInflationObservations(
      spec,
      observations,
      latest.release_date.slice(0, 10),
      retrievedAt,
      observationsUrl,
    );
  }

  const response = await fetchOnsResource(spec.csvUrl, fetchImpl, attempts);
  return parseOnsInflationCsv(spec, await response.text(), retrievedAt);
}
