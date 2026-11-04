import { format, getISODay, parseISO, subDays } from "date-fns";
import { z } from "zod";
import {
  type CurrentExchangeRateProvider,
  CurrentExchangeRateProviderError,
  type CurrentExchangeRateRefreshResult,
  createFrankfurterCurrentRateProvider,
  type RefreshCurrentExchangeRatesInput,
  refreshCurrentExchangeRates,
} from "./currentExchangeRate";
import {
  EcbReferenceRateProviderError,
  fetchEcbReferenceRates,
} from "./ecbExchangeRateProvider";
import {
  type ExchangeRateImportFailure,
  type ExchangeRateImportGap,
  type ExchangeRateImportResult,
  type ExchangeRatePair,
  type HistoricalExchangeRateImport,
  historicalExchangeRateDates,
  historicalExchangeRateWindows,
  importHistoricalExchangeRates,
} from "./exchangeRateImport";
import {
  type ExchangeRateObservation,
  effectiveObservations,
} from "./valuation";

type Fetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type EcbHistoricalExchangeRateImport = {
  pairs: readonly ExchangeRatePair[];
  from: string;
  to: string;
  retrievedAt: string;
  existingObservations?: readonly ExchangeRateObservation[];
  endpoint?: string;
  fetch?: Fetch;
  classifyDate?: (date: string) => "trading_day" | "non_trading_day";
};

export type AutomatedHistoricalExchangeRateImport = Omit<
  HistoricalExchangeRateImport,
  "endpoint" | "fetch"
> & {
  frankfurterEndpoint?: string;
  frankfurterFetch?: Fetch;
  ecbEndpoint?: string;
  ecbFetch?: Fetch;
};

function defaultClassifyDate(date: string): "trading_day" | "non_trading_day" {
  const day = getISODay(parseISO(date));
  return day >= 6 ? "non_trading_day" : "trading_day";
}

function seriesKey(input: {
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

function acceptedEcbObservations(
  observations: readonly ExchangeRateObservation[],
): Map<string, ExchangeRateObservation> {
  return new Map(
    effectiveObservations(observations)
      .filter((observation) => observation.source.id === "ecb:reference")
      .map((observation) => [
        seriesKey({
          ...observation,
          sourceId: observation.source.id,
        }),
        observation,
      ]),
  );
}

function ecbObservation(input: {
  rate: Awaited<ReturnType<typeof fetchEcbReferenceRates>>["rates"][number];
  retrievedAt: string;
  previous?: ExchangeRateObservation;
}): ExchangeRateObservation {
  const version = input.retrievedAt.replaceAll(/\D/g, "");
  let method: "direct" | "inverse" | "triangulated" = "triangulated";
  if (input.rate.fromCurrency === "EUR") method = "direct";
  else if (input.rate.toCurrency === "EUR") method = "inverse";
  return {
    id: `fx-ecb-${input.rate.observedDate}-${input.rate.fromCurrency.toLowerCase()}-${input.rate.toCurrency.toLowerCase()}-${version}`,
    fromCurrency: input.rate.fromCurrency,
    toCurrency: input.rate.toCurrency,
    rate: input.rate.rate,
    rateDecimal: input.rate.rateDecimal,
    rateClass: "reference",
    validAt: input.rate.observedDate,
    acceptedAt: input.retrievedAt,
    retrievedAt: input.retrievedAt,
    source: {
      kind: "provider",
      id: "ecb:reference",
      label: "ECB daily reference rate",
    },
    sourceReference: input.rate.sourceReference,
    providerObservations: [
      {
        provider: "ECB",
        observedDate: input.rate.observedDate,
        rate: input.rate.rate,
        excluded: false,
        carried: false,
      },
    ],
    derivation: {
      method,
      legs:
        input.rate.fromCurrency === "EUR" || input.rate.toCurrency === "EUR"
          ? [input.rate.sourceReference]
          : [
              `${input.rate.sourceReference}:from-eur`,
              `${input.rate.sourceReference}:to-eur`,
            ],
    },
    ...(input.previous == null ? {} : { correctsId: input.previous.id }),
  };
}

function failureFromEcb(
  error: EcbReferenceRateProviderError,
): ExchangeRateImportFailure {
  let kind: ExchangeRateImportFailure["kind"] = "provider_outage";
  if (error.kind === "throttled") kind = "quota_exceeded";
  else if (error.kind === "malformed_response") kind = "invalid_response";
  return {
    requestUrl: error.requestUrl,
    kind,
    retryAfter: error.retryAfter,
    message: error.message,
  };
}

function missingEcbRates(input: {
  pairs: readonly ExchangeRatePair[];
  dates: readonly string[];
  returned: ReadonlySet<string>;
  classifyDate: (date: string) => "trading_day" | "non_trading_day";
}): ExchangeRateImportGap[] {
  return input.dates.flatMap((date) =>
    input.pairs.flatMap((pair) => {
      if (
        input.returned.has(`${pair.fromCurrency}\0${pair.toCurrency}\0${date}`)
      ) {
        return [];
      }
      return [
        {
          ...pair,
          date,
          reason:
            input.classifyDate(date) === "non_trading_day"
              ? ("non_trading_day" as const)
              : ("missing_provider_observation" as const),
        },
      ];
    }),
  );
}

function acceptEcbWindow(input: {
  result: Awaited<ReturnType<typeof fetchEcbReferenceRates>>;
  pairs: readonly ExchangeRatePair[];
  from: string;
  to: string;
  retrievedAt: string;
  classifyDate: (date: string) => "trading_day" | "non_trading_day";
  accepted: Map<string, ExchangeRateObservation>;
  unsupportedPairs: Map<string, ExchangeRatePair>;
  observations: ExchangeRateObservation[];
  gaps: ExchangeRateImportGap[];
}): void {
  for (const pair of input.result.unsupportedPairs) {
    input.unsupportedPairs.set(`${pair.fromCurrency}/${pair.toCurrency}`, pair);
  }
  const returned = new Set<string>();
  for (const rate of input.result.rates) {
    returned.add(
      `${rate.fromCurrency}\0${rate.toCurrency}\0${rate.observedDate}`,
    );
    const key = seriesKey({
      ...rate,
      validAt: rate.observedDate,
      sourceId: "ecb:reference",
    });
    const previous = input.accepted.get(key);
    if (
      previous?.rateDecimal === rate.rateDecimal ||
      previous?.rate === rate.rate
    ) {
      continue;
    }
    const observation = ecbObservation({
      rate,
      retrievedAt: input.retrievedAt,
      previous,
    });
    input.observations.push(observation);
    input.accepted.set(key, observation);
  }
  input.gaps.push(
    ...missingEcbRates({
      pairs: input.pairs.filter(
        (pair) =>
          !input.unsupportedPairs.has(
            `${pair.fromCurrency}/${pair.toCurrency}`,
          ),
      ),
      dates: historicalExchangeRateDates(input.from, input.to),
      returned,
      classifyDate: input.classifyDate,
    }),
  );
}

export async function importEcbHistoricalExchangeRates(
  input: EcbHistoricalExchangeRateImport,
): Promise<ExchangeRateImportResult> {
  const retrievedAt = z.iso.datetime({ offset: true }).parse(input.retrievedAt);
  const accepted = acceptedEcbObservations(input.existingObservations ?? []);
  const observations: ExchangeRateObservation[] = [];
  const gaps: ExchangeRateImportGap[] = [];
  const failures: ExchangeRateImportFailure[] = [];
  const unsupportedPairs = new Map<string, ExchangeRatePair>();
  const requestUrls: string[] = [];
  const classifyDate = input.classifyDate ?? defaultClassifyDate;

  for (const window of historicalExchangeRateWindows(input.from, input.to)) {
    try {
      // NOSONAR: historical windows stay sequential to respect provider quotas.
      const result = await fetchEcbReferenceRates({
        pairs: input.pairs,
        from: window.from,
        to: window.to,
        endpoint: input.endpoint,
        fetch: input.fetch,
      });
      requestUrls.push(...result.requestUrls);
      acceptEcbWindow({
        result,
        pairs: input.pairs,
        from: window.from,
        to: window.to,
        retrievedAt,
        classifyDate,
        accepted,
        unsupportedPairs,
        observations,
        gaps,
      });
    } catch (error) {
      if (!(error instanceof EcbReferenceRateProviderError)) throw error;
      requestUrls.push(error.requestUrl);
      failures.push(failureFromEcb(error));
    }
  }

  return {
    observations,
    gaps,
    unsupportedPairs: [...unsupportedPairs.values()],
    failures,
    requestUrls,
  };
}

function gapKey(input: {
  fromCurrency: string;
  toCurrency: string;
  date: string;
}): string {
  return `${input.fromCurrency}\0${input.toCurrency}\0${input.date}`;
}

function pairKey(input: ExchangeRatePair): string {
  return `${input.fromCurrency}\0${input.toCurrency}`;
}

function uniquePairs(pairs: readonly ExchangeRatePair[]): ExchangeRatePair[] {
  return [...new Map(pairs.map((pair) => [pairKey(pair), pair])).values()];
}

function frankfurterCoverageKeys(input: {
  observations: readonly ExchangeRateObservation[];
  pairs: readonly ExchangeRatePair[];
  from: string;
  to: string;
}): Set<string> {
  const pairs = new Set(input.pairs.map(pairKey));
  return new Set(
    effectiveObservations(input.observations)
      .filter(
        (observation) =>
          observation.source.id === "frankfurter:blend" &&
          pairs.has(pairKey(observation)) &&
          observation.validAt >= input.from &&
          observation.validAt <= input.to,
      )
      .map((observation) =>
        gapKey({ ...observation, date: observation.validAt }),
      ),
  );
}

export async function importAutomatedHistoricalExchangeRates(
  input: AutomatedHistoricalExchangeRateImport,
): Promise<ExchangeRateImportResult> {
  const {
    frankfurterEndpoint,
    frankfurterFetch,
    ecbEndpoint,
    ecbFetch,
    ...historicalInput
  } = input;
  const primary = await importHistoricalExchangeRates({
    ...historicalInput,
    endpoint: frankfurterEndpoint,
    fetch: frankfurterFetch,
  });
  const missingKeys = new Set(
    primary.gaps
      .filter((gap) => gap.reason === "missing_provider_observation")
      .map(gapKey),
  );
  const unsupported = new Set(primary.unsupportedPairs.map(pairKey));
  const fallbackPairs = uniquePairs(
    primary.failures.length > 0
      ? input.pairs.filter((pair) => !unsupported.has(pairKey(pair)))
      : primary.gaps
          .filter((gap) => gap.reason === "missing_provider_observation")
          .map(({ fromCurrency, toCurrency }) => ({
            fromCurrency,
            toCurrency,
          })),
  );
  if (fallbackPairs.length === 0) return primary;

  const fallback = await importEcbHistoricalExchangeRates({
    pairs: fallbackPairs,
    from: input.from,
    to: input.to,
    retrievedAt: input.retrievedAt,
    existingObservations: [
      ...(input.existingObservations ?? []),
      ...primary.observations,
    ],
    endpoint: ecbEndpoint,
    fetch: ecbFetch,
    classifyDate: input.classifyDate,
  });
  const useEveryFallbackRate = primary.failures.length > 0;
  const primaryCoverage = frankfurterCoverageKeys({
    observations: [
      ...(input.existingObservations ?? []),
      ...primary.observations,
    ],
    pairs: input.pairs,
    from: input.from,
    to: input.to,
  });
  const fallbackObservations = fallback.observations.filter((observation) => {
    const key = gapKey({
      ...observation,
      date: observation.validAt,
    });
    return (
      !primaryCoverage.has(key) &&
      (useEveryFallbackRate || missingKeys.has(key))
    );
  });
  const filled = new Set(
    fallbackObservations.map((observation) =>
      gapKey({ ...observation, date: observation.validAt }),
    ),
  );
  return {
    observations: [...primary.observations, ...fallbackObservations],
    gaps: [
      ...primary.gaps.filter((gap) => !filled.has(gapKey(gap))),
      ...fallback.gaps.filter(
        (gap) =>
          !filled.has(gapKey(gap)) &&
          !primaryCoverage.has(gapKey(gap)) &&
          !primary.gaps.some(
            (primaryGap) => gapKey(primaryGap) === gapKey(gap),
          ),
      ),
    ],
    unsupportedPairs: uniquePairs([
      ...primary.unsupportedPairs,
      ...fallback.unsupportedPairs,
    ]),
    failures: [...primary.failures, ...fallback.failures],
    requestUrls: [...primary.requestUrls, ...fallback.requestUrls],
  };
}

export function createEcbCurrentRateProvider(options?: {
  endpoint?: string;
  fetch?: Fetch;
  lookbackDays?: number;
}): CurrentExchangeRateProvider {
  return {
    id: "ecb:reference",
    label: "ECB daily reference rate",
    async fetchQuotes({ pairs, retrievedAt, signal }) {
      const to = retrievedAt.slice(0, 10);
      const from = format(
        subDays(parseISO(to), options?.lookbackDays ?? 10),
        "yyyy-MM-dd",
      );
      try {
        const result = await fetchEcbReferenceRates({
          pairs,
          from,
          to,
          endpoint: options?.endpoint,
          fetch: options?.fetch,
          signal,
        });
        const latest = new Map<string, (typeof result.rates)[number]>();
        for (const rate of result.rates) latest.set(pairKey(rate), rate);
        return [...latest.values()].map((rate) => ({
          fromCurrency: rate.fromCurrency,
          toCurrency: rate.toCurrency,
          rate: rate.rate,
          quoteTime: `${rate.observedDate}T00:00:00Z`,
          rateClass: "reference" as const,
          sourceReference: rate.sourceReference,
        }));
      } catch (error) {
        if (!(error instanceof EcbReferenceRateProviderError)) throw error;
        throw new CurrentExchangeRateProviderError(error.kind, error.message, {
          retryAfter: error.retryAfter,
          cause: error,
        });
      }
    },
  };
}

export async function refreshAutomatedReferenceRates(
  input: Omit<RefreshCurrentExchangeRatesInput, "providers" | "rateClass"> & {
    frankfurter?: NonNullable<
      Parameters<typeof createFrankfurterCurrentRateProvider>[0]
    >;
    ecb?: NonNullable<Parameters<typeof createEcbCurrentRateProvider>[0]>;
  },
): Promise<CurrentExchangeRateRefreshResult> {
  const { frankfurter, ecb, ...refreshInput } = input;
  return refreshCurrentExchangeRates({
    ...refreshInput,
    providers: [
      createFrankfurterCurrentRateProvider(frankfurter),
      createEcbCurrentRateProvider(ecb),
    ],
    rateClass: "reference",
  });
}
