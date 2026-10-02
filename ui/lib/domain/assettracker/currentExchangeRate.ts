import { differenceInMilliseconds, parseISO } from "date-fns";
import { z } from "zod";
import { CurrencySchema } from "./currency";
import {
  type ExchangeRatePair,
  importHistoricalExchangeRates,
} from "./exchangeRateImport";
import {
  type ExchangeRateObservation,
  effectiveObservations,
} from "./valuation";

const MoneyAmountSchema = z.object({
  amount: z.number().nonnegative(),
  currency: CurrencySchema,
});

export const CurrentExchangeRateProviderQuoteSchema = z
  .object({
    fromCurrency: CurrencySchema,
    toCurrency: CurrencySchema,
    rate: z.number().positive(),
    quoteTime: z.iso.datetime({ offset: true }),
    rateClass: z.enum(["reference", "executable"]),
    sourceReference: z.string().min(1).optional(),
    bid: z.number().positive().optional(),
    ask: z.number().positive().optional(),
    spread: z.number().nonnegative().optional(),
    providerFee: MoneyAmountSchema.optional(),
    deliveredAmount: MoneyAmountSchema.optional(),
  })
  .refine((quote) => quote.fromCurrency !== quote.toCurrency, {
    message: "Current exchange-rate currencies must differ",
  });

export type CurrentExchangeRateProviderQuote = z.infer<
  typeof CurrentExchangeRateProviderQuoteSchema
>;

export type CurrentExchangeRateFailureKind =
  | "throttled"
  | "malformed_response"
  | "timeout"
  | "provider_outage"
  | "partial_response";

export class CurrentExchangeRateProviderError extends Error {
  readonly kind: Exclude<CurrentExchangeRateFailureKind, "partial_response">;
  readonly retryAfter?: string;

  constructor(
    kind: Exclude<CurrentExchangeRateFailureKind, "partial_response">,
    message: string,
    options?: { retryAfter?: string; cause?: unknown },
  ) {
    super(message, { cause: options?.cause });
    this.name = "CurrentExchangeRateProviderError";
    this.kind = kind;
    this.retryAfter = options?.retryAfter;
  }
}

export type CurrentExchangeRateProvider = {
  id: string;
  label: string;
  fetchQuotes: (input: {
    pairs: readonly ExchangeRatePair[];
    retrievedAt: string;
    signal: AbortSignal;
  }) => Promise<unknown>;
};

export type CurrentExchangeRateFailure = {
  providerId: string;
  kind: CurrentExchangeRateFailureKind;
  message: string;
  retryAfter?: string;
  pairs: ExchangeRatePair[];
};

export type CurrentExchangeRateValue = {
  observation: ExchangeRateObservation;
  freshness: "fresh" | "cached" | "stale";
  fallback: boolean;
};

export type CurrentExchangeRateRefreshResult = {
  values: CurrentExchangeRateValue[];
  observations: ExchangeRateObservation[];
  failures: CurrentExchangeRateFailure[];
};

export type RefreshCurrentExchangeRatesInput = {
  pairs: readonly ExchangeRatePair[];
  providers: readonly CurrentExchangeRateProvider[];
  existingObservations?: readonly ExchangeRateObservation[];
  retrievedAt: string;
  cacheForMs?: number;
  staleAfterMs?: number;
  timeoutMs?: number;
  force?: boolean;
};

const DEFAULT_CACHE_MS = 60 * 60 * 1_000;
const DEFAULT_STALE_MS = 36 * 60 * 60 * 1_000;
const DEFAULT_TIMEOUT_MS = 10_000;

function pairKey(pair: ExchangeRatePair): string {
  return `${pair.fromCurrency}\0${pair.toCurrency}`;
}

function normalizePairs(
  pairs: readonly ExchangeRatePair[],
): ExchangeRatePair[] {
  const normalized = new Map<string, ExchangeRatePair>();
  for (const pair of pairs) {
    const fromCurrency = CurrencySchema.parse(pair.fromCurrency);
    const toCurrency = CurrencySchema.parse(pair.toCurrency);
    if (fromCurrency === toCurrency) {
      throw new TypeError("Current exchange-rate currencies must differ");
    }
    const normalizedPair = { fromCurrency, toCurrency };
    normalized.set(pairKey(normalizedPair), normalizedPair);
  }
  return [...normalized.values()];
}

function elapsedMilliseconds(earlier: string, later: string): number {
  return differenceInMilliseconds(parseISO(later), parseISO(earlier));
}

function latestByPair(
  observations: readonly ExchangeRateObservation[],
): Map<string, ExchangeRateObservation> {
  const latest = new Map<string, ExchangeRateObservation>();
  for (const observation of effectiveObservations(observations).toSorted(
    (left, right) =>
      left.acceptedAt.localeCompare(right.acceptedAt) ||
      left.id.localeCompare(right.id),
  )) {
    latest.set(pairKey(observation), observation);
  }
  return latest;
}

function quoteTime(observation: ExchangeRateObservation): string {
  return observation.quotedAt ?? `${observation.validAt}T00:00:00Z`;
}

function isUsableCache(
  observation: ExchangeRateObservation,
  retrievedAt: string,
  cacheForMs: number,
  staleAfterMs: number,
): boolean {
  const retrieved = observation.retrievedAt ?? observation.acceptedAt;
  const cacheAge = elapsedMilliseconds(retrieved, retrievedAt);
  const quoteAge = elapsedMilliseconds(quoteTime(observation), retrievedAt);
  return (
    cacheAge >= 0 &&
    cacheAge <= cacheForMs &&
    quoteAge >= 0 &&
    quoteAge <= staleAfterMs
  );
}

function failureFromError(
  provider: CurrentExchangeRateProvider,
  pairs: ExchangeRatePair[],
  error: unknown,
): CurrentExchangeRateFailure {
  if (error instanceof CurrentExchangeRateProviderError) {
    return {
      providerId: provider.id,
      kind: error.kind,
      message: error.message,
      retryAfter: error.retryAfter,
      pairs,
    };
  }
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return {
      providerId: provider.id,
      kind: "timeout",
      message: `${provider.label} timed out`,
      pairs,
    };
  }
  return {
    providerId: provider.id,
    kind: "provider_outage",
    message:
      error instanceof Error ? error.message : `${provider.label} failed`,
    pairs,
  };
}

function observationFromQuote(input: {
  provider: CurrentExchangeRateProvider;
  quote: CurrentExchangeRateProviderQuote;
  retrievedAt: string;
  sequence: number;
}): ExchangeRateObservation {
  const quote = input.quote;
  const idTime = input.retrievedAt.replaceAll(/[^0-9]/g, "");
  return {
    id: `fx-current-${input.provider.id}-${quote.fromCurrency.toLowerCase()}-${quote.toCurrency.toLowerCase()}-${idTime}-${input.sequence}`,
    fromCurrency: quote.fromCurrency,
    toCurrency: quote.toCurrency,
    rate: quote.rate,
    rateDecimal: quote.rate.toString(),
    rateClass: quote.rateClass,
    validAt: quote.quoteTime.slice(0, 10),
    quotedAt: quote.quoteTime,
    acceptedAt: input.retrievedAt,
    retrievedAt: input.retrievedAt,
    source: {
      kind: "provider",
      id: input.provider.id,
      label: input.provider.label,
    },
    sourceReference: quote.sourceReference,
    bid: quote.bid,
    ask: quote.ask,
    spread: quote.spread,
    providerFee: quote.providerFee,
    deliveredAmount: quote.deliveredAmount,
  };
}

function takeCachedValues(input: {
  pending: Map<string, ExchangeRatePair>;
  previous: ReadonlyMap<string, ExchangeRateObservation>;
  values: Map<string, CurrentExchangeRateValue>;
  retrievedAt: string;
  cacheForMs: number;
  staleAfterMs: number;
}): void {
  for (const [key] of input.pending) {
    const cached = input.previous.get(key);
    if (
      cached == null ||
      !isUsableCache(
        cached,
        input.retrievedAt,
        input.cacheForMs,
        input.staleAfterMs,
      )
    ) {
      continue;
    }
    input.values.set(key, {
      observation: cached,
      freshness: "cached",
      fallback: false,
    });
    input.pending.delete(key);
  }
}

type ProviderRequestResult =
  | { ok: true; quotes: CurrentExchangeRateProviderQuote[] }
  | { ok: false; failure: CurrentExchangeRateFailure };

async function requestProvider(input: {
  provider: CurrentExchangeRateProvider;
  pairs: ExchangeRatePair[];
  retrievedAt: string;
  timeoutMs: number;
}): Promise<ProviderRequestResult> {
  try {
    const raw = await input.provider.fetchQuotes({
      pairs: input.pairs,
      retrievedAt: input.retrievedAt,
      signal: AbortSignal.timeout(input.timeoutMs),
    });
    return {
      ok: true,
      quotes: z.array(CurrentExchangeRateProviderQuoteSchema).parse(raw),
    };
  } catch (error) {
    const failure =
      error instanceof z.ZodError
        ? {
            providerId: input.provider.id,
            kind: "malformed_response" as const,
            message: `${input.provider.label} returned malformed quote data`,
            pairs: input.pairs,
          }
        : failureFromError(input.provider, input.pairs, error);
    return { ok: false, failure };
  }
}

function acceptProviderQuotes(input: {
  provider: CurrentExchangeRateProvider;
  providerIndex: number;
  requested: ExchangeRatePair[];
  quotes: CurrentExchangeRateProviderQuote[];
  retrievedAt: string;
  staleAfterMs: number;
  pending: Map<string, ExchangeRatePair>;
  values: Map<string, CurrentExchangeRateValue>;
  observations: ExchangeRateObservation[];
}): ExchangeRatePair[] {
  const requestedKeys = new Set(input.requested.map(pairKey));
  const returned = new Set<string>();
  for (const [sequence, quote] of input.quotes.entries()) {
    const key = pairKey(quote);
    if (!requestedKeys.has(key) || returned.has(key)) continue;
    returned.add(key);
    const observation = observationFromQuote({
      provider: input.provider,
      quote,
      retrievedAt: input.retrievedAt,
      sequence,
    });
    input.observations.push(observation);
    const age = elapsedMilliseconds(quote.quoteTime, input.retrievedAt);
    input.values.set(key, {
      observation,
      freshness: age >= 0 && age <= input.staleAfterMs ? "fresh" : "stale",
      fallback: input.providerIndex > 0,
    });
    input.pending.delete(key);
  }
  return input.requested.filter((pair) => !returned.has(pairKey(pair)));
}

function retainLastKnownAsStale(
  pending: ReadonlyMap<string, ExchangeRatePair>,
  previous: ReadonlyMap<string, ExchangeRateObservation>,
  values: Map<string, CurrentExchangeRateValue>,
): void {
  for (const [key] of pending) {
    const lastKnown = previous.get(key);
    if (lastKnown == null) continue;
    values.set(key, {
      observation: lastKnown,
      freshness: "stale",
      fallback: false,
    });
  }
}

export async function refreshCurrentExchangeRates(
  input: RefreshCurrentExchangeRatesInput,
): Promise<CurrentExchangeRateRefreshResult> {
  const retrievedAt = z.iso.datetime({ offset: true }).parse(input.retrievedAt);
  const cacheForMs = input.cacheForMs ?? DEFAULT_CACHE_MS;
  const staleAfterMs = input.staleAfterMs ?? DEFAULT_STALE_MS;
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pairs = normalizePairs(input.pairs);
  const previous = latestByPair(input.existingObservations ?? []);
  const values = new Map<string, CurrentExchangeRateValue>();
  const pending = new Map(pairs.map((pair) => [pairKey(pair), pair]));
  const observations: ExchangeRateObservation[] = [];
  const failures: CurrentExchangeRateFailure[] = [];

  if (!input.force)
    takeCachedValues({
      pending,
      previous,
      values,
      retrievedAt,
      cacheForMs,
      staleAfterMs,
    });

  for (const [providerIndex, provider] of input.providers.entries()) {
    if (pending.size === 0) break;
    const requested = [...pending.values()];
    const response = await requestProvider({
      provider,
      pairs: requested,
      retrievedAt,
      timeoutMs,
    });
    if (!response.ok) {
      failures.push(response.failure);
      continue;
    }
    const missing = acceptProviderQuotes({
      provider,
      providerIndex,
      requested,
      quotes: response.quotes,
      retrievedAt,
      staleAfterMs,
      pending,
      values,
      observations,
    });
    if (missing.length > 0) {
      failures.push({
        providerId: provider.id,
        kind: "partial_response",
        message: `${provider.label} did not return every requested pair`,
        pairs: missing,
      });
    }
  }

  retainLastKnownAsStale(pending, previous, values);

  return {
    values: pairs.flatMap((pair) => {
      const value = values.get(pairKey(pair));
      return value == null ? [] : [value];
    }),
    observations,
    failures,
  };
}

function providerFailureKind(
  kind:
    | "invalid_response"
    | "partial_response"
    | "provider_outage"
    | "quota_exceeded",
): Exclude<CurrentExchangeRateFailureKind, "partial_response"> {
  if (kind === "invalid_response") return "malformed_response";
  if (kind === "quota_exceeded") return "throttled";
  return "provider_outage";
}

export function createFrankfurterCurrentRateProvider(options?: {
  endpoint?: string;
  fetch?: typeof globalThis.fetch;
}): CurrentExchangeRateProvider {
  return {
    id: "frankfurter:blend",
    label: "Frankfurter blended reference rate",
    async fetchQuotes({ pairs, retrievedAt, signal }) {
      const date = retrievedAt.slice(0, 10);
      const fetcher = options?.fetch ?? globalThis.fetch;
      const result = await importHistoricalExchangeRates({
        pairs,
        from: date,
        to: date,
        retrievedAt,
        endpoint: options?.endpoint,
        fetch: (request, init) =>
          fetcher(request, {
            ...init,
            signal:
              init?.signal == null
                ? signal
                : AbortSignal.any([signal, init.signal]),
          }),
      });
      if (result.observations.length === 0 && result.failures[0] != null) {
        const failure = result.failures[0];
        throw new CurrentExchangeRateProviderError(
          providerFailureKind(failure.kind),
          failure.message,
          { retryAfter: failure.retryAfter },
        );
      }
      return result.observations.map((observation) => ({
        fromCurrency: observation.fromCurrency,
        toCurrency: observation.toCurrency,
        rate: observation.rate,
        quoteTime: `${observation.validAt}T00:00:00Z`,
        rateClass: "reference" as const,
        sourceReference: observation.sourceReference,
      }));
    },
  };
}
