import { describe, expect, it, vi } from "vitest";
import {
  compareHousePriceIndices,
  type HousePriceIndexArchive,
  type HousePriceIndexError,
  ingestHousePriceIndexRelease,
  selectHousePriceIndexRelease,
  storeHousePriceIndexRelease,
} from "../src";
import { parseUkHpiCsv } from "../src/hmlr";
import { csv, source } from "./fixtures";

const first = parseUkHpiCsv(source, csv, "2025-05-22T10:00:00.000Z");

describe("versioned UK HPI archive", () => {
  it("retrieves anchor and target values from one pinned release", () => {
    const comparison = compareHousePriceIndices(first, {
      geographyCode: "N09000003",
      propertyType: "all",
      anchorDate: "2024-01-31",
      targetDate: "2024-03-01",
    });

    expect(comparison.anchor.index).toBe(100);
    expect(comparison.target.index).toBe(110);
    expect(comparison.ratio).toBe(1.1);
    expect(comparison.releaseVersionId).toBe(first.versionId);
  });

  it("reports a missing period instead of carrying a value forward", () => {
    expect(() =>
      compareHousePriceIndices(first, {
        geographyCode: "N09000003",
        propertyType: "all",
        anchorDate: "2024-01-01",
        targetDate: "2024-02-01",
      }),
    ).toThrowError(
      expect.objectContaining<Partial<HousePriceIndexError>>({
        code: "observation_unavailable",
      }),
    );
  });

  it("keeps a changed release and ignores an unchanged rerun", () => {
    const empty: HousePriceIndexArchive = { releases: [] };
    const stored = ingestHousePriceIndexRelease(empty, first);
    const repeated = ingestHousePriceIndexRelease(stored, first);
    const revision = parseUkHpiCsv(
      source,
      csv.replace(
        "01/03/2024,\"Belfast, East\",N09000003,190000,110",
        "01/03/2024,\"Belfast, East\",N09000003,190000,111",
      ),
      "2025-05-23T10:00:00.000Z",
    );
    const revised = ingestHousePriceIndexRelease(repeated, revision);

    expect(repeated).toEqual(stored);
    expect(revised.releases).toHaveLength(2);
    expect(selectHousePriceIndexRelease(revised, first.versionId)).toEqual(first);
    expect(
      compareHousePriceIndices(revision, {
        geographyCode: "N09000003",
        propertyType: "all",
        anchorDate: "2024-01-01",
        targetDate: "2024-03-01",
      }).target.index,
    ).toBe(111);
  });

  it("stores raw bytes before normalized observations and is idempotent", async () => {
    let known = false;
    const order: string[] = [];
    const store = {
      hasRelease: vi.fn(async () => known),
      putRawSource: vi.fn(async () => {
        order.push("raw");
      }),
      putRelease: vi.fn(async () => {
        order.push("release");
        known = true;
      }),
    };

    await expect(
      storeHousePriceIndexRelease(store, { raw: csv, release: first }),
    ).resolves.toBe("stored");
    await expect(
      storeHousePriceIndexRelease(store, { raw: csv, release: first }),
    ).resolves.toBe("unchanged");
    expect(order).toEqual(["raw", "release"]);
    expect(store.putRelease).toHaveBeenCalledTimes(1);
  });

  it("rejects raw bytes that do not match release provenance", async () => {
    const store = {
      hasRelease: vi.fn(async () => false),
      putRawSource: vi.fn(async () => undefined),
      putRelease: vi.fn(async () => undefined),
    };

    await expect(
      storeHousePriceIndexRelease(store, {
        raw: `${csv}changed`,
        release: first,
      }),
    ).rejects.toThrow("does not match the release checksum");
    expect(store.hasRelease).not.toHaveBeenCalled();
  });
});
