import { sha256Hex } from "ts-base/crypto";
import { parseCsv } from "ts-base/csv";
import { z } from "zod";
import { type Currency, CurrencySchema } from "./currency";
import {
  invertExchangeRate,
  triangulateExchangeRates,
} from "./exchangeRateDecimal";
import type { ExchangeRatePair } from "./exchangeRateImport";

type Fetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type EcbReferenceRate = {
  fromCurrency: Currency;
  toCurrency: Currency;
  rate: number;
  rateDecimal: string;
  observedDate: string;
  sourceReference: string;
};

export type EcbReferenceRateResult = {
  rates: EcbReferenceRate[];
  unsupportedPairs: ExchangeRatePair[];
  requestUrls: string[];
};

export type EcbReferenceRateFailureKind =
  | "throttled"
  | "malformed_response"
  | "timeout"
  | "provider_outage";

export class EcbReferenceRateProviderError extends Error {
  readonly kind: EcbReferenceRateFailureKind;
  readonly retryAfter?: string;
  readonly requestUrl: string;

  constructor(
    kind: EcbReferenceRateFailureKind,
    message: string,
    options: {
      requestUrl: string;
      retryAfter?: string;
      cause?: unknown;
    },
  ) {
    super(message, { cause: options.cause });
    this.name = "EcbReferenceRateProviderError";
    this.kind = kind;
    this.retryAfter = options.retryAfter;
    this.requestUrl = options.requestUrl;
  }
}

export type FetchEcbReferenceRatesInput = {
  pairs: readonly ExchangeRatePair[];
  from: string;
  to: string;
  endpoint?: string;
  fetch?: Fetch;
  signal?: AbortSignal;
};

type EcbCurrencyObservation = {
  currency: Currency;
  date: string;
  unitsPerEuro: string;
};

const REQUIRED_COLUMNS = [
  "FREQ",
  "CURRENCY",
  "CURRENCY_DENOM",
  "EXR_TYPE",
  "EXR_SUFFIX",
  "TIME_PERIOD",
  "OBS_VALUE",
] as const;

function normalizedPairs(pairs: readonly ExchangeRatePair[]): {
  supported: Array<{ fromCurrency: Currency; toCurrency: Currency }>;
  unsupported: ExchangeRatePair[];
} {
  const supported = new Map<
    string,
    { fromCurrency: Currency; toCurrency: Currency }
  >();
  const unsupported = new Map<string, ExchangeRatePair>();
  for (const pair of pairs) {
    const from = CurrencySchema.safeParse(pair.fromCurrency);
    const to = CurrencySchema.safeParse(pair.toCurrency);
    const key = `${pair.fromCurrency}/${pair.toCurrency}`;
    if (!from.success || !to.success || from.data === to.data) {
      unsupported.set(key, pair);
      continue;
    }
    supported.set(key, {
      fromCurrency: from.data,
      toCurrency: to.data,
    });
  }
  return {
    supported: [...supported.values()],
    unsupported: [...unsupported.values()],
  };
}

function ecbCurrencies(
  pairs: ReadonlyArray<{ fromCurrency: Currency; toCurrency: Currency }>,
): Currency[] {
  return [
    ...new Set(pairs.flatMap((pair) => [pair.fromCurrency, pair.toCurrency])),
  ]
    .filter((currency): currency is Currency => currency !== "EUR")
    .toSorted((left, right) => left.localeCompare(right, "en"));
}

function requestUrl(
  endpoint: string,
  currencies: readonly Currency[],
  from: string,
  to: string,
): string {
  const key = `D.${currencies.join("+")}.EUR.SP00.A`;
  const url = new URL(`/service/data/EXR/${key}`, endpoint);
  url.searchParams.set("startPeriod", from);
  url.searchParams.set("endPeriod", to);
  url.searchParams.set("detail", "dataonly");
  url.searchParams.set("format", "csvdata");
  return url.toString();
}

function columnIndexes(header: readonly string[]): Map<string, number> {
  const indexes = new Map(header.map((column, index) => [column, index]));
  const missing = REQUIRED_COLUMNS.filter((column) => !indexes.has(column));
  if (missing.length > 0) {
    throw new TypeError(
      `ECB response is missing columns: ${missing.join(", ")}`,
    );
  }
  return indexes;
}

function cell(
  row: readonly string[],
  indexes: ReadonlyMap<string, number>,
  column: (typeof REQUIRED_COLUMNS)[number],
): string {
  const index = indexes.get(column);
  if (index == null) throw new TypeError(`ECB response is missing ${column}`);
  return row[index] ?? "";
}

function parseEcbCsv(raw: string): EcbCurrencyObservation[] {
  const [header, ...rows] = parseCsv(raw);
  if (header == null) throw new TypeError("ECB response has no CSV header");
  const indexes = columnIndexes(header);
  return rows.flatMap((row) => {
    if (row.every((value) => value === "")) return [];
    if (
      cell(row, indexes, "FREQ") !== "D" ||
      cell(row, indexes, "CURRENCY_DENOM") !== "EUR" ||
      cell(row, indexes, "EXR_TYPE") !== "SP00" ||
      cell(row, indexes, "EXR_SUFFIX") !== "A"
    ) {
      throw new TypeError(
        "ECB response contains an unexpected exchange-rate series",
      );
    }
    const currency = CurrencySchema.safeParse(cell(row, indexes, "CURRENCY"));
    if (!currency.success) return [];
    const date = z.iso.date().parse(cell(row, indexes, "TIME_PERIOD"));
    const unitsPerEuro = cell(row, indexes, "OBS_VALUE");
    const numericRate = Number(unitsPerEuro);
    if (!Number.isFinite(numericRate) || numericRate <= 0) {
      throw new TypeError("ECB response contains an invalid exchange rate");
    }
    return [{ currency: currency.data, date, unitsPerEuro }];
  });
}

function pairRate(
  fromCurrency: Currency,
  toCurrency: Currency,
  unitsPerEuro: ReadonlyMap<Currency, string>,
): string | null {
  const from = fromCurrency === "EUR" ? "1" : unitsPerEuro.get(fromCurrency);
  const to = toCurrency === "EUR" ? "1" : unitsPerEuro.get(toCurrency);
  if (from == null || to == null) return null;
  return triangulateExchangeRates(to, invertExchangeRate(from));
}

function normalizeRates(input: {
  observations: readonly EcbCurrencyObservation[];
  pairs: ReadonlyArray<{ fromCurrency: Currency; toCurrency: Currency }>;
  requestUrl: string;
  bodyHash: string;
}): EcbReferenceRate[] {
  const byDate = new Map<string, Map<Currency, string>>();
  for (const observation of input.observations) {
    const rates = byDate.get(observation.date) ?? new Map<Currency, string>();
    rates.set(observation.currency, observation.unitsPerEuro);
    byDate.set(observation.date, rates);
  }
  return [...byDate]
    .toSorted(([left], [right]) => left.localeCompare(right, "en"))
    .flatMap(([date, rates]) =>
      input.pairs.flatMap((pair) => {
        const rateDecimal = pairRate(pair.fromCurrency, pair.toCurrency, rates);
        if (rateDecimal == null) return [];
        const pairName = `${pair.fromCurrency}/${pair.toCurrency}`;
        return [
          {
            ...pair,
            rate: Number(rateDecimal),
            rateDecimal,
            observedDate: date,
            sourceReference: `${input.requestUrl}#date=${date}&pair=${pairName}&body=${input.bodyHash}`,
          },
        ];
      }),
    );
}

function providerError(
  error: unknown,
  requestUrl: string,
): EcbReferenceRateProviderError {
  if (error instanceof EcbReferenceRateProviderError) return error;
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return new EcbReferenceRateProviderError(
      "timeout",
      "ECB request timed out",
      {
        requestUrl,
        cause: error,
      },
    );
  }
  return new EcbReferenceRateProviderError(
    "provider_outage",
    error instanceof Error ? error.message : "ECB request failed",
    { requestUrl, cause: error },
  );
}

export async function fetchEcbReferenceRates(
  input: FetchEcbReferenceRatesInput,
): Promise<EcbReferenceRateResult> {
  const from = z.iso.date().parse(input.from);
  const to = z.iso.date().parse(input.to);
  if (from > to)
    throw new RangeError("ECB start date must not follow its end date");
  const pairs = normalizedPairs(input.pairs);
  const currencies = ecbCurrencies(pairs.supported);
  if (currencies.length === 0) {
    return {
      rates: [],
      unsupportedPairs: pairs.unsupported,
      requestUrls: [],
    };
  }
  const url = requestUrl(
    input.endpoint ?? "https://data-api.ecb.europa.eu",
    currencies,
    from,
    to,
  );
  let response: Response;
  try {
    response = await (input.fetch ?? globalThis.fetch)(url, {
      headers: { accept: "text/csv" },
      signal: input.signal ?? AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw providerError(error, url);
  }
  if (!response.ok) {
    const throttled = response.status === 429;
    throw new EcbReferenceRateProviderError(
      throttled ? "throttled" : "provider_outage",
      throttled
        ? "ECB rejected the request because its request limit was reached"
        : `ECB returned HTTP ${response.status}`,
      {
        requestUrl: url,
        retryAfter: response.headers.get("retry-after") ?? undefined,
      },
    );
  }
  let raw: string;
  let observations: EcbCurrencyObservation[];
  try {
    raw = await response.text();
    observations = parseEcbCsv(raw);
  } catch (error) {
    throw new EcbReferenceRateProviderError(
      "malformed_response",
      error instanceof Error ? error.message : "ECB returned invalid CSV",
      { requestUrl: url, cause: error },
    );
  }
  const bodyHash = await sha256Hex(raw);
  return {
    rates: normalizeRates({
      observations,
      pairs: pairs.supported,
      requestUrl: url,
      bodyHash,
    }),
    unsupportedPairs: pairs.unsupported,
    requestUrls: [url],
  };
}
