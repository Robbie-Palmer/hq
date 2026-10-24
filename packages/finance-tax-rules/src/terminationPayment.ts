import { z } from "zod";
import { isoDateSchema, moneyPenceSchema } from "./schema";

export const TERMINATION_PAYMENT_RULESET = {
  id: "uk-termination-payment-v1",
  version: "2026.10.24",
  effectiveFrom: "2020-04-06",
  section403ThresholdPence: 3_000_000,
  sources: [
    {
      id: "gov-uk-termination-tax-ni",
      title: "Tax on termination payments: What you pay tax and National Insurance on",
      publisher: "HM Revenue & Customs",
      url: "https://www.gov.uk/termination-payments-and-tax-when-you-leave-a-job/what-you-pay-tax-and-national-insurance-on",
    },
    {
      id: "hmrc-eim13500",
      title: "EIM13500: termination payment threshold, exceptions and reliefs",
      publisher: "HM Revenue & Customs",
      url: "https://www.gov.uk/hmrc-internal-manuals/employment-income-manual/eim13500",
    },
    {
      id: "hmrc-eim13735",
      title: "EIM13735: contributions to a registered pension scheme",
      publisher: "HM Revenue & Customs",
      url: "https://www.gov.uk/hmrc-internal-manuals/employment-income-manual/eim13735",
    },
  ],
} as const;

export const TerminationPaymentComponentKindSchema = z.enum([
  "statutory-redundancy",
  "enhanced-redundancy",
  "unpaid-wages",
  "holiday-pay",
  "bonus",
  "contractual-payment-in-lieu-of-notice",
  "post-employment-notice-pay",
  "restrictive-covenant",
  "employer-pension-contribution",
  "employer-paid-legal-costs",
  "injury-disability-award",
  "non-cash-benefit",
  "other",
]);
export type TerminationPaymentComponentKind = z.infer<
  typeof TerminationPaymentComponentKindSchema
>;

const TerminationPaymentComponentSchema = z.object({
  id: z.string().trim().min(1),
  kind: TerminationPaymentComponentKindSchema,
  amountPence: moneyPenceSchema,
});

export const TerminationPaymentCalculationRequestSchema = z.object({
  effectiveDate: isoDateSchema,
  currency: z.string().trim().min(1),
  jurisdiction: z.string().trim().min(1),
  residence: z.enum(["full-year-uk", "partial-year", "non-uk"]),
  noticeTreatment: z.enum([
    "worked-or-paid-in-full",
    "employer-confirmed-no-penp",
    "reduced-or-unknown",
  ]),
  priorSection403AwardsPence: moneyPenceSchema,
  hasOtherTaxInteractions: z.boolean(),
  components: z.array(TerminationPaymentComponentSchema).min(1),
  knownDeductionsPence: moneyPenceSchema,
});
export type TerminationPaymentCalculationRequest = z.infer<
  typeof TerminationPaymentCalculationRequestSchema
>;

export type TerminationPaymentTreatment = {
  componentId: string;
  kind: TerminationPaymentComponentKind;
  amountPence: number;
  destination: "cash" | "pension" | "employer-paid" | "non-cash";
  incomeTax: "payroll" | "section-403-threshold" | "exempt" | "unsupported";
  employeeNationalInsurance: "class-1" | "none" | "unsupported";
  ruleId: string;
};

export type TerminationPaymentCalculation = {
  available: boolean;
  reasons: string[];
  treatments: TerminationPaymentTreatment[];
  cashGrossPence: number;
  taxablePayrollPence: number;
  section403AwardPence: number;
  section403TaxFreePence: number;
  employerPensionContributionPence: number;
  knownDeductionsPence: number;
  netCashPence: number | null;
  lineage: {
    calculationVersion: "termination-payment-v1";
    ruleSetId: typeof TERMINATION_PAYMENT_RULESET.id;
    ruleSetVersion: typeof TERMINATION_PAYMENT_RULESET.version;
    sourceIds: string[];
  };
};

const sum = (amounts: readonly number[]) =>
  amounts.reduce((total, amount) => total + amount, 0);

function treatmentFor(
  component: z.infer<typeof TerminationPaymentComponentSchema>,
): TerminationPaymentTreatment {
  const base = {
    componentId: component.id,
    kind: component.kind,
    amountPence: component.amountPence,
  };
  switch (component.kind) {
    case "statutory-redundancy":
    case "enhanced-redundancy":
      return {
        ...base,
        destination: "cash",
        incomeTax: "section-403-threshold",
        employeeNationalInsurance: "none",
        ruleId: "section-403-award",
      };
    case "unpaid-wages":
    case "holiday-pay":
    case "bonus":
    case "contractual-payment-in-lieu-of-notice":
    case "post-employment-notice-pay":
    case "restrictive-covenant":
      return {
        ...base,
        destination: "cash",
        incomeTax: "payroll",
        employeeNationalInsurance: "class-1",
        ruleId: "payroll-earnings",
      };
    case "employer-pension-contribution":
      return {
        ...base,
        destination: "pension",
        incomeTax: "exempt",
        employeeNationalInsurance: "none",
        ruleId: "registered-pension-contribution",
      };
    case "employer-paid-legal-costs":
      return {
        ...base,
        destination: "employer-paid",
        incomeTax: "exempt",
        employeeNationalInsurance: "none",
        ruleId: "employer-paid-legal-costs",
      };
    case "injury-disability-award":
      return {
        ...base,
        destination: "cash",
        incomeTax: "unsupported",
        employeeNationalInsurance: "unsupported",
        ruleId: "injury-disability-review-required",
      };
    case "non-cash-benefit":
      return {
        ...base,
        destination: "non-cash",
        incomeTax: "section-403-threshold",
        employeeNationalInsurance: "none",
        ruleId: "non-cash-benefit-review-required",
      };
    case "other":
      return {
        ...base,
        destination: "cash",
        incomeTax: "unsupported",
        employeeNationalInsurance: "unsupported",
        ruleId: "unclassified-component",
      };
  }
}

export function calculateTerminationPayment(
  input: TerminationPaymentCalculationRequest,
): TerminationPaymentCalculation {
  const request = TerminationPaymentCalculationRequestSchema.parse(input);
  const treatments = request.components.map(treatmentFor);
  const reasons: string[] = [];

  if (request.effectiveDate < TERMINATION_PAYMENT_RULESET.effectiveFrom) {
    reasons.push("The payment date predates this reviewed termination-payment rule set.");
  }
  if (request.currency !== "GBP") {
    reasons.push("The reviewed termination-payment calculation supports GBP only.");
  }
  if (
    ![
      "england-and-northern-ireland",
      "scotland",
      "wales",
    ].includes(request.jurisdiction)
  ) {
    reasons.push("The selected jurisdiction is not covered by the reviewed UK rules.");
  }
  if (request.residence !== "full-year-uk") {
    reasons.push("Partial-year and non-UK residence need a manual net amount.");
  }
  if (request.noticeTreatment === "reduced-or-unknown") {
    reasons.push("Reduced or unknown notice can create PENP and needs a manual net amount.");
  }
  if (request.hasOtherTaxInteractions) {
    reasons.push("Other tax interactions need a manual net amount.");
  }
  if (treatments.some(({ incomeTax }) => incomeTax === "payroll")) {
    reasons.push("Payroll-taxable components need employer PAYE deductions or a manual net amount.");
  }
  if (treatments.some(({ incomeTax }) => incomeTax === "unsupported")) {
    reasons.push("An unclassified or fact-dependent award needs a manual net amount.");
  }
  if (treatments.some(({ destination }) => destination === "non-cash")) {
    reasons.push("Non-cash benefits need a manual cash value and tax review.");
  }

  const section403AwardPence = sum(
    treatments
      .filter(({ incomeTax }) => incomeTax === "section-403-threshold")
      .map(({ amountPence }) => amountPence),
  );
  const remainingThresholdPence = Math.max(
    0,
    TERMINATION_PAYMENT_RULESET.section403ThresholdPence -
      request.priorSection403AwardsPence,
  );
  const section403TaxFreePence = Math.min(
    section403AwardPence,
    remainingThresholdPence,
  );
  if (section403AwardPence > section403TaxFreePence) {
    reasons.push("The section 403 award exceeds the remaining GBP 30,000 threshold and needs a manual net amount.");
  }

  const cashGrossPence = sum(
    treatments
      .filter(({ destination }) => destination === "cash")
      .map(({ amountPence }) => amountPence),
  );
  const taxablePayrollPence = sum(
    treatments
      .filter(({ incomeTax }) => incomeTax === "payroll")
      .map(({ amountPence }) => amountPence),
  );
  const employerPensionContributionPence = sum(
    treatments
      .filter(({ destination }) => destination === "pension")
      .map(({ amountPence }) => amountPence),
  );
  if (request.knownDeductionsPence > cashGrossPence) {
    reasons.push("Known deductions exceed the cash components.");
  }

  const available = reasons.length === 0;
  return {
    available,
    reasons: Array.from(new Set(reasons)),
    treatments,
    cashGrossPence,
    taxablePayrollPence,
    section403AwardPence,
    section403TaxFreePence,
    employerPensionContributionPence,
    knownDeductionsPence: request.knownDeductionsPence,
    netCashPence: available
      ? cashGrossPence - request.knownDeductionsPence
      : null,
    lineage: {
      calculationVersion: "termination-payment-v1",
      ruleSetId: TERMINATION_PAYMENT_RULESET.id,
      ruleSetVersion: TERMINATION_PAYMENT_RULESET.version,
      sourceIds: TERMINATION_PAYMENT_RULESET.sources.map(({ id }) => id),
    },
  };
}
