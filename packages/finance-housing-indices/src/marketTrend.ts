import { z } from "zod";
import {
  type HousePriceIndexSeriesCandidate,
  HousePriceIndexSeriesCandidateSchema,
} from "./propertyHistory";
import {
  type HousePriceIndexObservation,
  type HousePriceIndexRelease,
  HousePriceIndexReleaseSchema,
  type HousePropertyType,
} from "./schema";
import { type HousingValue, HousingValueSchema } from "./valueConfidence";

export const HousePriceMarketTrendQuerySchema = z.object({
  nation: z.literal("northern-ireland"),
  seriesHierarchy: z.array(HousePriceIndexSeriesCandidateSchema).min(1),
});
export type HousePriceMarketTrendQuery = z.infer<
  typeof HousePriceMarketTrendQuerySchema
>;

export type HousePriceMarketTrend = {
  nation: "northern-ireland";
  frequency: "quarterly";
  geographyCode: string;
  geographyName: string;
  geographyMatch: "exact" | "broader" | "national";
  propertyType: HousePropertyType;
  propertyTypeMatch: "exact" | "all";
  fallback: boolean;
  period: string;
  averagePrice: number;
  index: number;
  annualChangePercent?: number;
  provisional: boolean;
  housingValue: HousingValue;
  reportedSalesVolume?: {
    count: number;
    period: string;
    propertyType: "all";
  };
  evidence: {
    provider: "Land & Property Services / NISRA";
    dataset: "Northern Ireland House Price Index";
    pageUrl: string;
    releasePageUrl: string;
    retrievedAt: string;
    versionId: string;
    releasePeriod: string;
    attribution: string;
  };
  limitation: string;
  provisionalWarning: string;
};

function isQuarterEnd(period: string): boolean {
  return ["03", "06", "09", "12"].includes(period.slice(5, 7));
}

function previousYear(period: string): string {
  return `${Number(period.slice(0, 4)) - 1}${period.slice(4)}`;
}

function periodEndDate(period: string): string {
  const [year, month] = period.split("-").map(Number);
  const day = new Date(Date.UTC(year ?? 0, month ?? 0, 0))
    .getUTCDate()
    .toString()
    .padStart(2, "0");
  return `${period}-${day}`;
}

function latestQuarter(
  release: HousePriceIndexRelease,
  geographyCode: string,
  propertyType: HousePropertyType,
): HousePriceIndexObservation | undefined {
  return release.observations
    .filter(
      (observation) =>
        observation.geographyCode === geographyCode &&
        observation.propertyType === propertyType &&
        observation.averagePrice != null &&
        isQuarterEnd(observation.period),
    )
    .toSorted((left, right) => right.period.localeCompare(left.period))[0];
}

function isFallbackSeries(
  position: number,
  candidate: HousePriceIndexSeriesCandidate,
): boolean {
  return (
    position > 0 ||
    candidate.geographyMatch !== "exact" ||
    candidate.propertyTypeMatch !== "exact"
  );
}

function observationStatus(
  observation: HousePriceIndexObservation,
): "final" | "provisional" | "revised" {
  if (observation.provisional) return "provisional";
  return observation.revisionStatus === "revised" ? "revised" : "final";
}

function revisionNote(status: "final" | "provisional" | "revised"):
  | string
  | undefined {
  if (status === "provisional") {
    return "The latest Northern Ireland HPI figure is provisional and may be revised.";
  }
  if (status === "revised") {
    return "The official source revised this observation after its first publication.";
  }
  return undefined;
}

function marketTrendHousingValue(
  release: HousePriceIndexRelease,
  candidate: HousePriceIndexSeriesCandidate,
  latest: HousePriceIndexObservation & { averagePrice: number },
  fallback: boolean,
): HousingValue {
  const dataStatus = observationStatus(latest);
  const note = revisionNote(dataStatus);
  const precision =
    candidate.geographyMatch === "national"
      ? "nation"
      : candidate.geographyMatch === "broader"
        ? "region"
        : "local-authority";
  return HousingValueSchema.parse({
    id: `regional-index-statistic:${latest.geographyCode}:${latest.propertyType}:${latest.period}`,
    kind: "regional-index-statistic",
    amount: latest.averagePrice,
    currency: "GBP",
    asOf: periodEndDate(latest.period),
    source: {
      kind: "official-index",
      name: "Land & Property Services / NISRA Northern Ireland House Price Index",
      date: release.source.publishedAt,
      dateKind: "published",
      geography: {
        name: latest.geographyName,
        code: latest.geographyCode,
        precision,
      },
    },
    dataStatus,
    ...(note == null ? {} : { revisionNote: note }),
    uncertainty: {
      kind: "point",
      explanation:
        "This is an official average for an area and property type, not an estimate for an individual home.",
    },
    ...(fallback
      ? {
          fallback: {
            used: true,
            explanation:
              "The requested series was unavailable, so the configured broader series was used.",
          },
        }
      : {}),
    explanation:
      "This area statistic describes the market. It does not identify individual properties or replace comparable sales.",
    freshness: {
      assessedAt: release.source.retrievedAt.slice(0, 10),
      staleAfterDays: 180,
    },
  });
}

function reportedSalesVolume(
  release: HousePriceIndexRelease,
  latest: HousePriceIndexObservation,
): HousePriceIndexObservation | undefined {
  return release.observations
    .filter(
      (observation) =>
        observation.geographyCode === latest.geographyCode &&
        observation.propertyType === "all" &&
        observation.period <= latest.period &&
        observation.salesVolume != null &&
        isQuarterEnd(observation.period),
    )
    .toSorted((left, right) => right.period.localeCompare(left.period))[0];
}

export function findNorthernIrelandMarketTrend(
  candidateRelease: HousePriceIndexRelease,
  candidateQuery: HousePriceMarketTrendQuery,
): HousePriceMarketTrend {
  const release = HousePriceIndexReleaseSchema.parse(candidateRelease);
  const query = HousePriceMarketTrendQuerySchema.parse(candidateQuery);

  for (const [position, candidate] of query.seriesHierarchy.entries()) {
    const latest = latestQuarter(
      release,
      candidate.geographyCode,
      candidate.propertyType,
    );
    if (latest?.averagePrice == null) continue;

    const yearEarlier = release.observations.find(
      (observation) =>
        observation.geographyCode === latest.geographyCode &&
        observation.propertyType === latest.propertyType &&
        observation.period === previousYear(latest.period),
    );
    const reportedVolume = reportedSalesVolume(release, latest);
    const fallback = isFallbackSeries(position, candidate);
    const housingValue = marketTrendHousingValue(
      release,
      candidate,
      { ...latest, averagePrice: latest.averagePrice },
      fallback,
    );

    return {
      nation: query.nation,
      frequency: "quarterly",
      geographyCode: latest.geographyCode,
      geographyName: latest.geographyName,
      geographyMatch: candidate.geographyMatch,
      propertyType: latest.propertyType,
      propertyTypeMatch: candidate.propertyTypeMatch,
      fallback,
      period: latest.period,
      averagePrice: latest.averagePrice,
      index: latest.index,
      ...(yearEarlier == null
        ? {}
        : {
            annualChangePercent:
              (latest.index / yearEarlier.index - 1) * 100,
          }),
      provisional: latest.provisional,
      housingValue,
      ...(reportedVolume?.salesVolume == null
        ? {}
        : {
            reportedSalesVolume: {
              count: reportedVolume.salesVolume,
              period: reportedVolume.period,
              propertyType: "all" as const,
            },
          }),
      evidence: {
        provider: "Land & Property Services / NISRA",
        dataset: "Northern Ireland House Price Index",
        pageUrl:
          "https://www.finance-ni.gov.uk/articles/northern-ireland-house-price-index",
        releasePageUrl: release.source.pageUrl,
        retrievedAt: release.source.retrievedAt,
        versionId: release.versionId,
        releasePeriod: release.source.releasePeriod,
        attribution: release.source.attribution,
      },
      limitation:
        "Area statistics do not identify individual properties or replace comparable sales.",
      provisionalWarning:
        "The latest Northern Ireland HPI figures are provisional and may be revised.",
    };
  }

  throw new Error(
    "The pinned UK HPI release has no Northern Ireland observation for the configured area or fallback series.",
  );
}
