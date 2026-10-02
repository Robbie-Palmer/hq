import assert from "node:assert/strict";
import { z } from "zod";
import {
  datasetVersionSchema,
  isoDateSchema,
  jurisdictionSchema,
  moneyPenceSchema,
  nationalInsuranceCategorySchema,
  payPeriodSchema,
  payeTaxBasisSchema,
  pensionContributionMethodSchema,
  taxYearSchema,
} from "./schema";

export const calculationPrecisionSchema = z.enum([
  "annual-liability-estimate",
  "exact-payroll-deduction",
]);

export const validationCoverageSchema = z.enum([
  "tax-band-boundary",
  "allowance-taper",
  "scottish-rates",
  ...pensionContributionMethodSchema.options,
  "employer-and-employee-pension-contributions",
  "bonus",
  "job-change",
  "partial-year",
  "national-insurance-category",
  "national-insurance-within-year-change",
  "pay-frequency",
  "cumulative-paye",
  "non-cumulative-paye",
  "tax-code",
  "hmrc-rounding",
  "unsupported-input",
]);

export const calculationComponentsSchema = z.object({
  grossCashPayPence: moneyPenceSchema,
  taxablePayPence: moneyPenceSchema,
  incomeTaxPence: moneyPenceSchema,
  employeeNationalInsurancePence: moneyPenceSchema,
  memberPensionDeductionPence: moneyPenceSchema,
  employerPensionContributionPence: moneyPenceSchema,
  providerTaxReliefPence: moneyPenceSchema,
  takeHomePayPence: moneyPenceSchema,
});
const componentSchema = calculationComponentsSchema.keyof();

const unsupportedReasonSchema = z.enum([
  "missing-prior-payroll-state",
  "unsupported-national-insurance-category",
  "unsupported-pay-frequency",
  "unsupported-tax-code",
]);

const fixtureSourceSchema = z.object({
  sourceId: z.string().min(1),
  locator: z.string().min(1),
});

const payrollInputSchema = z.object({
  frequency: z.union([z.literal("annual"), payPeriodSchema]),
  periodNumber: z.number().int().positive().nullable(),
  taxCode: z.string().min(1).nullable(),
  taxBasis: payeTaxBasisSchema.nullable(),
  priorGrossPayPence: moneyPenceSchema.nullable(),
  priorIncomeTaxPence: moneyPenceSchema.nullable(),
  nationalInsuranceCategory: nationalInsuranceCategorySchema,
  employmentStartDate: isoDateSchema,
  employmentEndDate: isoDateSchema.nullable(),
  jobChangedDuringTaxYear: z.boolean(),
});

const pensionInputSchema = z.object({
  method: pensionContributionMethodSchema,
  grossContributionPence: moneyPenceSchema,
  memberDeductionPence: moneyPenceSchema,
  employerContributionPence: moneyPenceSchema,
  providerTaxReliefPence: moneyPenceSchema,
});

const fixtureInputSchema = z.object({
  contractualGrossPayPence: moneyPenceSchema,
  cashPayPence: moneyPenceSchema,
  taxablePayPence: moneyPenceSchema,
  nationalInsuranceEarningsPence: moneyPenceSchema,
  payroll: payrollInputSchema,
  pension: pensionInputSchema.nullable(),
});

const supportedExpectationSchema = z.object({
  supported: z.literal(true),
  precision: calculationPrecisionSchema,
  components: calculationComponentsSchema,
  rounding: z.array(
    z.object({
      component: componentSchema,
      rule: z.string().min(1),
    }),
  ),
});

const unsupportedExpectationSchema = z.object({
  supported: z.literal(false),
  reasons: z.array(
    z.object({
      code: unsupportedReasonSchema,
      detail: z.string().min(1),
    }),
  ).min(1),
});

const validationFixtureSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  taxYear: taxYearSchema,
  jurisdiction: jurisdictionSchema,
  effectiveDate: isoDateSchema,
  coverage: z.array(validationCoverageSchema).min(1),
  sources: z.array(fixtureSourceSchema).min(1),
  input: fixtureInputSchema,
  expected: z.discriminatedUnion("supported", [
    supportedExpectationSchema,
    unsupportedExpectationSchema,
  ]),
});

export const validationCorpusSchema = z.object({
  corpusVersion: datasetVersionSchema,
  libraryVersion: z.string().min(1),
  ruleDatasetVersion: datasetVersionSchema,
  calculationContractVersion: z.string().min(1),
  releasedAt: isoDateSchema,
  syntheticDataOnly: z.literal(true),
  sources: z.array(
    z.object({
      id: z.string().min(1),
      title: z.string().min(1),
      publisher: z.string().min(1),
      url: z.url(),
      retrievedAt: isoDateSchema,
      snapshotPath: z.string().min(1),
    }),
  ).min(1),
  fixtures: z.array(validationFixtureSchema).min(1),
});

export type ValidationCorpus = z.infer<typeof validationCorpusSchema>;
export type ValidationFixture = z.infer<typeof validationFixtureSchema>;
export type CalculationComponents = z.infer<typeof calculationComponentsSchema>;
export type CalculationPrecision = z.infer<typeof calculationPrecisionSchema>;

const requiredCoverage = validationCoverageSchema.options;

export function validateValidationCorpus(input: unknown): ValidationCorpus {
  const corpus = validationCorpusSchema.parse(input);
  const sourceIds = new Set(corpus.sources.map(({ id }) => id));
  assert(sourceIds.size === corpus.sources.length, "Validation source IDs must be unique");
  for (const source of corpus.sources) {
    assert(
      new URL(source.url).hostname.endsWith("gov.uk"),
      `${source.id} is not an official government source`,
    );
  }

  const fixtureIds = new Set(corpus.fixtures.map(({ id }) => id));
  assert(fixtureIds.size === corpus.fixtures.length, "Validation fixture IDs must be unique");

  const covered = new Set(corpus.fixtures.flatMap(({ coverage }) => coverage));
  for (const area of requiredCoverage) {
    assert(covered.has(area), `Validation corpus does not cover ${area}`);
  }

  for (const fixture of corpus.fixtures) {
    for (const source of fixture.sources) {
      assert(sourceIds.has(source.sourceId), `${fixture.id} references unknown source ${source.sourceId}`);
    }
    if (fixture.expected.supported) {
      const exact = fixture.expected.precision === "exact-payroll-deduction";
      assert(
        exact === (fixture.input.payroll.frequency !== "annual"),
        `${fixture.id} precision does not match its pay frequency`,
      );
      if (exact) {
        assert(fixture.expected.rounding.length > 0, `${fixture.id} has no payroll rounding rule`);
      }
      const expected = fixture.expected.components;
      assert(
        expected.grossCashPayPence === fixture.input.cashPayPence,
        `${fixture.id} expected cash pay does not match its input`,
      );
      assert(
        expected.taxablePayPence === fixture.input.taxablePayPence,
        `${fixture.id} expected taxable pay does not match its input`,
      );
      assert(
        expected.memberPensionDeductionPence ===
          (fixture.input.pension?.memberDeductionPence ?? 0),
        `${fixture.id} expected member pension deduction does not match its input`,
      );
      assert(
        expected.employerPensionContributionPence ===
          (fixture.input.pension?.employerContributionPence ?? 0),
        `${fixture.id} expected employer pension contribution does not match its input`,
      );
      assert(
        expected.providerTaxReliefPence ===
          (fixture.input.pension?.providerTaxReliefPence ?? 0),
        `${fixture.id} expected provider relief does not match its input`,
      );
      assert(
        expected.takeHomePayPence ===
          expected.grossCashPayPence -
            expected.incomeTaxPence -
            expected.employeeNationalInsurancePence -
            expected.memberPensionDeductionPence,
        `${fixture.id} take-home pay does not reconcile`,
      );
    } else {
      assert(
        fixture.coverage.includes("unsupported-input"),
        `${fixture.id} is unsupported without the unsupported-input coverage tag`,
      );
    }
  }
  return corpus;
}

export type ValidationCandidate =
  | {
      supported: true;
      libraryVersion: string;
      ruleDatasetVersion: string;
      calculationVersion: string;
      precision: CalculationPrecision;
      components: CalculationComponents;
    }
  | {
      supported: false;
      libraryVersion: string;
      ruleDatasetVersion: string;
      calculationVersion: string;
      reasons: string[];
    };

export type ValidationMismatch = {
  component: string;
  expected: string | number | boolean;
  actual: string | number | boolean;
  detail: string;
};

export type ValidationResult = {
  fixtureId: string;
  passed: boolean;
  mismatches: ValidationMismatch[];
};

type AddMismatch = (
  component: string,
  expected: string | number | boolean,
  actual: string | number | boolean,
  detail: string,
) => void;

function compareVersions(
  candidate: ValidationCandidate,
  corpus: Pick<
    ValidationCorpus,
    "libraryVersion" | "ruleDatasetVersion" | "calculationContractVersion"
  >,
  mismatch: AddMismatch,
) {
  if (candidate.libraryVersion !== corpus.libraryVersion) {
    mismatch(
      "libraryVersion",
      corpus.libraryVersion,
      candidate.libraryVersion,
      "The candidate used a different library build.",
    );
  }
  if (candidate.ruleDatasetVersion !== corpus.ruleDatasetVersion) {
    mismatch(
      "ruleDatasetVersion",
      corpus.ruleDatasetVersion,
      candidate.ruleDatasetVersion,
      "The candidate used different rule data.",
    );
  }
  if (candidate.calculationVersion !== corpus.calculationContractVersion) {
    mismatch(
      "calculationVersion",
      corpus.calculationContractVersion,
      candidate.calculationVersion,
      "The candidate used a different calculation contract.",
    );
  }
}

function compareUnsupported(
  expected: Extract<ValidationFixture["expected"], { supported: false }>,
  candidate: ValidationCandidate,
  mismatch: AddMismatch,
) {
  if (candidate.supported) {
    mismatch(
      "support",
      false,
      true,
      "The candidate calculated an input that this contract requires it to reject.",
    );
    return;
  }
  const actualReasons = new Set(candidate.reasons);
  for (const reason of expected.reasons) {
    if (!actualReasons.has(reason.code)) {
      mismatch(
        "unsupportedReason",
        reason.code,
        candidate.reasons.join(", "),
        reason.detail,
      );
    }
  }
}

function compareSupported(
  expected: Extract<ValidationFixture["expected"], { supported: true }>,
  candidate: ValidationCandidate & { supported: true },
  mismatch: AddMismatch,
) {
  if (candidate.precision !== expected.precision) {
    mismatch(
      "precision",
      expected.precision,
      candidate.precision,
      "An annual estimate cannot satisfy an exact payroll fixture.",
    );
  }
  for (const component of componentSchema.options) {
    const expectedValue = expected.components[component];
    const actual = candidate.components[component];
    if (actual !== expectedValue) {
      mismatch(
        component,
        expectedValue,
        actual,
        `${component} differs by ${actual - expectedValue} pence.`,
      );
    }
  }
}

export function evaluateValidationFixture(
  fixture: ValidationFixture,
  candidate: ValidationCandidate,
  corpus: Pick<
    ValidationCorpus,
    "libraryVersion" | "ruleDatasetVersion" | "calculationContractVersion"
  >,
): ValidationResult {
  const mismatches: ValidationMismatch[] = [];
  const mismatch = (
    component: string,
    expected: string | number | boolean,
    actual: string | number | boolean,
    detail: string,
  ) => mismatches.push({ component, expected, actual, detail });

  compareVersions(candidate, corpus, mismatch);

  if (!fixture.expected.supported) {
    compareUnsupported(fixture.expected, candidate, mismatch);
    return { fixtureId: fixture.id, passed: mismatches.length === 0, mismatches };
  }

  if (!candidate.supported) {
    mismatch(
      "support",
      true,
      false,
      `Candidate rejected a supported fixture: ${candidate.reasons.join(", ")}`,
    );
    return { fixtureId: fixture.id, passed: false, mismatches };
  }

  compareSupported(fixture.expected, candidate, mismatch);

  return { fixtureId: fixture.id, passed: mismatches.length === 0, mismatches };
}
