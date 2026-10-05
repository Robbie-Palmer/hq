import { describe, expect, it, vi } from "vitest";
import {
  fetchUkHpiRelease,
  parseUkHpiCsv,
} from "../src/hmlr";
import { csv, source } from "./fixtures";

describe("HM Land Registry UK HPI ingestion", () => {
  it("parses geography and property-type series with provenance", () => {
    const release = parseUkHpiCsv(
      source,
      csv,
      "2025-05-22T10:00:00.000Z",
    );

    expect(release.observations).toHaveLength(15);
    expect(release.observations).toContainEqual({
      period: "2024-01",
      geographyCode: "N09000003",
      geographyName: "Belfast, East",
      propertyType: "flat-maisonette",
      index: 104,
      provisional: false,
    });
    expect(release.observations).toContainEqual(
      expect.objectContaining({
        period: "2025-03",
        geographyCode: "E92000001",
        propertyType: "detached",
        provisional: true,
      }),
    );
    expect(release.source).toEqual(
      expect.objectContaining({
        provider: "HM Land Registry",
        releasePeriod: "2025-03",
        publishedAt: "2025-05-21",
        checksum: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        rawObjectKey: expect.stringMatching(
          /^uk-hpi\/releases\/[a-f0-9]{64}\.csv$/,
        ),
      }),
    );
  });

  it("rejects an upstream schema change", () => {
    expect(() =>
      parseUkHpiCsv(
        source,
        csv.replace("DetachedIndex", "DetachedLevel"),
        "2025-05-22T10:00:00.000Z",
      ),
    ).toThrow("missing the DetachedIndex column");
  });

  it("fetches only the public versioned CSV", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(csv));

    const result = await fetchUkHpiRelease(source, {
      fetchImpl,
      retrievedAt: "2025-05-22T10:00:00.000Z",
    });

    expect(result.raw).toBe(csv);
    expect(fetchImpl).toHaveBeenCalledWith(source.downloadUrl, {
      headers: { Accept: "text/csv" },
    });
    expect(fetchImpl.mock.calls[0]?.[1]).not.toHaveProperty("body");
  });
});
