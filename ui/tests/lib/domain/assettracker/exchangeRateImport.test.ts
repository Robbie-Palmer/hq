import { describe, expect, it, vi } from "vitest";
import {
  deriveExchangeRateObservation,
  importHistoricalExchangeRates,
  nextIncrementalExchangeRateDate,
} from "@/lib/domain/assettracker/exchangeRateImport";
import type { ExchangeRateObservation } from "@/lib/domain/assettracker/valuation";

const retrievedAt = "2026-10-02T08:00:00Z";

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function rate(overrides: Record<string, unknown> = {}) {
  return {
    date: "2026-09-30",
    base: "GBP",
    quote: "USD",
    rate: 1.35,
    providers: [
      { key: "ECB", date: "2026-09-30", rate: 1.349, excluded: false },
      { key: "FED", date: "2026-09-29", rate: 1.351, excluded: true },
    ],
    ...overrides,
  };
}

describe("historical exchange-rate import", () => {
  it("imports explicit pairs with provider lineage and reproducible source references", async () => {
    const fetch = vi.fn(async (_input: string | URL | Request) =>
      jsonResponse([rate()]),
    );

    const result = await importHistoricalExchangeRates({
      pairs: [{ fromCurrency: "GBP", toCurrency: "USD" }],
      from: "2026-09-30",
      to: "2026-09-30",
      retrievedAt,
      fetch,
    });

    expect(fetch).toHaveBeenCalledOnce();
    expect(String(fetch.mock.calls[0]?.[0])).toContain(
      "base=GBP&quotes=USD&from=2026-09-30&to=2026-09-30&expand=providers",
    );
    expect(result.observations).toEqual([
      expect.objectContaining({
        fromCurrency: "GBP",
        toCurrency: "USD",
        rate: 1.35,
        rateDecimal: "1.35",
        rateClass: "reference",
        validAt: "2026-09-30",
        acceptedAt: retrievedAt,
        retrievedAt,
        source: expect.objectContaining({ id: "frankfurter:blend" }),
        sourceReference: expect.stringMatching(/#row=0&body=[a-f0-9]{64}$/),
        providerObservations: [
          {
            provider: "ECB",
            observedDate: "2026-09-30",
            rate: 1.349,
            excluded: false,
            carried: false,
          },
          {
            provider: "FED",
            observedDate: "2026-09-29",
            rate: 1.351,
            excluded: true,
            carried: true,
          },
        ],
      }),
    ]);
    expect(result.gaps).toEqual([]);
    expect(result.failures).toEqual([]);
  });

  it("is idempotent and records a changed provider value as a correction", async () => {
    const first = await importHistoricalExchangeRates({
      pairs: [{ fromCurrency: "GBP", toCurrency: "USD" }],
      from: "2026-09-30",
      to: "2026-09-30",
      retrievedAt,
      fetch: async () => jsonResponse([rate()]),
    });
    const original = first.observations[0];
    expect(original).toBeDefined();

    const unchanged = await importHistoricalExchangeRates({
      pairs: [{ fromCurrency: "GBP", toCurrency: "USD" }],
      from: "2026-09-30",
      to: "2026-09-30",
      retrievedAt: "2026-10-03T08:00:00Z",
      existingObservations: first.observations,
      fetch: async () => jsonResponse([rate()]),
    });
    expect(unchanged.observations).toEqual([]);

    const corrected = await importHistoricalExchangeRates({
      pairs: [{ fromCurrency: "GBP", toCurrency: "USD" }],
      from: "2026-09-30",
      to: "2026-09-30",
      retrievedAt: "2026-10-04T08:00:00Z",
      existingObservations: first.observations,
      fetch: async () => jsonResponse([rate({ rate: 1.36 })]),
    });
    expect(corrected.observations).toEqual([
      expect.objectContaining({ rate: 1.36, correctsId: original?.id }),
    ]);
  });

  it("labels weekend and supplied holiday gaps without carrying rates forward", async () => {
    const result = await importHistoricalExchangeRates({
      pairs: [{ fromCurrency: "GBP", toCurrency: "USD" }],
      from: "2026-12-25",
      to: "2026-12-27",
      retrievedAt,
      fetch: async () => jsonResponse([]),
      classifyDate: () => "non_trading_day",
    });

    expect(result.observations).toEqual([]);
    expect(result.gaps).toEqual([
      {
        fromCurrency: "GBP",
        toCurrency: "USD",
        date: "2026-12-25",
        reason: "non_trading_day",
      },
      {
        fromCurrency: "GBP",
        toCurrency: "USD",
        date: "2026-12-26",
        reason: "non_trading_day",
      },
      {
        fromCurrency: "GBP",
        toCurrency: "USD",
        date: "2026-12-27",
        reason: "non_trading_day",
      },
    ]);
    expect(result.failures).toEqual([]);
  });

  it("exposes unsupported currencies and partial weekday responses", async () => {
    const result = await importHistoricalExchangeRates({
      pairs: [
        { fromCurrency: "GBP", toCurrency: "USD" },
        { fromCurrency: "GBP", toCurrency: "JPY" },
      ],
      from: "2026-09-29",
      to: "2026-09-30",
      retrievedAt,
      fetch: async () => jsonResponse([rate()]),
    });

    expect(result.unsupportedPairs).toEqual([
      { fromCurrency: "GBP", toCurrency: "JPY" },
    ]);
    expect(result.gaps).toEqual([
      {
        fromCurrency: "GBP",
        toCurrency: "USD",
        date: "2026-09-29",
        reason: "missing_provider_observation",
      },
    ]);
    expect(result.failures).toEqual([
      expect.objectContaining({ kind: "partial_response" }),
    ]);
  });

  it("splits long backfills into provider-supported request windows", async () => {
    const fetch = vi.fn(async () => jsonResponse([]));
    const result = await importHistoricalExchangeRates({
      pairs: [{ fromCurrency: "GBP", toCurrency: "USD" }],
      from: "2019-01-01",
      to: "2024-01-01",
      retrievedAt,
      fetch,
    });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.requestUrls[0]).toContain("from=2019-01-01&to=2023-12-31");
    expect(result.requestUrls[1]).toContain("from=2024-01-01&to=2024-01-01");
  });

  it("retries transient outages and honors retry-after", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ error: "busy" }, 503, { "retry-after": "2" }),
      )
      .mockResolvedValueOnce(jsonResponse([rate()]));
    const retryDelay = vi.fn(async () => undefined);

    const result = await importHistoricalExchangeRates({
      pairs: [{ fromCurrency: "GBP", toCurrency: "USD" }],
      from: "2026-09-30",
      to: "2026-09-30",
      retrievedAt,
      fetch,
      retryDelay,
    });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(retryDelay).toHaveBeenCalledWith(2_000);
    expect(result.observations).toHaveLength(1);
  });

  it("returns quota and provider outage states without changing observations", async () => {
    const quota = await importHistoricalExchangeRates({
      pairs: [{ fromCurrency: "GBP", toCurrency: "USD" }],
      from: "2026-09-30",
      to: "2026-09-30",
      retrievedAt,
      maxRetries: 0,
      fetch: async () =>
        jsonResponse({ error: "slow down" }, 429, { "retry-after": "30" }),
    });
    const outage = await importHistoricalExchangeRates({
      pairs: [{ fromCurrency: "GBP", toCurrency: "USD" }],
      from: "2026-09-30",
      to: "2026-09-30",
      retrievedAt,
      fetch: async () => {
        throw new Error("network unavailable");
      },
    });

    expect(quota.observations).toEqual([]);
    expect(quota.failures).toEqual([
      expect.objectContaining({
        kind: "quota_exceeded",
        status: 429,
        retryAfter: "30",
      }),
    ]);
    expect(outage.observations).toEqual([]);
    expect(outage.failures).toEqual([
      expect.objectContaining({
        kind: "provider_outage",
        message: "network unavailable",
      }),
    ]);
  });

  it("rejects malformed provider payloads", async () => {
    const result = await importHistoricalExchangeRates({
      pairs: [{ fromCurrency: "GBP", toCurrency: "USD" }],
      from: "2026-09-30",
      to: "2026-09-30",
      retrievedAt,
      fetch: async () => jsonResponse([{ ...rate(), rate: -1 }]),
    });

    expect(result.observations).toEqual([]);
    expect(result.failures).toEqual([
      expect.objectContaining({ kind: "invalid_response" }),
    ]);
  });
});

describe("exchange-rate normalization", () => {
  it("normalizes direct, inverse, and triangulated observations", () => {
    const gbpUsd: ExchangeRateObservation = {
      id: "gbp-usd",
      fromCurrency: "GBP",
      toCurrency: "USD",
      rate: 1.25,
      rateDecimal: "1.25",
      validAt: "2026-09-30",
      acceptedAt: retrievedAt,
      source: { kind: "provider", id: "test" },
    };
    const direct = deriveExchangeRateObservation({
      id: "direct",
      fromCurrency: "GBP",
      toCurrency: "USD",
      legs: [gbpUsd],
    });
    const inverse = deriveExchangeRateObservation({
      id: "inverse",
      fromCurrency: "USD",
      toCurrency: "GBP",
      legs: [gbpUsd],
    });

    expect(direct).toMatchObject({
      rateDecimal: "1.25",
      derivation: { method: "direct", legs: ["gbp-usd"] },
    });
    expect(inverse).toMatchObject({
      rateDecimal: "0.8",
      derivation: { method: "inverse", legs: ["gbp-usd"] },
    });

    const gbpEur: ExchangeRateObservation = {
      ...gbpUsd,
      id: "gbp-eur",
      toCurrency: "EUR",
      rate: 1.2,
      rateDecimal: "1.2",
    };
    const eurUsd: ExchangeRateObservation = {
      ...gbpUsd,
      id: "eur-usd",
      fromCurrency: "EUR",
      rate: 1.1,
      rateDecimal: "1.1",
    };
    expect(
      deriveExchangeRateObservation({
        id: "triangulated",
        fromCurrency: "GBP",
        toCurrency: "USD",
        legs: [gbpEur, eurUsd],
      }),
    ).toMatchObject({
      rateDecimal: "1.32",
      derivation: {
        method: "triangulated",
        legs: ["gbp-eur", "eur-usd"],
      },
    });
    expect(() =>
      deriveExchangeRateObservation({
        id: "identity",
        fromCurrency: "GBP",
        toCurrency: "GBP",
        legs: [gbpUsd],
      }),
    ).toThrow("currencies must differ");
    expect(() =>
      deriveExchangeRateObservation({
        id: "missing",
        fromCurrency: "GBP",
        toCurrency: "USD",
        legs: [],
      }),
    ).toThrow("needs one or two source legs");
    expect(() =>
      deriveExchangeRateObservation({
        id: "different-dates",
        fromCurrency: "GBP",
        toCurrency: "USD",
        legs: [gbpEur, { ...eurUsd, validAt: "2026-09-29" }],
      }),
    ).toThrow("must share an observation date");
  });

  it("starts an incremental refresh after the latest accepted observation", () => {
    const observation: ExchangeRateObservation = {
      id: "fx-1",
      fromCurrency: "GBP",
      toCurrency: "USD",
      rate: 1.35,
      validAt: "2026-09-30",
      acceptedAt: retrievedAt,
      source: { kind: "provider", id: "frankfurter:blend" },
    };

    expect(
      nextIncrementalExchangeRateDate(
        [observation],
        { fromCurrency: "GBP", toCurrency: "USD" },
        "1999-01-04",
      ),
    ).toBe("2026-10-01");
    expect(
      nextIncrementalExchangeRateDate(
        [],
        { fromCurrency: "GBP", toCurrency: "USD" },
        "1999-01-04",
      ),
    ).toBe("1999-01-04");
  });
});
