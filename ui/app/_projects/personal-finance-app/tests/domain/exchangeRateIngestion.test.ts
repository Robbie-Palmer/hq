import { describe, expect, it, vi } from "vitest";
import { refreshCurrentExchangeRates } from "@/app/_projects/personal-finance-app/domain/currentExchangeRate";
import { fetchEcbReferenceRates } from "@/app/_projects/personal-finance-app/domain/ecbExchangeRateProvider";
import {
  createEcbCurrentRateProvider,
  importAutomatedHistoricalExchangeRates,
  importEcbHistoricalExchangeRates,
  refreshAutomatedReferenceRates,
} from "@/app/_projects/personal-finance-app/domain/exchangeRateIngestion";

const header =
  "FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE";

function ecbCsv(
  rows: ReadonlyArray<{
    currency: string;
    date: string;
    rate: string;
  }>,
): string {
  return [
    header,
    ...rows.map(
      (row) => `D,${row.currency},EUR,SP00,A,${row.date},${row.rate}`,
    ),
  ].join("\n");
}

function csvResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/csv" },
  });
}

const retrievedAt = "2026-10-04T12:00:00Z";

describe("ECB historical reference-rate ingestion", () => {
  it("derives same-date cross rates and keeps weekends and unsupported currencies visible", async () => {
    const fetch = vi.fn(async (_input: string | URL | Request) =>
      csvResponse(
        ecbCsv([
          { currency: "GBP", date: "2026-10-02", rate: "0.8" },
          { currency: "USD", date: "2026-10-02", rate: "1.2" },
        ]),
      ),
    );

    const result = await importEcbHistoricalExchangeRates({
      pairs: [
        { fromCurrency: "GBP", toCurrency: "USD" },
        { fromCurrency: "GBP", toCurrency: "JPY" },
      ],
      from: "2026-10-02",
      to: "2026-10-04",
      retrievedAt,
      fetch,
    });

    expect(String(fetch.mock.calls[0]?.[0])).toContain(
      "/EXR/D.GBP+USD.EUR.SP00.A",
    );
    expect(result.observations).toEqual([
      expect.objectContaining({
        fromCurrency: "GBP",
        toCurrency: "USD",
        rate: 1.5,
        rateDecimal: "1.5",
        rateClass: "reference",
        validAt: "2026-10-02",
        acceptedAt: retrievedAt,
        retrievedAt,
        source: expect.objectContaining({ id: "ecb:reference" }),
        sourceReference: expect.stringMatching(
          /^ecb:EXR\?date=2026-10-02&pair=GBP%2FUSD&evidence=/u,
        ),
        derivation: expect.objectContaining({ method: "triangulated" }),
      }),
    ]);
    expect(result.gaps).toEqual([
      {
        fromCurrency: "GBP",
        toCurrency: "USD",
        date: "2026-10-03",
        reason: "non_trading_day",
      },
      {
        fromCurrency: "GBP",
        toCurrency: "USD",
        date: "2026-10-04",
        reason: "non_trading_day",
      },
    ]);
    expect(result.unsupportedPairs).toEqual([
      { fromCurrency: "GBP", toCurrency: "JPY" },
    ]);
  });

  it("stores a revised ECB value as a correction without rewriting history", async () => {
    const first = await importEcbHistoricalExchangeRates({
      pairs: [{ fromCurrency: "EUR", toCurrency: "USD" }],
      from: "2026-10-02",
      to: "2026-10-02",
      retrievedAt: "2026-10-03T08:00:00Z",
      fetch: async () =>
        csvResponse(
          ecbCsv([{ currency: "USD", date: "2026-10-02", rate: "1.2" }]),
        ),
    });
    const original = first.observations[0];
    expect(original).toBeDefined();

    const revised = await importEcbHistoricalExchangeRates({
      pairs: [{ fromCurrency: "EUR", toCurrency: "USD" }],
      from: "2026-10-02",
      to: "2026-10-02",
      retrievedAt: "2026-10-04T08:00:00Z",
      existingObservations: first.observations,
      fetch: async () =>
        csvResponse(
          ecbCsv([{ currency: "USD", date: "2026-10-02", rate: "1.21" }]),
        ),
    });

    expect(revised.observations).toEqual([
      expect.objectContaining({ rate: 1.21, correctsId: original?.id }),
    ]);

    const unchanged = await importEcbHistoricalExchangeRates({
      pairs: [{ fromCurrency: "EUR", toCurrency: "USD" }],
      from: "2026-10-02",
      to: "2026-10-02",
      retrievedAt: "2026-10-05T08:00:00Z",
      existingObservations: [...first.observations, ...revised.observations],
      fetch: async () =>
        csvResponse(
          ecbCsv([{ currency: "USD", date: "2026-10-02", rate: "1.21" }]),
        ),
    });
    expect(unchanged.observations).toEqual([]);

    const reverted = await importEcbHistoricalExchangeRates({
      pairs: [{ fromCurrency: "EUR", toCurrency: "USD" }],
      from: "2026-10-02",
      to: "2026-10-02",
      retrievedAt: "2026-10-06T08:00:00Z",
      existingObservations: [...first.observations, ...revised.observations],
      fetch: async () =>
        csvResponse(
          ecbCsv([{ currency: "USD", date: "2026-10-02", rate: "1.2" }]),
        ),
    });
    expect(reverted.observations).toEqual([
      expect.objectContaining({
        rate: 1.2,
        correctsId: revised.observations[0]?.id,
      }),
    ]);
    expect(reverted.observations[0]?.id).not.toBe(original?.id);
  });

  it("keeps ECB quota and malformed-response failures structured", async () => {
    const input = {
      pairs: [{ fromCurrency: "EUR", toCurrency: "USD" }],
      from: "2026-10-02",
      to: "2026-10-02",
    } as const;

    await expect(
      fetchEcbReferenceRates({
        ...input,
        fetch: async () =>
          new Response("slow down", {
            status: 429,
            headers: { "retry-after": "60" },
          }),
      }),
    ).rejects.toMatchObject({
      kind: "throttled",
      retryAfter: "60",
    });

    await expect(
      fetchEcbReferenceRates({
        ...input,
        fetch: async () => csvResponse("TIME_PERIOD,OBS_VALUE\n2026-10-02,1.2"),
      }),
    ).rejects.toMatchObject({
      kind: "malformed_response",
    });
  });

  it("distinguishes a provider timeout from an outage", async () => {
    await expect(
      fetchEcbReferenceRates({
        pairs: [{ fromCurrency: "EUR", toCurrency: "USD" }],
        from: "2026-10-02",
        to: "2026-10-02",
        fetch: async () => {
          throw new DOMException("timed out", "TimeoutError");
        },
      }),
    ).rejects.toMatchObject({ kind: "timeout" });

    await expect(
      fetchEcbReferenceRates({
        pairs: [{ fromCurrency: "EUR", toCurrency: "USD" }],
        from: "2026-10-02",
        to: "2026-10-02",
        fetch: async () => {
          throw new Error("network unavailable");
        },
      }),
    ).rejects.toMatchObject({
      kind: "provider_outage",
      message: "network unavailable",
    });
  });

  it("fills a missing Frankfurter weekday from the ECB without hiding the provider failure", async () => {
    const result = await importAutomatedHistoricalExchangeRates({
      pairs: [{ fromCurrency: "GBP", toCurrency: "USD" }],
      from: "2026-10-02",
      to: "2026-10-02",
      retrievedAt,
      frankfurterFetch: async () =>
        new Response("[]", {
          headers: { "content-type": "application/json" },
        }),
      ecbFetch: async () =>
        csvResponse(
          ecbCsv([
            { currency: "GBP", date: "2026-10-02", rate: "0.8" },
            { currency: "USD", date: "2026-10-02", rate: "1.2" },
          ]),
        ),
    });

    expect(result.observations).toEqual([
      expect.objectContaining({
        source: expect.objectContaining({ id: "ecb:reference" }),
      }),
    ]);
    expect(result.gaps).toEqual([]);
    expect(result.failures).toEqual([
      expect.objectContaining({ kind: "partial_response" }),
    ]);
  });

  it("does not duplicate a successful Frankfurter pair when another base fails", async () => {
    const result = await importAutomatedHistoricalExchangeRates({
      pairs: [
        { fromCurrency: "GBP", toCurrency: "USD" },
        { fromCurrency: "EUR", toCurrency: "USD" },
      ],
      from: "2026-10-02",
      to: "2026-10-02",
      retrievedAt,
      maxRetries: 0,
      frankfurterFetch: async (request) =>
        String(request).includes("base=GBP")
          ? new Response(
              JSON.stringify([
                {
                  date: "2026-10-02",
                  base: "GBP",
                  quote: "USD",
                  rate: 1.34,
                },
              ]),
              { headers: { "content-type": "application/json" } },
            )
          : new Response("unavailable", { status: 503 }),
      ecbFetch: async () =>
        csvResponse(
          ecbCsv([
            { currency: "GBP", date: "2026-10-02", rate: "0.8" },
            { currency: "USD", date: "2026-10-02", rate: "1.2" },
          ]),
        ),
    });

    expect(
      result.observations.map((observation) => [
        observation.fromCurrency,
        observation.toCurrency,
        observation.source.id,
      ]),
    ).toEqual([
      ["GBP", "USD", "frankfurter:blend"],
      ["EUR", "USD", "ecb:reference"],
    ]);
    expect(result.gaps).toEqual([]);
  });
});

describe("ECB current reference-rate provider", () => {
  it("uses the last published working-day rate on a weekend and marks its age", async () => {
    const provider = createEcbCurrentRateProvider({
      fetch: async () =>
        csvResponse(
          ecbCsv([
            { currency: "GBP", date: "2026-10-02", rate: "0.8" },
            { currency: "USD", date: "2026-10-02", rate: "1.2" },
          ]),
        ),
    });

    const result = await refreshCurrentExchangeRates({
      pairs: [{ fromCurrency: "GBP", toCurrency: "USD" }],
      providers: [provider],
      retrievedAt,
      rateClass: "reference",
    });

    expect(result.values).toEqual([
      expect.objectContaining({
        freshness: "stale",
        observation: expect.objectContaining({
          rate: 1.5,
          rateClass: "reference",
          quotedAt: "2026-10-02T00:00:00Z",
          source: expect.objectContaining({ id: "ecb:reference" }),
        }),
      }),
    ]);
  });

  it("falls back from Frankfurter to the ECB without changing the rate class", async () => {
    const result = await refreshAutomatedReferenceRates({
      pairs: [{ fromCurrency: "GBP", toCurrency: "USD" }],
      retrievedAt,
      frankfurter: {
        fetch: async () =>
          new Response("[]", {
            headers: { "content-type": "application/json" },
          }),
      },
      ecb: {
        fetch: async () =>
          csvResponse(
            ecbCsv([
              { currency: "GBP", date: "2026-10-02", rate: "0.8" },
              { currency: "USD", date: "2026-10-02", rate: "1.2" },
            ]),
          ),
      },
    });

    expect(result.failures).toEqual([
      expect.objectContaining({
        providerId: "frankfurter:blend",
        kind: "partial_response",
      }),
    ]);
    expect(result.values).toEqual([
      expect.objectContaining({
        fallback: true,
        observation: expect.objectContaining({
          rateClass: "reference",
          source: expect.objectContaining({ id: "ecb:reference" }),
        }),
      }),
    ]);
  });

  it("reuses the same observation when only the lookback response changes", async () => {
    const firstProvider = createEcbCurrentRateProvider({
      lookbackDays: 10,
      fetch: async () =>
        csvResponse(
          ecbCsv([
            { currency: "GBP", date: "2026-10-01", rate: "0.79" },
            { currency: "USD", date: "2026-10-01", rate: "1.19" },
            { currency: "GBP", date: "2026-10-02", rate: "0.8" },
            { currency: "USD", date: "2026-10-02", rate: "1.2" },
          ]),
        ),
    });
    const first = await refreshCurrentExchangeRates({
      pairs: [{ fromCurrency: "GBP", toCurrency: "USD" }],
      providers: [firstProvider],
      retrievedAt,
      rateClass: "reference",
    });

    const secondProvider = createEcbCurrentRateProvider({
      lookbackDays: 3,
      fetch: async () =>
        csvResponse(
          ecbCsv([
            { currency: "GBP", date: "2026-10-01", rate: "0.78" },
            { currency: "USD", date: "2026-10-01", rate: "1.18" },
            { currency: "GBP", date: "2026-10-02", rate: "0.8" },
            { currency: "USD", date: "2026-10-02", rate: "1.2" },
          ]),
        ),
    });
    const unchanged = await refreshCurrentExchangeRates({
      pairs: [{ fromCurrency: "GBP", toCurrency: "USD" }],
      providers: [secondProvider],
      existingObservations: first.observations,
      retrievedAt: "2026-10-04T13:00:00Z",
      force: true,
      rateClass: "reference",
    });

    expect(unchanged.observations).toEqual([]);
    expect(unchanged.values[0]?.observation.id).toBe(first.observations[0]?.id);
  });

  it("records changed ECB evidence even when the derived rate is unchanged", async () => {
    const original = await refreshCurrentExchangeRates({
      pairs: [{ fromCurrency: "GBP", toCurrency: "USD" }],
      providers: [
        createEcbCurrentRateProvider({
          fetch: async () =>
            csvResponse(
              ecbCsv([
                { currency: "GBP", date: "2026-10-02", rate: "0.8" },
                { currency: "USD", date: "2026-10-02", rate: "1.2" },
              ]),
            ),
        }),
      ],
      retrievedAt,
      rateClass: "reference",
    });
    const revised = await refreshCurrentExchangeRates({
      pairs: [{ fromCurrency: "GBP", toCurrency: "USD" }],
      providers: [
        createEcbCurrentRateProvider({
          fetch: async () =>
            csvResponse(
              ecbCsv([
                { currency: "GBP", date: "2026-10-02", rate: "0.4" },
                { currency: "USD", date: "2026-10-02", rate: "0.6" },
              ]),
            ),
        }),
      ],
      existingObservations: original.observations,
      retrievedAt: "2026-10-04T13:00:00Z",
      force: true,
      rateClass: "reference",
    });

    expect(revised.observations).toEqual([
      expect.objectContaining({
        rate: 1.5,
        correctsId: original.observations[0]?.id,
      }),
    ]);
  });
});
