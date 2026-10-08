import { describe, expect, it, vi } from "vitest";
import {
  fetchPricePaidRelease,
  parsePricePaidCsv,
  storePricePaidRelease,
} from "../src/pricePaid";
import { pricePaidCsv, pricePaidSource } from "./fixtures";

describe("HM Land Registry Price Paid Data ingestion", () => {
  it("parses official rows with transaction provenance", () => {
    const release = parsePricePaidCsv(
      pricePaidSource,
      pricePaidCsv,
      "2026-10-04T12:00:00.000Z",
    );

    expect(release.transactions).toHaveLength(3);
    expect(release.transactions[0]).toEqual({
      transactionId: "tx-1",
      price: 315_000,
      completionDate: "2026-06-18",
      postcode: "CF10 1AA",
      propertyType: "detached",
      newBuild: false,
      tenure: "freehold",
      townCity: "CARDIFF",
      district: "CARDIFF",
      county: "CARDIFF",
      recordStatus: "added",
    });
    expect(release.source).toEqual(
      expect.objectContaining({
        provider: "HM Land Registry",
        dataset: "Price Paid Data",
        coverage: "england-and-wales",
        observedThrough: "2026-08-31",
        latestCompleteMonth: "2026-06",
        checksum: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        rawObjectKey: expect.stringMatching(
          /^price-paid\/releases\/[a-f0-9]{64}\.csv$/,
        ),
      }),
    );
  });

  it("rejects an upstream row-shape change", () => {
    expect(() =>
      parsePricePaidCsv(
        pricePaidSource,
        '"{tx-1}","315000","2026-06-18 00:00"',
        "2026-10-04T12:00:00.000Z",
      ),
    ).toThrow("has 3 columns; expected 16");
  });

  it("fetches the public bulk CSV without a paid API", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(pricePaidCsv));

    const result = await fetchPricePaidRelease(pricePaidSource, {
      fetchImpl,
      retrievedAt: "2026-10-04T12:00:00.000Z",
    });

    expect(result.raw).toBe(pricePaidCsv);
    expect(fetchImpl).toHaveBeenCalledWith(pricePaidSource.downloadUrl, {
      headers: { Accept: "text/csv" },
    });
  });

  it("stores immutable source bytes before normalized rows", async () => {
    const release = parsePricePaidCsv(
      pricePaidSource,
      pricePaidCsv,
      "2026-10-04T12:00:00.000Z",
    );
    let stored = false;
    const order: string[] = [];
    const store = {
      hasRelease: vi.fn(async () => stored),
      putRawSource: vi.fn(async () => {
        order.push("raw");
      }),
      putRelease: vi.fn(async () => {
        order.push("release");
        stored = true;
      }),
    };

    await expect(
      storePricePaidRelease(store, { raw: pricePaidCsv, release }),
    ).resolves.toBe("stored");
    await expect(
      storePricePaidRelease(store, { raw: pricePaidCsv, release }),
    ).resolves.toBe("unchanged");
    expect(order).toEqual(["raw", "release"]);
  });
});
