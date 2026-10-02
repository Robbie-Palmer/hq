import {
  addDays,
  addYears,
  eachDayOfInterval,
  format,
  getISODay,
  parseISO,
  subDays,
} from "date-fns";
import { z } from "zod";
import {
  type Currency,
  CurrencySchema,
  SUPPORTED_CURRENCIES,
} from "./currency";
import {
  type ExchangeRateObservation,
  effectiveObservations,
} from "./valuation";

const FrankfurterProviderRateSchema = z.object({
  key: z.string().min(1),
  date: z.iso.date(),
  rate: z.number().positive(),
  excluded: z.boolean().optional(),
});

const FrankfurterRateSchema = z.object({
  date: z.iso.date(),
  base: z.string().min(3),
  quote: z.string().min(3),
  rate: z.number().positive(),
  providers: z.array(FrankfurterProviderRateSchema).optional(),
});

const FrankfurterRatesSchema = z.array(FrankfurterRateSchema);

type Fetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type ExchangeRatePair = {
  fromCurrency: string;
  toCurrency: string;
};

export type ExchangeRateImportGap = {
  fromCurrency: string;
  toCurrency: string;
  date: string;
  reason: "non_trading_day" | "missing_provider_observation";
};

export type ExchangeRateImportFailure = {
  requestUrl: string;
  kind:
    | "invalid_response"
    | "partial_response"
    | "provider_outage"
    | "quota_exceeded";
  status?: number;
  retryAfter?: string;
  message: string;
};

export type ExchangeRateImportResult = {
  observations: ExchangeRateObservation[];
  gaps: ExchangeRateImportGap[];
  unsupportedPairs: ExchangeRatePair[];
  failures: ExchangeRateImportFailure[];
  requestUrls: string[];
};

type CalendarDay = "trading_day" | "non_trading_day";

export type HistoricalExchangeRateImport = {
  pairs: readonly ExchangeRatePair[];
  from: string;
  to: string;
  retrievedAt: string;
  existingObservations?: readonly ExchangeRateObservation[];
  endpoint?: string;
  fetch?: Fetch;
  maxRetries?: number;
  retryDelay?: (milliseconds: number) => Promise<void>;
  classifyDate?: (date: string) => CalendarDay;
};

type Fraction = { numerator: bigint; denominator: bigint };

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  let a = left < BigInt(0) ? -left : left;
  let b = right < BigInt(0) ? -right : right;
  while (b !== BigInt(0)) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a;
}

function reduce(fraction: Fraction): Fraction {
  const divisor = greatestCommonDivisor(
    fraction.numerator,
    fraction.denominator,
  );
  return {
    numerator: fraction.numerator / divisor,
    denominator: fraction.denominator / divisor,
  };
}

function decimalFraction(value: string): Fraction {
  if (!/^\d+(?:\.\d+)?$/.test(value)) {
    throw new TypeError(`Invalid positive decimal rate "${value}"`);
  }
  const [whole = "0", decimals = ""] = value.split(".");
  const denominator = BigInt(10) ** BigInt(decimals.length);
  const numerator = BigInt(`${whole}${decimals}`);
  if (numerator <= BigInt(0)) {
    throw new TypeError("Exchange rates must be positive");
  }
  return reduce({ numerator, denominator });
}

function fractionDecimal(fraction: Fraction, scale = 18): string {
  if (fraction.numerator <= BigInt(0) || fraction.denominator <= BigInt(0)) {
    throw new TypeError("Exchange rates must be positive");
  }
  const factor = BigInt(10) ** BigInt(scale);
  const scaledNumerator = fraction.numerator * factor;
  const rounded =
    (scaledNumerator + fraction.denominator / BigInt(2)) / fraction.denominator;
  const digits = rounded.toString().padStart(scale + 1, "0");
  const whole = digits.slice(0, -scale);
  const decimals = digits.slice(-scale).replace(/0+$/, "");
  return decimals.length === 0 ? whole : `${whole}.${decimals}`;
}

export function invertExchangeRate(rate: string): string {
  const fraction = decimalFraction(rate);
  return fractionDecimal({
    numerator: fraction.denominator,
    denominator: fraction.numerator,
  });
}

export function triangulateExchangeRates(
  firstRate: string,
  secondRate: string,
): string {
  const first = decimalFraction(firstRate);
  const second = decimalFraction(secondRate);
  return fractionDecimal(
    reduce({
      numerator: first.numerator * second.numerator,
      denominator: first.denominator * second.denominator,
    }),
  );
}

function observationDecimal(observation: ExchangeRateObservation): string {
  return observation.rateDecimal ?? observation.rate.toString();
}

function orientedRate(
  observation: ExchangeRateObservation,
  fromCurrency: Currency,
  toCurrency: Currency,
): { rate: string; inverted: boolean } | null {
  if (
    observation.fromCurrency === fromCurrency &&
    observation.toCurrency === toCurrency
  ) {
    return { rate: observationDecimal(observation), inverted: false };
  }
  if (
    observation.fromCurrency === toCurrency &&
    observation.toCurrency === fromCurrency
  ) {
    return {
      rate: invertExchangeRate(observationDecimal(observation)),
      inverted: true,
    };
  }
  return null;
}

function singleLegRate(input: {
  leg: ExchangeRateObservation;
  fromCurrency: Currency;
  toCurrency: Currency;
}): { rateDecimal: string; method: "direct" | "inverse" } {
  const oriented = orientedRate(
    input.leg,
    input.fromCurrency,
    input.toCurrency,
  );
  if (oriented == null) {
    throw new TypeError(
      "Exchange-rate source leg does not cover the target pair",
    );
  }
  return {
    rateDecimal: oriented.rate,
    method: oriented.inverted ? "inverse" : "direct",
  };
}

function twoLegRate(input: {
  first: ExchangeRateObservation;
  second: ExchangeRateObservation;
  fromCurrency: Currency;
  toCurrency: Currency;
}): string {
  for (const intermediate of SUPPORTED_CURRENCIES) {
    if (
      intermediate === input.fromCurrency ||
      intermediate === input.toCurrency
    ) {
      continue;
    }
    const ordered = [
      orientedRate(input.first, input.fromCurrency, intermediate),
      orientedRate(input.second, intermediate, input.toCurrency),
    ] as const;
    const reversed = [
      orientedRate(input.second, input.fromCurrency, intermediate),
      orientedRate(input.first, intermediate, input.toCurrency),
    ] as const;
    const legs = ordered.every((leg) => leg != null) ? ordered : reversed;
    const [firstRate, secondRate] = legs;
    if (firstRate != null && secondRate != null) {
      return triangulateExchangeRates(firstRate.rate, secondRate.rate);
    }
  }
  throw new TypeError("Exchange-rate source legs do not form the target pair");
}

export function deriveExchangeRateObservation(input: {
  id: string;
  fromCurrency: Currency;
  toCurrency: Currency;
  legs: readonly ExchangeRateObservation[];
}): ExchangeRateObservation {
  if (input.fromCurrency === input.toCurrency) {
    throw new TypeError("Derived exchange-rate currencies must differ");
  }
  if (input.legs.length < 1 || input.legs.length > 2) {
    throw new TypeError("A derived exchange rate needs one or two source legs");
  }
  const dates = new Set(input.legs.map((leg) => leg.validAt));
  if (dates.size !== 1) {
    throw new TypeError(
      "Triangulated exchange-rate legs must share an observation date",
    );
  }

  const first = input.legs[0];
  if (first == null) throw new TypeError("Missing exchange-rate source leg");
  const derived =
    input.legs.length === 1
      ? singleLegRate({
          leg: first,
          fromCurrency: input.fromCurrency,
          toCurrency: input.toCurrency,
        })
      : {
          rateDecimal: twoLegRate({
            first,
            second: input.legs[1] as ExchangeRateObservation,
            fromCurrency: input.fromCurrency,
            toCurrency: input.toCurrency,
          }),
          method: "triangulated" as const,
        };

  const acceptedAt = input.legs
    .map((leg) => leg.acceptedAt)
    .toSorted()
    .at(-1);
  const validAt = input.legs[0]?.validAt;
  if (acceptedAt == null || validAt == null) {
    throw new TypeError("Missing exchange-rate source timestamps");
  }
  return {
    id: input.id,
    fromCurrency: input.fromCurrency,
    toCurrency: input.toCurrency,
    rate: Number(derived.rateDecimal),
    rateDecimal: derived.rateDecimal,
    rateClass: "reference",
    validAt,
    acceptedAt,
    retrievedAt: acceptedAt,
    source: {
      kind: "reference",
      id: "derived-reference-rate",
      label: "Derived reference exchange rate",
    },
    sourceReference: `derived:${input.legs.map((leg) => leg.id).join(",")}`,
    derivation: {
      method: derived.method,
      legs: input.legs.map((leg) => leg.id),
    },
  };
}

function defaultClassifyDate(date: string): CalendarDay {
  const day = getISODay(parseISO(date));
  return day >= 6 ? "non_trading_day" : "trading_day";
}

function stableHash(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function acceptedObservationBySeries(
  observations: readonly ExchangeRateObservation[],
): Map<string, ExchangeRateObservation> {
  return new Map(
    effectiveObservations(observations).map((observation) => [
      [
        observation.fromCurrency,
        observation.toCurrency,
        observation.validAt,
        observation.source.id,
      ].join("\0"),
      observation,
    ]),
  );
}

function observationKey(input: {
  fromCurrency: string;
  toCurrency: string;
  validAt: string;
  sourceId: string;
}): string {
  return [
    input.fromCurrency,
    input.toCurrency,
    input.validAt,
    input.sourceId,
  ].join("\0");
}

function requestUrl(
  endpoint: string,
  base: Currency,
  quotes: readonly Currency[],
  from: string,
  to: string,
): string {
  const url = new URL("/v2/rates", endpoint);
  url.searchParams.set("base", base);
  url.searchParams.set("quotes", quotes.join(","));
  url.searchParams.set("from", from);
  url.searchParams.set("to", to);
  url.searchParams.set("expand", "providers");
  return url.toString();
}

function retryMilliseconds(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  const seconds = retryAfter == null ? Number.NaN : Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  return 250 * 2 ** attempt;
}

async function fetchWithRetry(input: {
  fetch: Fetch;
  url: string;
  maxRetries: number;
  retryDelay: (milliseconds: number) => Promise<void>;
}): Promise<Response> {
  let attempt = 0;
  while (true) {
    const response = await input.fetch(input.url, {
      headers: { accept: "application/json" },
    });
    const canRetry = response.status === 429 || response.status === 503;
    if (!canRetry || attempt >= input.maxRetries) return response;
    await input.retryDelay(retryMilliseconds(response, attempt));
    attempt += 1;
  }
}

function normalizePairs(pairs: readonly ExchangeRatePair[]): {
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

function groupPairsByBase(
  pairs: ReadonlyArray<{ fromCurrency: Currency; toCurrency: Currency }>,
): Map<Currency, Currency[]> {
  const grouped = new Map<Currency, Set<Currency>>();
  for (const pair of pairs) {
    const quotes = grouped.get(pair.fromCurrency) ?? new Set<Currency>();
    quotes.add(pair.toCurrency);
    grouped.set(pair.fromCurrency, quotes);
  }
  return new Map(
    [...grouped].map(([base, quotes]) => [base, [...quotes].toSorted()]),
  );
}

function failureForResponse(
  url: string,
  response: Response,
): ExchangeRateImportFailure {
  const quotaExceeded = response.status === 429;
  return {
    requestUrl: url,
    kind: quotaExceeded ? "quota_exceeded" : "provider_outage",
    status: response.status,
    retryAfter: response.headers.get("retry-after") ?? undefined,
    message: quotaExceeded
      ? "Frankfurter rejected the request because its request limit was reached"
      : `Frankfurter returned HTTP ${response.status}`,
  };
}

function datesBetween(from: string, to: string): string[] {
  const start = parseISO(z.iso.date().parse(from));
  const end = parseISO(z.iso.date().parse(to));
  if (start > end) {
    throw new RangeError("FX import start date must not follow its end date");
  }
  return eachDayOfInterval({ start, end }).map((date) =>
    format(date, "yyyy-MM-dd"),
  );
}

function requestWindows(
  from: string,
  to: string,
): Array<{
  from: string;
  to: string;
}> {
  const finalDate = parseISO(z.iso.date().parse(to));
  let start = parseISO(z.iso.date().parse(from));
  if (start > finalDate) {
    throw new RangeError("FX import start date must not follow its end date");
  }
  const windows: Array<{ from: string; to: string }> = [];
  while (start <= finalDate) {
    const maximumEnd = subDays(addYears(start, 5), 1);
    const end = maximumEnd < finalDate ? maximumEnd : finalDate;
    windows.push({
      from: format(start, "yyyy-MM-dd"),
      to: format(end, "yyyy-MM-dd"),
    });
    start = addDays(end, 1);
  }
  return windows;
}

type FetchedRates =
  | {
      ok: true;
      raw: string;
      rows: z.infer<typeof FrankfurterRatesSchema>;
      status: number;
    }
  | { ok: false; failure: ExchangeRateImportFailure };

async function fetchRates(input: {
  fetcher: Fetch;
  url: string;
  maxRetries: number;
  retryDelay: (milliseconds: number) => Promise<void>;
}): Promise<FetchedRates> {
  let response: Response;
  try {
    response = await fetchWithRetry({
      fetch: input.fetcher,
      url: input.url,
      maxRetries: input.maxRetries,
      retryDelay: input.retryDelay,
    });
  } catch (error) {
    return {
      ok: false,
      failure: {
        requestUrl: input.url,
        kind: "provider_outage",
        message:
          error instanceof Error ? error.message : "Frankfurter request failed",
      },
    };
  }
  if (!response.ok) {
    return { ok: false, failure: failureForResponse(input.url, response) };
  }
  try {
    const raw = await response.text();
    return {
      ok: true,
      raw,
      rows: FrankfurterRatesSchema.parse(JSON.parse(raw)),
      status: response.status,
    };
  } catch (error) {
    return {
      ok: false,
      failure: {
        requestUrl: input.url,
        kind: "invalid_response",
        status: response.status,
        message:
          error instanceof Error
            ? error.message
            : "Frankfurter returned invalid JSON",
      },
    };
  }
}

function observationFromRow(input: {
  row: z.infer<typeof FrankfurterRateSchema>;
  rowIndex: number;
  fromCurrency: Currency;
  toCurrency: Currency;
  url: string;
  raw: string;
  retrievedAt: string;
  previous?: ExchangeRateObservation;
}): ExchangeRateObservation {
  const rateDecimal = input.row.rate.toString();
  const sourceReference = `${input.url}#row=${input.rowIndex}&body=${stableHash(input.raw)}`;
  return {
    id: `fx-frankfurter-${input.row.date}-${input.fromCurrency.toLowerCase()}-${input.toCurrency.toLowerCase()}-${stableHash(`${rateDecimal}\0${input.retrievedAt}`)}`,
    fromCurrency: input.fromCurrency,
    toCurrency: input.toCurrency,
    rate: input.row.rate,
    rateDecimal,
    rateClass: "reference",
    validAt: input.row.date,
    acceptedAt: input.retrievedAt,
    retrievedAt: input.retrievedAt,
    source: {
      kind: "provider",
      id: "frankfurter:blend",
      label: "Frankfurter blended reference rate",
    },
    sourceReference,
    providerObservations: input.row.providers?.map((provider) => ({
      provider: provider.key,
      observedDate: provider.date,
      rate: provider.rate,
      excluded: provider.excluded ?? false,
      carried: provider.date !== input.row.date,
    })),
    derivation: { method: "direct", legs: [sourceReference] },
    ...(input.previous == null ? {} : { correctsId: input.previous.id }),
  };
}

function normalizeRows(input: {
  rows: z.infer<typeof FrankfurterRatesSchema>;
  base: Currency;
  quotes: readonly Currency[];
  url: string;
  raw: string;
  retrievedAt: string;
  accepted: Map<string, ExchangeRateObservation>;
}): { observations: ExchangeRateObservation[]; returned: Set<string> } {
  const observations: ExchangeRateObservation[] = [];
  const returned = new Set<string>();
  const requestedQuotes = new Set(input.quotes);
  for (const [rowIndex, row] of input.rows.entries()) {
    const from = CurrencySchema.safeParse(row.base);
    const to = CurrencySchema.safeParse(row.quote);
    if (!from.success || !to.success) continue;
    if (from.data !== input.base || !requestedQuotes.has(to.data)) continue;
    if (from.data === to.data) continue;
    returned.add(`${row.date}\0${row.quote}`);
    const key = observationKey({
      fromCurrency: from.data,
      toCurrency: to.data,
      validAt: row.date,
      sourceId: "frankfurter:blend",
    });
    const previous = input.accepted.get(key);
    const rateDecimal = row.rate.toString();
    if (previous?.rateDecimal === rateDecimal || previous?.rate === row.rate) {
      continue;
    }
    const observation = observationFromRow({
      row,
      rowIndex,
      fromCurrency: from.data,
      toCurrency: to.data,
      url: input.url,
      raw: input.raw,
      retrievedAt: input.retrievedAt,
      previous,
    });
    observations.push(observation);
    input.accepted.set(key, observation);
  }
  return { observations, returned };
}

function missingRates(input: {
  dates: readonly string[];
  base: Currency;
  quotes: readonly Currency[];
  returned: ReadonlySet<string>;
  classifyDate: (date: string) => CalendarDay;
}): ExchangeRateImportGap[] {
  const gaps: ExchangeRateImportGap[] = [];
  for (const date of input.dates) {
    for (const quote of input.quotes) {
      if (input.returned.has(`${date}\0${quote}`)) continue;
      gaps.push({
        fromCurrency: input.base,
        toCurrency: quote,
        date,
        reason:
          input.classifyDate(date) === "non_trading_day"
            ? "non_trading_day"
            : "missing_provider_observation",
      });
    }
  }
  return gaps;
}

export async function importHistoricalExchangeRates(
  input: HistoricalExchangeRateImport,
): Promise<ExchangeRateImportResult> {
  const windows = requestWindows(input.from, input.to);
  const retrievedAt = z.iso.datetime({ offset: true }).parse(input.retrievedAt);
  const pairs = normalizePairs(input.pairs);
  const grouped = groupPairsByBase(pairs.supported);
  const fetcher = input.fetch ?? globalThis.fetch;
  const endpoint = input.endpoint ?? "https://api.frankfurter.dev";
  const maxRetries = input.maxRetries ?? 2;
  const retryDelay =
    input.retryDelay ??
    ((milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const classifyDate = input.classifyDate ?? defaultClassifyDate;
  const accepted = acceptedObservationBySeries(
    input.existingObservations ?? [],
  );
  const observations: ExchangeRateObservation[] = [];
  const gaps: ExchangeRateImportGap[] = [];
  const failures: ExchangeRateImportFailure[] = [];
  const requestUrls: string[] = [];

  for (const [base, quotes] of grouped) {
    for (const window of windows) {
      const url = requestUrl(endpoint, base, quotes, window.from, window.to);
      requestUrls.push(url);
      const fetched = await fetchRates({
        fetcher,
        url,
        maxRetries,
        retryDelay,
      });
      if (!fetched.ok) {
        failures.push(fetched.failure);
        continue;
      }
      const normalized = normalizeRows({
        rows: fetched.rows,
        base,
        quotes,
        url,
        raw: fetched.raw,
        retrievedAt,
        accepted,
      });
      observations.push(...normalized.observations);
      const requestGaps = missingRates({
        dates: datesBetween(window.from, window.to),
        base,
        quotes,
        returned: normalized.returned,
        classifyDate,
      });
      gaps.push(...requestGaps);
      if (
        requestGaps.some((gap) => gap.reason === "missing_provider_observation")
      ) {
        failures.push({
          requestUrl: url,
          kind: "partial_response",
          status: fetched.status,
          message: "Frankfurter did not return every requested pair and date",
        });
      }
    }
  }

  return {
    observations,
    gaps,
    unsupportedPairs: pairs.unsupported,
    failures,
    requestUrls,
  };
}

export function nextIncrementalExchangeRateDate(
  observations: readonly ExchangeRateObservation[],
  pair: ExchangeRatePair,
  fallbackFrom: string,
): string {
  const latest = effectiveObservations(observations)
    .filter(
      (observation) =>
        observation.fromCurrency === pair.fromCurrency &&
        observation.toCurrency === pair.toCurrency &&
        observation.source.id === "frankfurter:blend",
    )
    .toSorted((left, right) => right.validAt.localeCompare(left.validAt))[0];
  return latest == null
    ? z.iso.date().parse(fallbackFrom)
    : format(addDays(parseISO(latest.validAt), 1), "yyyy-MM-dd");
}
