import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InflationDatasetDisclosure } from "@/components/assettracker/inflation-dataset-disclosure";
import type { InflationDatasetRelease } from "@/lib/domain/assettracker";

const release: InflationDatasetRelease = {
  versionId: "2025-03-19:aaaaaaaaaaaa",
  index: "CPIH",
  source: {
    provider: "Office for National Statistics",
    datasetId: "MM23",
    seriesId: "L522",
    frequency: "monthly",
    baseDefinition: "2015=100",
    geography: "United Kingdom",
    coverageFrom: "2025-01",
    coverageThrough: "2025-02",
    sourceUrl: "https://example.com/cpih",
    releaseVersion: "2025-03-19",
    retrievedAt: "2025-03-20T12:00:00.000Z",
    checksum: `sha256:${"a".repeat(64)}`,
  },
  observations: [
    { period: "2025-01", value: 100 },
    { period: "2025-02", value: 101 },
  ],
};

describe("InflationDatasetDisclosure", () => {
  it("names the exact index, reference period, and pinned release", () => {
    render(
      <InflationDatasetDisclosure
        release={release}
        referenceDate="2025-02-28"
        currency="GBP"
      />,
    );

    expect(
      screen
        .getByText(/CPIH, including owner occupiers' housing costs/)
        .closest("p"),
    ).toHaveTextContent("to 2025-02");
    expect(screen.getByText(/ONS 2025-03-19/)).toHaveTextContent(
      "dataset 2025-03-19:aaaaaaaaaaaa",
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("flags unsupported currencies and unavailable indices", () => {
    const { rerender } = render(
      <InflationDatasetDisclosure
        release={release}
        referenceDate="2025-02-28"
        currency="USD"
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "CPIH only supports GBP comparisons",
    );

    rerender(
      <InflationDatasetDisclosure
        release={null}
        referenceDate="2025-02-28"
        currency="GBP"
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "selected inflation index is unavailable",
    );
  });

  it("does not describe RPI as CPIH", () => {
    render(
      <InflationDatasetDisclosure
        release={{ ...release, index: "RPI" }}
        referenceDate="2025-02-28"
        currency="GBP"
      />,
    );

    expect(screen.getByText(/RPI, Retail Prices Index/)).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "not interchangeable with CPI or CPIH",
    );
  });
});
