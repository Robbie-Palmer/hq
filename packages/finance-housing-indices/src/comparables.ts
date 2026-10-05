import { z } from "zod";
import {
  type PricePaidArchive,
  PricePaidArchiveSchema,
  type PricePaidPropertyType,
  PricePaidPropertyTypeSchema,
  type PricePaidRelease,
  PricePaidReleaseSchema,
  type PricePaidTenure,
  PricePaidTenureSchema,
  type PricePaidTransaction,
} from "./pricePaidSchema";

export const UkNationSchema = z.enum([
  "england",
  "wales",
  "scotland",
  "northern-ireland",
]);
export type UkNation = z.infer<typeof UkNationSchema>;

export const ComparableSalesQuerySchema = z
  .object({
    nation: UkNationSchema,
    postcode: z.string().min(1),
    completedFrom: z.iso.date(),
    completedTo: z.iso.date(),
    propertyTypes: z.array(PricePaidPropertyTypeSchema).min(1),
    tenures: z.array(PricePaidTenureSchema).min(1),
    newBuild: z.enum(["include", "exclude", "only"]),
    maxResults: z.number().int().positive().max(100),
  })
  .refine((query) => query.completedFrom <= query.completedTo, {
    message: "Comparable sale start date must not follow the end date",
    path: ["completedFrom"],
  });
export type ComparableSalesQuery = z.infer<typeof ComparableSalesQuerySchema>;

export type ComparableSalesCriteria = {
  searchArea: {
    kind: "postcode-district";
    value: string;
    label: string;
  };
  completedFrom: string;
  completedTo: string;
  propertyTypes: PricePaidPropertyType[];
  tenures: PricePaidTenure[];
  newBuild: ComparableSalesQuery["newBuild"];
  maxResults: number;
  matchingRule: string;
};

export type ComparableSale = Pick<
  PricePaidTransaction,
  | "transactionId"
  | "price"
  | "completionDate"
  | "propertyType"
  | "newBuild"
  | "tenure"
> & {
  location: {
    postcode: string;
    townCity: string;
    district?: string;
    county?: string;
    precision: "full-postcode";
  };
};

export type ComparableSalesEvidence = {
  versionId: string;
  provider: "HM Land Registry";
  dataset: "Price Paid Data";
  pageUrl: string;
  retrievedAt: string;
  observedThrough: string;
  latestCompleteMonth: string;
  registrationLag: string;
  recentDataWarning: string;
  attribution: string;
};

export type ComparableSalesResult =
  | {
      status: "ready";
      criteria: ComparableSalesCriteria;
      evidence: ComparableSalesEvidence;
      sales: ComparableSale[];
    }
  | {
      status: "empty";
      criteria: ComparableSalesCriteria;
      evidence: ComparableSalesEvidence;
      sales: [];
      message: string;
    }
  | {
      status: "unsupported-region";
      nation: UkNation;
      evidence: ComparableSalesEvidence;
      message: string;
    };

function compactPostcode(postcode: string): string {
  return postcode.toUpperCase().replaceAll(/\s/g, "");
}

function postcodeDistrict(postcode: string): string {
  const compact = compactPostcode(postcode);
  const match = /^([A-Z]{1,2}\d[A-Z\d]?)\d[A-Z]{2}$/.exec(compact);
  if (match?.[1] == null) throw new Error(`Invalid UK postcode: ${postcode}`);
  return match[1];
}

function evidenceFor(release: PricePaidRelease): ComparableSalesEvidence {
  return {
    versionId: release.versionId,
    provider: release.source.provider,
    dataset: release.source.dataset,
    pageUrl: release.source.pageUrl,
    retrievedAt: release.source.retrievedAt,
    observedThrough: release.source.observedThrough,
    latestCompleteMonth: release.source.latestCompleteMonth,
    registrationLag:
      "Completed sales commonly appear two weeks to two months after completion.",
    recentDataWarning: `Records after ${release.source.latestCompleteMonth} are incomplete and will grow as registrations arrive.`,
    attribution: release.source.attribution,
  };
}

function criteriaFor(query: ComparableSalesQuery): ComparableSalesCriteria {
  const district = postcodeDistrict(query.postcode);
  return {
    searchArea: {
      kind: "postcode-district",
      value: district,
      label: `${district} postcode district`,
    },
    completedFrom: query.completedFrom,
    completedTo: query.completedTo,
    propertyTypes: [...query.propertyTypes],
    tenures: [...query.tenures],
    newBuild: query.newBuild,
    maxResults: query.maxResults,
    matchingRule:
      "Exact postcode district, inclusive completion dates, selected property types, tenure, and new-build filter. Newest completions appear first.",
  };
}

function matchesNewBuild(
  transaction: PricePaidTransaction,
  filter: ComparableSalesQuery["newBuild"],
): boolean {
  if (filter === "only") return transaction.newBuild;
  if (filter === "exclude") return !transaction.newBuild;
  return true;
}

function comparableSale(transaction: PricePaidTransaction): ComparableSale {
  if (transaction.postcode == null) {
    throw new Error(
      `Matched Price Paid Data transaction ${transaction.transactionId} has no postcode`,
    );
  }
  return {
    transactionId: transaction.transactionId,
    price: transaction.price,
    completionDate: transaction.completionDate,
    propertyType: transaction.propertyType,
    newBuild: transaction.newBuild,
    tenure: transaction.tenure,
    location: {
      postcode: transaction.postcode,
      townCity: transaction.townCity,
      ...(transaction.district == null
        ? {}
        : { district: transaction.district }),
      ...(transaction.county == null ? {} : { county: transaction.county }),
      precision: "full-postcode",
    },
  };
}

export function findComparableSales(
  candidate: PricePaidRelease,
  input: ComparableSalesQuery,
): ComparableSalesResult {
  const release = PricePaidReleaseSchema.parse(candidate);
  const query = ComparableSalesQuerySchema.parse(input);
  const evidence = evidenceFor(release);
  if (query.nation === "scotland" || query.nation === "northern-ireland") {
    const nationName =
      query.nation === "scotland" ? "Scotland" : "Northern Ireland";
    return {
      status: "unsupported-region",
      nation: query.nation,
      evidence,
      message: `Individual completed-sale records for ${nationName} are not available from this open source.`,
    };
  }
  const criteria = criteriaFor(query);
  const sales = release.transactions
    .filter(
      (transaction) =>
        transaction.recordStatus !== "deleted" &&
        transaction.postcode != null &&
        postcodeDistrict(transaction.postcode) === criteria.searchArea.value &&
        transaction.completionDate >= query.completedFrom &&
        transaction.completionDate <= query.completedTo &&
        query.propertyTypes.includes(transaction.propertyType) &&
        query.tenures.includes(transaction.tenure) &&
        matchesNewBuild(transaction, query.newBuild),
    )
    .toSorted((left, right) =>
      `${right.completionDate}:${right.transactionId}`.localeCompare(
        `${left.completionDate}:${left.transactionId}`,
      ),
    )
    .slice(0, query.maxResults)
    .map(comparableSale);
  if (sales.length === 0) {
    return {
      status: "empty",
      criteria,
      evidence,
      sales: [],
      message:
        "No completed sales matched this postcode district, date range, and property filter.",
    };
  }
  return { status: "ready", criteria, evidence, sales };
}

export function ingestPricePaidRelease(
  archive: PricePaidArchive,
  candidate: PricePaidRelease,
): PricePaidArchive {
  const current = PricePaidArchiveSchema.parse(archive);
  const release = PricePaidReleaseSchema.parse(candidate);
  if (
    current.releases.some(
      ({ source }) => source.checksum === release.source.checksum,
    )
  ) {
    return current;
  }
  return PricePaidArchiveSchema.parse({
    releases: [...current.releases, release].toSorted((left, right) =>
      `${left.source.publishedAt}:${left.versionId}`.localeCompare(
        `${right.source.publishedAt}:${right.versionId}`,
      ),
    ),
  });
}

export function selectPricePaidRelease(
  archive: PricePaidArchive,
  versionId: string,
): PricePaidRelease {
  const parsed = PricePaidArchiveSchema.parse(archive);
  const release = parsed.releases.find(
    (candidate) => candidate.versionId === versionId,
  );
  if (release == null) {
    throw new Error(`Price Paid Data release ${versionId} is unavailable`);
  }
  return release;
}
