import { ruleDataset } from "./data";
import {
  datasetSchema,
  isoDateSchema,
  type Jurisdiction,
  jurisdictionSchema,
  type PayPeriod,
  payPeriodSchema,
  supportedNationalInsuranceCategorySchema,
} from "./schema";

const dataset = datasetSchema.parse(ruleDataset);

export type RuleRequest = {
  date: string;
  jurisdiction: string;
  nationalInsuranceCategory: string;
  payPeriod: string;
};

export type RuleUnavailableReason =
  | "invalid-date"
  | "unsupported-date"
  | "unsupported-jurisdiction"
  | "unsupported-national-insurance-category"
  | "unsupported-pay-period";

export type RuleResolution =
  | {
      available: true;
      datasetVersion: string;
      date: string;
      jurisdiction: Jurisdiction;
      payPeriod: PayPeriod;
      incomeTax: (typeof dataset.incomeTax)[number];
      nationalInsurance: (typeof dataset.nationalInsurance)[number];
      pension: (typeof dataset.pensions)[number];
    }
  | {
      available: false;
      reason: RuleUnavailableReason;
      detail: string;
    };

const isRealIsoDate = (date: string) => {
  if (!isoDateSchema.safeParse(date).success) {
    return false;
  }
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date;
};

const containsDate = (
  rule: { effectiveFrom: string; effectiveTo: string },
  date: string,
) => rule.effectiveFrom <= date && date <= rule.effectiveTo;

export const resolveRules = (request: RuleRequest): RuleResolution => {
  if (!isRealIsoDate(request.date)) {
    return {
      available: false,
      reason: "invalid-date",
      detail: `Expected a real ISO date, received ${request.date}`,
    };
  }
  const jurisdiction = jurisdictionSchema.safeParse(request.jurisdiction);
  if (!jurisdiction.success) {
    return {
      available: false,
      reason: "unsupported-jurisdiction",
      detail: `${request.jurisdiction} has no reviewed Income Tax rules`,
    };
  }
  if (
    !supportedNationalInsuranceCategorySchema.safeParse(
      request.nationalInsuranceCategory,
    ).success
  ) {
    return {
      available: false,
      reason: "unsupported-national-insurance-category",
      detail: `Class 1 category ${request.nationalInsuranceCategory} is not supported`,
    };
  }
  const payPeriod = payPeriodSchema.safeParse(request.payPeriod);
  if (!payPeriod.success) {
    return {
      available: false,
      reason: "unsupported-pay-period",
      detail: `${request.payPeriod} Class 1 thresholds are not supported`,
    };
  }

  const incomeTax = dataset.incomeTax.find(
    (rule) =>
      rule.legalStatus === "enacted" &&
      rule.jurisdictions.includes(jurisdiction.data) &&
      containsDate(rule, request.date),
  );
  const nationalInsurance = dataset.nationalInsurance.find(
    (rule) => rule.legalStatus === "enacted" && containsDate(rule, request.date),
  );
  const pension = dataset.pensions.find(
    (rule) =>
      rule.legalStatus === "enacted" &&
      rule.jurisdictions.includes(jurisdiction.data) &&
      containsDate(rule, request.date),
  );
  if (!(incomeTax && nationalInsurance && pension)) {
    return {
      available: false,
      reason: "unsupported-date",
      detail: `${request.date} is outside the reviewed 2015-16 to 2026-27 range`,
    };
  }

  return {
    available: true,
    datasetVersion: dataset.datasetVersion,
    date: request.date,
    jurisdiction: jurisdiction.data,
    payPeriod: payPeriod.data,
    incomeTax,
    nationalInsurance,
    pension,
  };
};

export { ruleDataset } from "./data";
export * from "./householdTax";
export * from "./historicalSalary";
export * from "./salaryAdapter";
export type {
  Jurisdiction,
  PayPeriod,
  PensionContributionMethod,
  RuleDataset,
} from "./schema";
export {
  datasetSchema,
  datasetVersionSchema,
  householdTaxRuleSchema,
  isoDateSchema,
  jurisdictionSchema,
  legalStatusSchema,
  moneyPenceSchema,
  nationalInsuranceCategorySchema,
  nationalInsuranceRuleSchema,
  payeTaxBasisSchema,
  payPeriodSchema,
  pensionContributionMethodSchema,
  pensionRuleSchema,
  rateBasisPointsSchema,
  sourceSchema,
  supportedNationalInsuranceCategorySchema,
  taxYearSchema,
} from "./schema";
export * from "./validationApi";
