import { describe, expect, it, vi } from "vitest";
import { onsInflationArchive } from "../src/data";
import {
  fetchOnsInflationRelease,
  ONS_INFLATION_SOURCES,
  type OnsInflationSourceSpec,
  parseOnsApiInflationObservations,
  parseOnsInflationCsv,
} from "../src/ons";

const fixtureSpec: OnsInflationSourceSpec = {
  index: "CPIH",
  role: "primary",
  seriesId: "TEST",
  datasetId: "MM23",
  baseDefinition: "2015=100",
  geography: "United Kingdom",
  frequency: "monthly",
  requiredFrom: "2024-01",
  sourceUrl: "https://example.com/series",
  csvUrl: "https://example.com/series.csv",
};

const fixtureCsv = `"Title","Fixture 2015=100"
"CDID","TEST"
"Source dataset ID","MM23"
"PreUnit",""
"Unit","Index, base year = 100"
"Release date","19-03-2025"
"Next release","23 April 2025"
"Important notes",""
"2024","105.0"
"2024 Q1","101.0"
"2024 JAN","100.0"
"2024 FEB","101.0"
"2024 MAR","102.0"
`;

describe("ONS inflation ingestion", () => {
  it("records the official series IDs and retired API status", () => {
    expect(
      ONS_INFLATION_SOURCES.map(({ index, seriesId }) => ({ index, seriesId })),
    ).toEqual([
      { index: "CPI", seriesId: "D7BT" },
      { index: "CPIH", seriesId: "L522" },
      { index: "RPI", seriesId: "CHAW" },
    ]);
    expect(ONS_INFLATION_SOURCES.at(1)?.api).toEqual(
      expect.objectContaining({ status: "retired", aggregate: "CP00" }),
    );
  });

  it("parses only monthly index levels and records release provenance", () => {
    const release = parseOnsInflationCsv(
      fixtureSpec,
      fixtureCsv,
      "2025-03-20T12:00:00.000Z",
    );

    expect(release.observations).toEqual([
      { period: "2024-01", value: 100 },
      { period: "2024-02", value: 101 },
      { period: "2024-03", value: 102 },
    ]);
    expect(release.source).toEqual(
      expect.objectContaining({
        seriesId: "TEST",
        frequency: "monthly",
        releaseVersion: "2025-03-19",
        coverageFrom: "2024-01",
        coverageThrough: "2024-03",
        checksum: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      }),
    );
  });

  it("parses the ONS API month labels on both sides of 2000", () => {
    const spec = { ...fixtureSpec, requiredFrom: "1988-10" };
    const release = parseOnsApiInflationObservations(
      spec,
      {
        observations: [
          {
            dimensions: { Time: { label: "Nov-88" } },
            observation: "49.2",
          },
          {
            dimensions: { Time: { label: "Oct-88" } },
            observation: "49.0",
          },
          {
            dimensions: { Time: { label: "Dec-88" } },
            observation: "49.4",
          },
        ],
      },
      "2025-03-19",
      "2025-03-20T12:00:00.000Z",
      "https://api.beta.ons.gov.uk/example",
    );

    expect(release.observations.map(({ period }) => period)).toEqual([
      "1988-10",
      "1988-11",
      "1988-12",
    ]);
  });

  it("retries transient failures while fetching the CSV fallback", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce(new Response(fixtureCsv));

    await expect(
      fetchOnsInflationRelease(fixtureSpec, {
        fetchImpl,
        retrievedAt: "2025-03-20T12:00:00.000Z",
      }),
    ).resolves.toMatchObject({ index: "CPIH" });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("uses the CSV fallback without sending household values", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(fixtureCsv));

    await fetchOnsInflationRelease(fixtureSpec, {
      fetchImpl,
      retrievedAt: "2025-03-20T12:00:00.000Z",
    });

    expect(fetchImpl).toHaveBeenCalledWith(fixtureSpec.csvUrl, {
      headers: { Accept: "*/*" },
    });
    expect(fetchImpl.mock.calls.at(0)?.[1]).not.toHaveProperty("body");
  });

  it("prefers a documented API while that source remains active", async () => {
    const activeSpec: OnsInflationSourceSpec = {
      ...fixtureSpec,
      api: {
        status: "active",
        datasetId: "cpih01",
        edition: "time-series",
        geography: "K02000001",
        aggregate: "CP00",
        documentationUrl: "https://developer.ons.gov.uk/observations/cmd/",
      },
    };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          items: [
            {
              version: 72,
              release_date: "2025-03-19T00:00:00.000Z",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          observations: [
            {
              dimensions: { Time: { label: "Mar-24" } },
              observation: "102",
            },
            {
              dimensions: { Time: { label: "Jan-24" } },
              observation: "100",
            },
            {
              dimensions: { Time: { label: "Feb-24" } },
              observation: "101",
            },
          ],
        }),
      );

    const release = await fetchOnsInflationRelease(activeSpec, {
      fetchImpl,
      retrievedAt: "2025-03-20T12:00:00.000Z",
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls.at(0)?.[0]).toContain(
      "/datasets/cpih01/editions/time-series/versions?limit=1",
    );
    expect(fetchImpl.mock.calls.at(1)?.[0]).toContain(
      "/versions/72/observations?time=*&geography=K02000001&aggregate=CP00",
    );
    expect(fetchImpl.mock.calls.at(1)?.[0]).not.toBe(activeSpec.csvUrl);
    expect(release.source.releaseVersion).toBe("2025-03-19");
  });

  it("ships complete pinned CPI, CPIH, and RPI releases", () => {
    expect(
      onsInflationArchive.releases.map(({ index }) => index).sort(),
    ).toEqual(["CPI", "CPIH", "RPI"]);
    for (const release of onsInflationArchive.releases) {
      expect(release.source.releaseVersion).toBe("2026-09-16");
      expect(release.source.coverageThrough).toBe("2026-08");
      expect(release.observations.length).toBeGreaterThan(450);
    }
  });
});
