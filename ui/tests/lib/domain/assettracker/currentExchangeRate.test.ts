import { describe, expect, it, vi } from "vitest";
import {
  type CurrentExchangeRateProvider,
  CurrentExchangeRateProviderError,
  createFrankfurterCurrentRateProvider,
  refreshCurrentExchangeRates,
} from "@/lib/domain/assettracker/currentExchangeRate";
import type { ExchangeRateObservation } from "@/lib/domain/assettracker/valuation";

const retrievedAt = "2026-10-02T12:00:00Z";
const pair = { fromCurrency: "GBP", toCurrency: "USD" } as const;

function provider(
  id: string,
  fetchQuotes: CurrentExchangeRateProvider["fetchQuotes"],
): CurrentExchangeRateProvider {
  return { id, label: `${id} rates`, fetchQuotes };
}

function existingObservation(
  overrides: Partial<ExchangeRateObservation> = {},
): ExchangeRateObservation {
  return {
    id: "previous-gbp-usd",
    fromCurrency: "GBP",
    toCurrency: "USD",
    rate: 1.3,
    rateClass: "reference",
    validAt: "2026-10-01",
    quotedAt: "2026-10-01T16:00:00Z",
    acceptedAt: "2026-10-01T16:01:00Z",
    retrievedAt: "2026-10-01T16:01:00Z",
    source: { kind: "provider", id: "old-provider" },
    ...overrides,
  };
}

describe("current exchange-rate refresh", () => {
  it("uses a recent cached quote without calling the provider", async () => {
    const fetchQuotes = vi.fn();
    const cached = existingObservation({
      validAt: "2026-10-02",
      quotedAt: "2026-10-02T11:30:00Z",
      acceptedAt: "2026-10-02T11:31:00Z",
      retrievedAt: "2026-10-02T11:31:00Z",
    });

    const result = await refreshCurrentExchangeRates({
      pairs: [pair],
      providers: [provider("primary", fetchQuotes)],
      existingObservations: [cached],
      retrievedAt,
    });

    expect(fetchQuotes).not.toHaveBeenCalled();
    expect(result.observations).toEqual([]);
    expect(result.values).toEqual([
      { observation: cached, freshness: "cached", fallback: false },
    ]);
  });

  it("keeps executable quote costs separate and records timing and provenance", async () => {
    const primary = provider("bank", async () => [
      {
        ...pair,
        rate: 1.34,
        quoteTime: "2026-10-02T11:59:30Z",
        rateClass: "executable",
        sourceReference: "bank-quote-123",
        bid: 1.335,
        ask: 1.34,
        spread: 0.005,
        providerFee: { amount: 3, currency: "GBP" },
        deliveredAmount: { amount: 1_337, currency: "USD" },
      },
    ]);

    const result = await refreshCurrentExchangeRates({
      pairs: [pair],
      providers: [primary],
      retrievedAt,
    });

    expect(result.values).toHaveLength(1);
    expect(result.values[0]).toMatchObject({
      freshness: "fresh",
      fallback: false,
      observation: {
        rate: 1.34,
        rateClass: "executable",
        quotedAt: "2026-10-02T11:59:30Z",
        retrievedAt,
        source: { id: "bank", label: "bank rates" },
        sourceReference: "bank-quote-123",
        bid: 1.335,
        ask: 1.34,
        spread: 0.005,
        providerFee: { amount: 3, currency: "GBP" },
        deliveredAmount: { amount: 1_337, currency: "USD" },
      },
    });
  });

  it("falls back for missing pairs after throttling", async () => {
    const primary = provider("primary", async () => {
      throw new CurrentExchangeRateProviderError(
        "throttled",
        "request limit reached",
        { retryAfter: "30" },
      );
    });
    const fallback = provider("fallback", async () => [
      {
        ...pair,
        rate: 1.32,
        quoteTime: "2026-10-02T11:00:00Z",
        rateClass: "reference",
      },
    ]);

    const result = await refreshCurrentExchangeRates({
      pairs: [pair],
      providers: [primary, fallback],
      retrievedAt,
    });

    expect(result.failures).toEqual([
      expect.objectContaining({
        providerId: "primary",
        kind: "throttled",
        retryAfter: "30",
      }),
    ]);
    expect(result.values[0]).toMatchObject({
      freshness: "fresh",
      fallback: true,
      observation: { source: { id: "fallback" } },
    });
  });

  it("rejects malformed provider data and tries the fallback", async () => {
    const malformed = provider("malformed", async () => [
      { ...pair, rate: -1, quoteTime: "not-a-time", rateClass: "reference" },
    ]);
    const fallback = provider("fallback", async () => [
      {
        ...pair,
        rate: 1.31,
        quoteTime: "2026-10-02T11:00:00Z",
        rateClass: "reference",
      },
    ]);

    const result = await refreshCurrentExchangeRates({
      pairs: [pair],
      providers: [malformed, fallback],
      retrievedAt,
    });

    expect(result.failures[0]).toMatchObject({
      providerId: "malformed",
      kind: "malformed_response",
    });
    expect(result.values[0]?.observation.source.id).toBe("fallback");
  });

  it("preserves the last known quote as stale when every provider fails", async () => {
    const previous = existingObservation();
    const unavailable = provider("primary", async () => {
      throw new DOMException("timed out", "TimeoutError");
    });

    const result = await refreshCurrentExchangeRates({
      pairs: [pair],
      providers: [unavailable],
      existingObservations: [previous],
      retrievedAt,
      cacheForMs: 0,
    });

    expect(result.observations).toEqual([]);
    expect(result.failures[0]).toMatchObject({ kind: "timeout" });
    expect(result.values).toEqual([
      { observation: previous, freshness: "stale", fallback: false },
    ]);
  });

  it("uses fallback only for pairs omitted by a partial response", async () => {
    const gbpEur = { fromCurrency: "GBP", toCurrency: "EUR" } as const;
    const primary = provider("primary", async () => [
      {
        ...pair,
        rate: 1.34,
        quoteTime: "2026-10-02T11:50:00Z",
        rateClass: "reference",
      },
    ]);
    const fallbackFetch = vi.fn<CurrentExchangeRateProvider["fetchQuotes"]>(
      async () => [
        {
          ...gbpEur,
          rate: 1.15,
          quoteTime: "2026-10-02T10:00:00Z",
          rateClass: "reference" as const,
        },
      ],
    );

    const result = await refreshCurrentExchangeRates({
      pairs: [pair, gbpEur],
      providers: [primary, provider("fallback", fallbackFetch)],
      retrievedAt,
    });

    expect(fallbackFetch.mock.calls[0]?.[0].pairs).toEqual([gbpEur]);
    expect(result.failures[0]).toMatchObject({
      providerId: "primary",
      kind: "partial_response",
      pairs: [gbpEur],
    });
    expect(result.values.map((value) => value.fallback)).toEqual([false, true]);
  });
});

describe("Frankfurter current-rate provider", () => {
  it("labels daily data as a reference rate, never an executable quote", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify([
            { date: "2026-10-02", base: "GBP", quote: "USD", rate: 1.33 },
          ]),
          { status: 200 },
        ),
    );
    const frankfurter = createFrankfurterCurrentRateProvider({ fetch });

    const result = await refreshCurrentExchangeRates({
      pairs: [pair],
      providers: [frankfurter],
      retrievedAt,
    });

    expect(result.values[0]).toMatchObject({
      freshness: "fresh",
      observation: {
        rateClass: "reference",
        quotedAt: "2026-10-02T00:00:00Z",
        bid: undefined,
        ask: undefined,
        providerFee: undefined,
        deliveredAmount: undefined,
      },
    });
  });
});
