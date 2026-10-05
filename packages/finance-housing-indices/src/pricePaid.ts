import { createHash } from "node:crypto";
import { parseCsv } from "ts-base/csv";
import { fetchWithRetry } from "ts-base/http";
import {
  type PricePaidPropertyType,
  type PricePaidRelease,
  PricePaidReleaseSchema,
  type PricePaidTenure,
  type PricePaidTransaction,
} from "./pricePaidSchema";

export type PricePaidSourceSpec = {
  releasePeriod: string;
  publishedAt: string;
  pageUrl: string;
  downloadUrl: string;
  observedThrough: string;
  latestCompleteMonth: string;
};

const PRICE_PAID_COLUMNS = 16;

const propertyTypes: Record<string, PricePaidPropertyType> = {
  D: "detached",
  S: "semi-detached",
  T: "terraced",
  F: "flat-maisonette",
  O: "other",
};

const tenures: Record<string, PricePaidTenure> = {
  F: "freehold",
  L: "leasehold",
  U: "unknown",
};

const recordStatuses: Record<
  string,
  PricePaidTransaction["recordStatus"]
> = {
  A: "added",
  C: "changed",
  D: "deleted",
};

function requiredMapping<Value>(
  values: Readonly<Record<string, Value>>,
  code: string,
  field: string,
): Value {
  const value = values[code];
  if (value == null) throw new Error(`Unknown Price Paid Data ${field}: ${code}`);
  return value;
}

function completionDate(value: string): string {
  const date = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Invalid Price Paid Data completion date: ${value}`);
  }
  return date;
}

function optional(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function transactionFromRow(
  row: readonly string[],
  rowNumber: number,
): PricePaidTransaction {
  if (row.length !== PRICE_PAID_COLUMNS) {
    throw new Error(
      `Price Paid Data row ${rowNumber} has ${row.length} columns; expected ${PRICE_PAID_COLUMNS}`,
    );
  }
  const [
    transactionId = "",
    rawPrice = "",
    rawCompletionDate = "",
    rawPostcode = "",
    rawPropertyType = "",
    rawNewBuild = "",
    rawTenure = "",
    ,
    ,
    ,
    ,
    rawTownCity = "",
    rawDistrict = "",
    rawCounty = "",
    ,
    rawRecordStatus = "",
  ] = row;
  const price = Number(rawPrice);
  if (!Number.isInteger(price) || price <= 0) {
    throw new Error(`Invalid Price Paid Data price on row ${rowNumber}`);
  }
  if (rawNewBuild !== "Y" && rawNewBuild !== "N") {
    throw new Error(`Unknown Price Paid Data new-build flag: ${rawNewBuild}`);
  }
  return {
    transactionId: transactionId.replaceAll(/[{}]/g, ""),
    price,
    completionDate: completionDate(rawCompletionDate),
    postcode: optional(rawPostcode)?.toUpperCase(),
    propertyType: requiredMapping(
      propertyTypes,
      rawPropertyType,
      "property type",
    ),
    newBuild: rawNewBuild === "Y",
    tenure: requiredMapping(tenures, rawTenure, "tenure"),
    townCity: rawTownCity,
    district: optional(rawDistrict),
    county: optional(rawCounty),
    recordStatus: requiredMapping(
      recordStatuses,
      rawRecordStatus,
      "record status",
    ),
  };
}

function checksum(payload: string): string {
  return `sha256:${createHash("sha256").update(payload).digest("hex")}`;
}

export function parsePricePaidCsv(
  spec: PricePaidSourceSpec,
  csv: string,
  retrievedAt: string,
): PricePaidRelease {
  const rows = parseCsv(csv);
  if (rows.length === 0) throw new Error("Price Paid Data CSV is empty");
  const digest = checksum(csv);
  return PricePaidReleaseSchema.parse({
    versionId: `${spec.releasePeriod}:${digest.slice("sha256:".length, 19)}`,
    source: {
      provider: "HM Land Registry",
      dataset: "Price Paid Data",
      releasePeriod: spec.releasePeriod,
      publishedAt: spec.publishedAt,
      retrievedAt,
      pageUrl: spec.pageUrl,
      downloadUrl: spec.downloadUrl,
      coverage: "england-and-wales",
      observedThrough: spec.observedThrough,
      latestCompleteMonth: spec.latestCompleteMonth,
      checksum: digest,
      rawObjectKey: `price-paid/releases/${digest.slice("sha256:".length)}.csv`,
      licence: "Open Government Licence v3.0",
      attribution:
        "Contains HM Land Registry data © Crown copyright and database right 2021. This data is licensed under the Open Government Licence v3.0.",
    },
    transactions: rows.map((row, index) =>
      transactionFromRow(row, index + 1),
    ),
  });
}

export async function fetchPricePaidRelease(
  spec: PricePaidSourceSpec,
  options: { fetchImpl?: typeof fetch; retrievedAt?: string } = {},
): Promise<{ raw: string; release: PricePaidRelease }> {
  const response = await fetchWithRetry(spec.downloadUrl, {
    fetch: options.fetchImpl,
    init: { headers: { Accept: "text/csv" } },
  });
  if (!response.ok) {
    throw new Error(
      `HM Land Registry Price Paid Data request failed with status ${response.status}`,
    );
  }
  const raw = await response.text();
  return {
    raw,
    release: parsePricePaidCsv(
      spec,
      raw,
      options.retrievedAt ?? new Date().toISOString(),
    ),
  };
}

export type PricePaidReleaseStore = {
  hasRelease(checksum: string): Promise<boolean>;
  putRawSource(objectKey: string, raw: string): Promise<void>;
  putRelease(release: PricePaidRelease): Promise<void>;
};

export async function storePricePaidRelease(
  store: PricePaidReleaseStore,
  input: { raw: string; release: PricePaidRelease },
): Promise<"stored" | "unchanged"> {
  const release = PricePaidReleaseSchema.parse(input.release);
  const digest = checksum(input.raw);
  if (digest !== release.source.checksum) {
    throw new Error(
      "Price Paid Data raw source does not match the release checksum",
    );
  }
  if (await store.hasRelease(digest)) return "unchanged";
  await store.putRawSource(release.source.rawObjectKey, input.raw);
  await store.putRelease(release);
  return "stored";
}
