import { createHash } from "node:crypto";
import { fetchWithRetry } from "ts-base/http";
import {
  type HousePriceIndexObservation,
  type HousePriceIndexRelease,
  HousePriceIndexReleaseSchema,
  type HousePropertyType,
} from "./schema";

export type UkHpiSourceSpec = {
  releasePeriod: string;
  publishedAt: string;
  pageUrl: string;
  downloadUrl: string;
};

export const UK_HPI_SOURCE: UkHpiSourceSpec = {
  releasePeriod: "2026-07",
  publishedAt: "2026-09-16",
  pageUrl:
    "https://www.gov.uk/government/statistical-data-sets/uk-house-price-index-data-downloads-july-2026",
  downloadUrl:
    "https://publicdata.landregistry.gov.uk/market-trend-data/house-price-index-data/UK-HPI-full-file-2026-07.csv",
};

const PROPERTY_INDEX_COLUMNS: ReadonlyArray<{
  propertyType: HousePropertyType;
  column: string;
}> = [
  { propertyType: "all", column: "Index" },
  { propertyType: "detached", column: "DetachedIndex" },
  { propertyType: "semi-detached", column: "SemiDetachedIndex" },
  { propertyType: "terraced", column: "TerracedIndex" },
  { propertyType: "flat-maisonette", column: "FlatIndex" },
];

// A small RFC 4180 scanner is easier to audit here than a parser configured
// with permissive coercions. The upstream file contains quoted fields.
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: CSV state machine
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  if (quoted) throw new Error("UK HPI CSV contains an unterminated quoted field");
  return rows;
}

function monthFromUkDate(value: string): string {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  const month = match?.[2];
  const year = match?.[3];
  if (month == null || year == null) {
    throw new Error(`Invalid UK HPI observation date: ${value}`);
  }
  return `${year}-${month}`;
}

function monthsApart(earlier: string, later: string): number {
  const [earlierYear = 0, earlierMonth = 0] = earlier.split("-").map(Number);
  const [laterYear = 0, laterMonth = 0] = later.split("-").map(Number);
  return (laterYear - earlierYear) * 12 + laterMonth - earlierMonth;
}

function checksum(payload: string): string {
  return `sha256:${createHash("sha256").update(payload).digest("hex")}`;
}

function observationsFromRow(
  row: readonly string[],
  positions: ReadonlyMap<string, number>,
  releasePeriod: string,
): HousePriceIndexObservation[] {
  const rawDate = row[positions.get("Date") ?? -1];
  const geographyName = row[positions.get("RegionName") ?? -1];
  const geographyCode = row[positions.get("AreaCode") ?? -1];
  if (!rawDate || !geographyName || !geographyCode) return [];
  const period = monthFromUkDate(rawDate);
  const ageInMonths = monthsApart(period, releasePeriod);
  return PROPERTY_INDEX_COLUMNS.flatMap(({ propertyType, column }) => {
    const value = Number(row[positions.get(column) ?? -1]);
    return Number.isFinite(value) && value > 0
      ? [
          {
            period,
            geographyCode,
            geographyName,
            propertyType,
            index: value,
            provisional: ageInMonths >= 0 && ageInMonths < 12,
          },
        ]
      : [];
  });
}

export function parseUkHpiCsv(
  spec: UkHpiSourceSpec,
  csv: string,
  retrievedAt: string,
): HousePriceIndexRelease {
  const rows = parseCsv(csv);
  const header = rows[0];
  if (header == null) throw new Error("UK HPI CSV is empty");
  const positions = new Map(header.map((column, index) => [column, index]));
  for (const column of [
    "Date",
    "RegionName",
    "AreaCode",
    ...PROPERTY_INDEX_COLUMNS.map(({ column }) => column),
  ]) {
    if (!positions.has(column)) {
      throw new Error(`UK HPI CSV is missing the ${column} column`);
    }
  }

  const observations = rows
    .slice(1)
    .flatMap((row) => observationsFromRow(row, positions, spec.releasePeriod));
  if (observations.length === 0) {
    throw new Error("UK HPI CSV has no usable index observations");
  }

  observations.sort((left, right) =>
    `${left.geographyCode}:${left.propertyType}:${left.period}`.localeCompare(
      `${right.geographyCode}:${right.propertyType}:${right.period}`,
    ),
  );
  const digest = checksum(csv);
  return HousePriceIndexReleaseSchema.parse({
    versionId: `${spec.releasePeriod}:${digest.slice("sha256:".length, 19)}`,
    source: {
      provider: "HM Land Registry",
      dataset: "UK House Price Index",
      releasePeriod: spec.releasePeriod,
      publishedAt: spec.publishedAt,
      retrievedAt,
      pageUrl: spec.pageUrl,
      downloadUrl: spec.downloadUrl,
      checksum: digest,
      rawObjectKey: `uk-hpi/releases/${digest.slice("sha256:".length)}.csv`,
      licence: "Open Government Licence v3.0",
      attribution: `Contains HM Land Registry data © Crown copyright and database right ${spec.publishedAt.slice(0, 4)}. Licensed under the Open Government Licence v3.0.`,
    },
    observations,
  });
}

export async function fetchUkHpiRelease(
  spec: UkHpiSourceSpec,
  options: { fetchImpl?: typeof fetch; retrievedAt?: string } = {},
): Promise<{ raw: string; release: HousePriceIndexRelease }> {
  const response = await fetchWithRetry(spec.downloadUrl, {
    fetch: options.fetchImpl,
    init: { headers: { Accept: "text/csv" } },
  });
  if (!response.ok) {
    throw new Error(`UK HPI request failed with status ${response.status}`);
  }
  const raw = await response.text();
  return {
    raw,
    release: parseUkHpiCsv(
      spec,
      raw,
      options.retrievedAt ?? new Date().toISOString(),
    ),
  };
}
