import { ruleDataset } from "./data";

export const BUSINESS_REALISATION_TAX_CALCULATION_VERSION =
  "business-realisation-tax-v1" as const;

export const businessRealisationRuleSources = [
  {
    id: "hmrc-business-asset-disposal-relief",
    title: "Business Asset Disposal Relief",
    publisher: "HM Revenue & Customs",
    url: "https://www.gov.uk/business-asset-disposal-relief",
    snapshotPath: "source-snapshots/business-asset-disposal-relief.md",
  },
  {
    id: "hmrc-business-asset-disposal-relief-calculation",
    title: "Business Asset Disposal Relief: work out your tax",
    publisher: "HM Revenue & Customs",
    url: "https://www.gov.uk/business-asset-disposal-relief/work-out-your-tax",
    snapshotPath: "source-snapshots/business-asset-disposal-relief.md",
  },
  {
    id: "hmrc-company-dissolution-distributions",
    title: "CTM36220: company dissolution distributions",
    publisher: "HM Revenue & Customs",
    url: "https://www.gov.uk/hmrc-internal-manuals/company-taxation-manual/ctm36220",
    snapshotPath: "source-snapshots/company-dissolution-distributions.md",
  },
  {
    id: "insolvency-service-members-voluntary-liquidation",
    title: "Members' Voluntary Liquidation",
    publisher: "The Insolvency Service",
    url: "https://www.gov.uk/guidance/director-information-hub-members-voluntary-liquidation-mvl",
    snapshotPath: "source-snapshots/company-dissolution-distributions.md",
  },
] as const;

export type BusinessRealisationTaxSource =
  (typeof businessRealisationRuleSources)[number] | {
    id: string;
    title: string;
    publisher: string;
    url: string;
    snapshotPath: string;
  };

const realisationRules = [
  {
    id: "business-realisation-2025-26",
    effectiveFrom: "2025-04-06",
    effectiveTo: "2026-04-05",
    businessAssetDisposalReliefRateBasisPoints: 1_400,
    businessAssetDisposalReliefLifetimeLimitPence: 100_000_000,
    strikingOffCapitalDistributionLimitPence: 2_500_000,
  },
  {
    id: "business-realisation-2026-27",
    effectiveFrom: "2026-04-06",
    effectiveTo: "2027-04-05",
    businessAssetDisposalReliefRateBasisPoints: 1_800,
    businessAssetDisposalReliefLifetimeLimitPence: 100_000_000,
    strikingOffCapitalDistributionLimitPence: 2_500_000,
  },
] as const;

export type BusinessRealisationTaxRules = {
  datasetVersion: string;
  ruleIds: string[];
  effectiveFrom: string;
  effectiveTo: string;
  dividendAllowancePence: number;
  dividendRates: {
    basicBasisPoints: number;
    higherBasisPoints: number;
    additionalBasisPoints: number;
  };
  capitalGains: {
    annualExemptAmountPence: number;
    basicRateBasisPoints: number;
    higherRateBasisPoints: number;
  };
  businessAssetDisposalRelief: {
    rateBasisPoints: number;
    lifetimeLimitPence: number;
  };
  strikingOffCapitalDistributionLimitPence: number;
  sources: BusinessRealisationTaxSource[];
};

export type BusinessRealisationRuleResolution =
  | { available: true; rules: BusinessRealisationTaxRules }
  | { available: false; reason: "invalid-date" | "unsupported-date" };

const isRealIsoDate = (date: string): boolean => {
  const parsed = new Date(`${date}T00:00:00Z`);
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    !Number.isNaN(parsed.valueOf()) &&
    parsed.toISOString().slice(0, 10) === date
  );
};

const containsDate = (
  rule: { effectiveFrom: string; effectiveTo: string },
  date: string,
): boolean => rule.effectiveFrom <= date && date <= rule.effectiveTo;

export function resolveBusinessRealisationTaxRules(
  date: string,
): BusinessRealisationRuleResolution {
  if (!isRealIsoDate(date)) return { available: false, reason: "invalid-date" };
  const householdRule = ruleDataset.householdTax.find(
    (rule) => rule.legalStatus === "enacted" && containsDate(rule, date),
  );
  const realisationRule = realisationRules.find((rule) =>
    containsDate(rule, date),
  );
  if (householdRule == null || realisationRule == null) {
    return { available: false, reason: "unsupported-date" };
  }
  const existingSources = householdRule.provenance.sourceIds.flatMap(
    (sourceId) => {
      const source = ruleDataset.sources.find(({ id }) => id === sourceId);
      return source == null
        ? []
        : [
            {
              id: source.id,
              title: source.title,
              publisher: source.publisher,
              url: source.url,
              snapshotPath: source.snapshotPath,
            },
          ];
    },
  );
  return {
    available: true,
    rules: {
      datasetVersion: ruleDataset.datasetVersion,
      ruleIds: [householdRule.id, realisationRule.id],
      effectiveFrom: realisationRule.effectiveFrom,
      effectiveTo: realisationRule.effectiveTo,
      dividendAllowancePence: householdRule.dividendAllowancePence,
      dividendRates: householdRule.dividendRates,
      capitalGains: householdRule.capitalGains,
      businessAssetDisposalRelief: {
        rateBasisPoints:
          realisationRule.businessAssetDisposalReliefRateBasisPoints,
        lifetimeLimitPence:
          realisationRule.businessAssetDisposalReliefLifetimeLimitPence,
      },
      strikingOffCapitalDistributionLimitPence:
        realisationRule.strikingOffCapitalDistributionLimitPence,
      sources: [...existingSources, ...businessRealisationRuleSources],
    },
  };
}

export type BusinessAssetDisposalReliefEligibility =
  | { state: "unknown"; reason: string }
  | { state: "not-claimed"; reason: string }
  | {
      state: "assessed";
      intendsToClaim: boolean;
      nonEmiOrdinaryShares: boolean;
      officerOrEmployeeForTwoYears: boolean;
      tradingCompanyForTwoYears: boolean;
      heldForTwoYears: boolean;
      ordinaryShareCapitalPercent: number;
      votingRightsPercent: number;
      economicEntitlement:
        | { kind: "profits-and-winding-up-assets"; percent: number }
        | { kind: "company-sale-proceeds"; percent: number };
      priorLifetimeQualifyingGainsPence: number;
    };

export type CapitalRealisationTaxInput = {
  date: string;
  proceedsPence: number;
  allowableCostPence: number;
  lossesAppliedPence: number;
  remainingAnnualExemptAmountPence: number;
  remainingBasicRateBandPence: number;
  reliefEligibility: BusinessAssetDisposalReliefEligibility;
};

export type CapitalRealisationTaxResult = {
  available: boolean;
  taxPence: number | null;
  gainPence: number;
  taxableGainPence: number;
  businessAssetDisposalReliefGainPence: number;
  standardRateGainPence: number;
  reliefApplied: boolean;
  unsupported: Array<{ code: string; detail: string }>;
  lineage: {
    calculationVersion: typeof BUSINESS_REALISATION_TAX_CALCULATION_VERSION;
    ruleIds: string[];
    datasetVersion: string | null;
    sourceIds: string[];
  };
};

const roundTax = (amountPence: number, rateBasisPoints: number): number =>
  Math.round((amountPence * rateBasisPoints) / 10_000);

function qualifiesForBusinessAssetDisposalRelief(
  eligibility: Extract<
    BusinessAssetDisposalReliefEligibility,
    { state: "assessed" }
  >,
): boolean {
  return (
    eligibility.intendsToClaim &&
    eligibility.nonEmiOrdinaryShares &&
    eligibility.officerOrEmployeeForTwoYears &&
    eligibility.tradingCompanyForTwoYears &&
    eligibility.heldForTwoYears &&
    eligibility.ordinaryShareCapitalPercent >= 5 &&
    eligibility.votingRightsPercent >= 5 &&
    eligibility.economicEntitlement.percent >= 5
  );
}

export function calculateCapitalRealisationTax(
  input: CapitalRealisationTaxInput,
): CapitalRealisationTaxResult {
  const resolution = resolveBusinessRealisationTaxRules(input.date);
  const gainPence = Math.max(
    0,
    input.proceedsPence - input.allowableCostPence - input.lossesAppliedPence,
  );
  const taxableGainPence = Math.max(
    0,
    gainPence - input.remainingAnnualExemptAmountPence,
  );
  const unavailable = (
    code: string,
    detail: string,
  ): CapitalRealisationTaxResult => ({
    available: false,
    taxPence: null,
    gainPence,
    taxableGainPence,
    businessAssetDisposalReliefGainPence: 0,
    standardRateGainPence: taxableGainPence,
    reliefApplied: false,
    unsupported: [{ code, detail }],
    lineage: {
      calculationVersion: BUSINESS_REALISATION_TAX_CALCULATION_VERSION,
      ruleIds: [],
      datasetVersion: null,
      sourceIds: [],
    },
  });
  if (!resolution.available) {
    return unavailable(
      "unsupported-tax-date",
      `${input.date} has no reviewed business realisation tax rules`,
    );
  }
  if (input.reliefEligibility.state === "unknown") {
    return unavailable(
      "unknown-business-asset-disposal-relief-eligibility",
      input.reliefEligibility.reason,
    );
  }

  const { rules } = resolution;
  const assessed =
    input.reliefEligibility.state === "assessed"
      ? input.reliefEligibility
      : null;
  const reliefApplied =
    assessed != null && qualifiesForBusinessAssetDisposalRelief(assessed);
  const remainingLifetimeLimit = Math.max(
    0,
    rules.businessAssetDisposalRelief.lifetimeLimitPence -
      (assessed?.priorLifetimeQualifyingGainsPence ?? 0),
  );
  const reliefGainPence = reliefApplied
    ? Math.min(taxableGainPence, remainingLifetimeLimit)
    : 0;
  const standardRateGainPence = taxableGainPence - reliefGainPence;
  const basicRateCapacity = Math.max(
    0,
    input.remainingBasicRateBandPence - reliefGainPence,
  );
  const standardBasicRateGainPence = Math.min(
    standardRateGainPence,
    basicRateCapacity,
  );
  const standardHigherRateGainPence =
    standardRateGainPence - standardBasicRateGainPence;
  const taxPence =
    roundTax(
      reliefGainPence,
      rules.businessAssetDisposalRelief.rateBasisPoints,
    ) +
    roundTax(
      standardBasicRateGainPence,
      rules.capitalGains.basicRateBasisPoints,
    ) +
    roundTax(
      standardHigherRateGainPence,
      rules.capitalGains.higherRateBasisPoints,
    );
  return {
    available: true,
    taxPence,
    gainPence,
    taxableGainPence,
    businessAssetDisposalReliefGainPence: reliefGainPence,
    standardRateGainPence,
    reliefApplied,
    unsupported: [],
    lineage: {
      calculationVersion: BUSINESS_REALISATION_TAX_CALCULATION_VERSION,
      ruleIds: rules.ruleIds,
      datasetVersion: rules.datasetVersion,
      sourceIds: rules.sources.map(({ id }) => id),
    },
  };
}

export type DividendRealisationTaxInput = {
  date: string;
  distributionPence: number;
  remainingDividendAllowancePence: number;
  remainingBasicRateBandPence: number;
  remainingHigherRateBandPence: number;
};

export type DividendRealisationTaxResult = {
  available: boolean;
  taxPence: number | null;
  taxableDividendPence: number;
  basicRateDividendPence: number;
  higherRateDividendPence: number;
  additionalRateDividendPence: number;
  unsupported: Array<{ code: string; detail: string }>;
  lineage: CapitalRealisationTaxResult["lineage"];
};

export function calculateDividendRealisationTax(
  input: DividendRealisationTaxInput,
): DividendRealisationTaxResult {
  const resolution = resolveBusinessRealisationTaxRules(input.date);
  const taxableDividendPence = Math.max(
    0,
    input.distributionPence - input.remainingDividendAllowancePence,
  );
  if (!resolution.available) {
    return {
      available: false,
      taxPence: null,
      taxableDividendPence,
      basicRateDividendPence: 0,
      higherRateDividendPence: 0,
      additionalRateDividendPence: 0,
      unsupported: [
        {
          code: "unsupported-tax-date",
          detail: `${input.date} has no reviewed business realisation tax rules`,
        },
      ],
      lineage: {
        calculationVersion: BUSINESS_REALISATION_TAX_CALCULATION_VERSION,
        ruleIds: [],
        datasetVersion: null,
        sourceIds: [],
      },
    };
  }
  const { rules } = resolution;
  const basicRateDividendPence = Math.min(
    taxableDividendPence,
    input.remainingBasicRateBandPence,
  );
  const afterBasic = taxableDividendPence - basicRateDividendPence;
  const higherRateDividendPence = Math.min(
    afterBasic,
    input.remainingHigherRateBandPence,
  );
  const additionalRateDividendPence = afterBasic - higherRateDividendPence;
  return {
    available: true,
    taxPence:
      roundTax(basicRateDividendPence, rules.dividendRates.basicBasisPoints) +
      roundTax(higherRateDividendPence, rules.dividendRates.higherBasisPoints) +
      roundTax(
        additionalRateDividendPence,
        rules.dividendRates.additionalBasisPoints,
      ),
    taxableDividendPence,
    basicRateDividendPence,
    higherRateDividendPence,
    additionalRateDividendPence,
    unsupported: [],
    lineage: {
      calculationVersion: BUSINESS_REALISATION_TAX_CALCULATION_VERSION,
      ruleIds: rules.ruleIds,
      datasetVersion: rules.datasetVersion,
      sourceIds: rules.sources.map(({ id }) => id),
    },
  };
}
