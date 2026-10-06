import {
  calculateHistoricalSalary,
  type HistoricalSalaryResult,
  type Jurisdiction,
  type PensionContributionMethod,
  ruleDataset,
} from "finance-tax-rules/historical-salary";
import type {
  PensionContribution,
  SalaryHistoryRecord,
  SalaryPayFrequency,
} from "./salaryHistory";

type CalculationReason = { code: string; detail: string };

export type SalaryPeriodCalculation = {
  id: string;
  recordId: string;
  person: string;
  employer: string;
  employmentId: string;
  taxYear: string;
  effectiveFrom: string;
  effectiveTo: string;
  amountBasis: "annual" | "pay-period";
  result: HistoricalSalaryResult;
  observations: {
    incomeTaxPence: number | null;
    employeeNationalInsurancePence: number | null;
    takeHomePayPence: number | null;
  };
  reconciliation: {
    incomeTaxVariancePence: number | null;
    employeeNationalInsuranceVariancePence: number | null;
    takeHomePayVariancePence: number | null;
  } | null;
  notes: string[];
};

export type NoPensionSalaryPeriodCalculation = Omit<
  SalaryPeriodCalculation,
  "reconciliation" | "result"
> & {
  scenario: "hypothetical-no-employee-pension";
  baselineResult: HistoricalSalaryResult;
  result: HistoricalSalaryResult;
  comparison: {
    grossCashPayChangePence: number;
    incomeTaxChangePence: number;
    employeeNationalInsuranceChangePence: number;
    foregoneEmployeeContributionPence: number;
    employerPensionContributionPence: number;
    takeHomePayChangePence: number;
  } | null;
};

const PERIODS_PER_YEAR: Record<SalaryPayFrequency, number | null> = {
  weekly: 52,
  fortnightly: 26,
  fourWeekly: 13,
  monthly: 12,
  quarterly: 4,
  annual: 1,
  irregular: null,
};

function taxYearForDate(date: string): string {
  const year = Number(date.slice(0, 4));
  const startYear = date.slice(5) < "04-06" ? year - 1 : year;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

function taxYearRange(taxYear: string): { from: string; to: string } {
  const startYear = Number(taxYear.slice(0, 4));
  return { from: `${startYear}-04-06`, to: `${startYear + 1}-04-05` };
}

function nextTaxYear(taxYear: string): string {
  const next = Number(taxYear.slice(0, 4)) + 1;
  return `${next}-${String((next + 1) % 100).padStart(2, "0")}`;
}

function recordTaxYearSegments(
  record: SalaryHistoryRecord,
  asOf: string,
): Array<{ taxYear: string; from: string; to: string }> {
  const finalDate = record.effectiveEnd ?? asOf;
  const segments: Array<{ taxYear: string; from: string; to: string }> = [];
  let taxYear = taxYearForDate(record.effectiveStart);
  while (
    Number(taxYear.slice(0, 4)) <= Number(taxYearForDate(finalDate).slice(0, 4))
  ) {
    const range = taxYearRange(taxYear);
    const from =
      record.effectiveStart > range.from ? record.effectiveStart : range.from;
    const to = finalDate < range.to ? finalDate : range.to;
    if (from <= to) segments.push({ taxYear, from, to });
    taxYear = nextTaxYear(taxYear);
  }
  return segments;
}

function previousDate(date: string): string {
  const previous = new Date(`${date}T00:00:00Z`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  return previous.toISOString().slice(0, 10);
}

function splitAtRuleChanges(segment: {
  taxYear: string;
  from: string;
  to: string;
}): Array<{ taxYear: string; from: string; to: string }> {
  const rules = [...ruleDataset.nationalInsurance, ...ruleDataset.pensions]
    .filter(
      ({ taxYear, legalStatus, effectiveFrom, effectiveTo }) =>
        taxYear === segment.taxYear &&
        legalStatus === "enacted" &&
        effectiveFrom <= segment.to &&
        effectiveTo >= segment.from,
    )
    .toSorted((left, right) =>
      left.effectiveFrom.localeCompare(right.effectiveFrom),
    );
  if (rules.length === 0) return [segment];
  const boundaries = [
    ...new Set([
      segment.from,
      ...rules
        .map(({ effectiveFrom }) => effectiveFrom)
        .filter((date) => date > segment.from && date <= segment.to),
    ]),
  ].toSorted((left, right) => left.localeCompare(right));
  return boundaries.map((from, index) => ({
    taxYear: segment.taxYear,
    from,
    to:
      index + 1 < boundaries.length
        ? previousDate(boundaries[index + 1] ?? segment.to)
        : segment.to,
  }));
}

function jurisdiction(value: string): Jurisdiction | null {
  const normalised = value
    .trim()
    .toLocaleLowerCase("en-GB")
    .replaceAll("&", "and")
    .replace(/\s+/g, " ");
  if (normalised === "scotland") return "scotland";
  if (normalised === "wales") return "wales";
  if (
    normalised === "england" ||
    normalised === "northern ireland" ||
    normalised === "england and wales" ||
    normalised === "england and northern ireland"
  ) {
    return "england-and-northern-ireland";
  }
  return null;
}

function annualMultiplier(record: SalaryHistoryRecord): number | null {
  if (record.amountKind === "annualSalary") return 1;
  return PERIODS_PER_YEAR[record.payFrequency];
}

function annualMoney(
  value: number | undefined,
  multiplier: number,
): number | undefined {
  return value == null ? undefined : Math.round(value * multiplier * 100);
}

function contributionAmount(
  contribution: PensionContribution | undefined,
  record: SalaryHistoryRecord,
  multiplier: number,
  label: string,
): { amountPence?: number; reasons: CalculationReason[] } {
  if (contribution == null) {
    return {
      reasons: [
        {
          code: `missing-${label}-pension`,
          detail: `Confirm whether the ${label} pension contribution was zero or enter its amount.`,
        },
      ],
    };
  }
  if (contribution.arrangement === "none") {
    return { amountPence: 0, reasons: [] };
  }
  if (
    contribution.arrangement === "unknown" ||
    (label === "employee" && contribution.arrangement === "other")
  ) {
    return {
      reasons: [
        {
          code: `unsupported-${label}-pension-method`,
          detail: `The ${label} pension method must be salary sacrifice, net pay, relief at source, or explicitly none.`,
        },
      ],
    };
  }
  if (contribution.amount != null) {
    return {
      amountPence: Math.round(contribution.amount * multiplier * 100),
      reasons: [],
    };
  }
  if (contribution.rate == null) {
    return {
      reasons: [
        {
          code: `missing-${label}-pension-value`,
          detail: `Enter the ${label} pension amount or rate.`,
        },
      ],
    };
  }
  if (contribution.basis === "qualifyingEarnings") {
    return {
      reasons: [
        {
          code: "unsupported-qualifying-earnings",
          detail:
            "Qualifying-earnings pension bands are not included in the reviewed historical rule set.",
        },
      ],
    };
  }
  if (contribution.basis === "unknown") {
    return {
      reasons: [
        {
          code: `missing-${label}-pension-basis`,
          detail: `Choose the pay basis for the ${label} pension rate.`,
        },
      ],
    };
  }
  const basis =
    contribution.basis === "grossPay" ? record.grossPay : record.baseSalary;
  if (basis == null) {
    return {
      reasons: [
        {
          code: `missing-${label}-pensionable-pay`,
          detail: `Enter pensionable pay before using a ${label} pensionable-pay rate.`,
        },
      ],
    };
  }
  return {
    amountPence: Math.round(basis * multiplier * contribution.rate * 100),
    reasons: [],
  };
}

function unavailable(reasons: CalculationReason[]): HistoricalSalaryResult {
  return { available: false, reasons };
}

function buildPension(
  record: SalaryHistoryRecord,
  multiplier: number,
): {
  pension: {
    method: PensionContributionMethod;
    employeeGrossContributionPence: number;
    employeeCashDeductionPence: number;
    salarySacrificePence: number;
    employerContributionPence: number;
    providerTaxReliefPence: number;
  } | null;
  reasons: CalculationReason[];
} {
  const employee = contributionAmount(
    record.employeePension,
    record,
    multiplier,
    "employee",
  );
  const employer = contributionAmount(
    record.employerPension,
    record,
    multiplier,
    "employer",
  );
  const reasons = [...employee.reasons, ...employer.reasons];
  if (reasons.length > 0) return { pension: null, reasons };
  const employeeAmount = employee.amountPence ?? 0;
  const employerAmount = employer.amountPence ?? 0;
  if (record.employeePension?.arrangement === "none") {
    return {
      pension:
        employerAmount === 0
          ? null
          : {
              method: "net-pay",
              employeeGrossContributionPence: 0,
              employeeCashDeductionPence: 0,
              salarySacrificePence: 0,
              employerContributionPence: employerAmount,
              providerTaxReliefPence: 0,
            },
      reasons: [],
    };
  }
  const methodMap = {
    salarySacrifice: "salary-sacrifice",
    netPay: "net-pay",
    reliefAtSource: "relief-at-source",
  } as const;
  const arrangement = record.employeePension?.arrangement;
  if (
    arrangement !== "salarySacrifice" &&
    arrangement !== "netPay" &&
    arrangement !== "reliefAtSource"
  ) {
    return {
      pension: null,
      reasons: [
        {
          code: "unsupported-employee-pension-method",
          detail: "The employee pension method is not supported.",
        },
      ],
    };
  }
  const grossEmployee =
    arrangement === "reliefAtSource"
      ? Math.round(employeeAmount / 0.8)
      : employeeAmount;
  const providerRelief =
    arrangement === "reliefAtSource" ? grossEmployee - employeeAmount : 0;
  return {
    pension: {
      method: methodMap[arrangement],
      employeeGrossContributionPence: grossEmployee,
      employeeCashDeductionPence:
        arrangement === "salarySacrifice" ? 0 : employeeAmount,
      salarySacrificePence:
        arrangement === "salarySacrifice" ? employeeAmount : 0,
      employerContributionPence: employerAmount,
      providerTaxReliefPence: providerRelief,
    },
    reasons: [],
  };
}

function buildNoEmployeePension(
  record: SalaryHistoryRecord,
  multiplier: number,
): ReturnType<typeof buildPension> {
  const employer = contributionAmount(
    record.employerPension,
    record,
    multiplier,
    "employer",
  );
  if (employer.reasons.length > 0) {
    return { pension: null, reasons: employer.reasons };
  }
  const employerAmount = employer.amountPence ?? 0;
  return {
    pension:
      employerAmount === 0
        ? null
        : {
            method: "net-pay",
            employeeGrossContributionPence: 0,
            employeeCashDeductionPence: 0,
            salarySacrificePence: 0,
            employerContributionPence: employerAmount,
            providerTaxReliefPence: 0,
          },
    reasons: [],
  };
}

function inputReasons(record: SalaryHistoryRecord): CalculationReason[] {
  const reasons: CalculationReason[] = [];
  if (record.currency !== "GBP") {
    reasons.push({
      code: "unsupported-currency",
      detail: "Historical UK salary calculations require GBP salary facts.",
    });
  }
  if (jurisdiction(record.jurisdiction) == null) {
    reasons.push({
      code: "unsupported-jurisdiction",
      detail:
        "Choose England, Northern Ireland, Scotland, or Wales. A generic UK value is not enough to select Income Tax bands.",
    });
  }
  if (record.otherTaxableIncome == null) {
    reasons.push({
      code: "missing-other-income",
      detail:
        "Enter other annual taxable income, including zero, so Personal Allowance tapering is not guessed.",
    });
  }
  if (record.otherDeductions == null) {
    reasons.push({
      code: "missing-other-deductions",
      detail:
        "Enter other deductions, including zero, before estimating take-home pay.",
    });
  }
  if (record.nationalInsuranceCategory == null) {
    reasons.push({
      code: "missing-ni-category",
      detail: "Enter the National Insurance category shown on the payslip.",
    });
  } else if (record.nationalInsuranceCategory.toUpperCase() !== "A") {
    reasons.push({
      code: "unsupported-ni-category",
      detail: `National Insurance category ${record.nationalInsuranceCategory} is not supported.`,
    });
  }
  if (record.isCompanyDirector == null) {
    reasons.push({
      code: "missing-director-status",
      detail: "Confirm whether this employment was as a company director.",
    });
  } else if (record.isCompanyDirector) {
    reasons.push({
      code: "unsupported-director-ni",
      detail: "Company directors need an annual National Insurance method.",
    });
  }
  return reasons;
}

function observedPence(
  value: number | undefined,
  multiplier: number,
): number | null {
  return value == null ? null : Math.round(value * multiplier * 100);
}

function variance(estimate: number, observation: number | null): number | null {
  return observation == null ? null : estimate - observation;
}

function calculateResult(
  record: SalaryHistoryRecord,
  segment: { taxYear: string; from: string; to: string },
  multiplier: number | null,
  pension: ReturnType<typeof buildPension>,
  reasons: CalculationReason[],
  scenarioAssumptions: Array<{
    id: string;
    value: string | number | boolean;
  }> = [],
): HistoricalSalaryResult {
  const selectedJurisdiction = jurisdiction(record.jurisdiction);
  if (
    reasons.length > 0 ||
    multiplier == null ||
    selectedJurisdiction == null
  ) {
    return unavailable(reasons);
  }
  return calculateHistoricalSalary({
    effectiveDate: segment.from,
    taxYear: segment.taxYear,
    jurisdiction: selectedJurisdiction,
    contractualGrossPayPence: Math.round(record.grossPay * multiplier * 100),
    otherTaxableIncomePence: annualMoney(record.otherTaxableIncome, 1) ?? 0,
    otherDeductionsPence: annualMoney(record.otherDeductions, multiplier) ?? 0,
    nationalInsuranceCategory: "A",
    isCompanyDirector: false,
    pension: pension.pension,
    assumptions: [
      { id: "salary-fact", value: `${record.id}:${record.acceptedAt}` },
      {
        id: "other-taxable-income-pence",
        value: annualMoney(record.otherTaxableIncome, 1) ?? 0,
      },
      {
        id: "other-deductions-pence",
        value: annualMoney(record.otherDeductions, multiplier) ?? 0,
      },
      {
        id: "national-insurance-category",
        value: record.nationalInsuranceCategory ?? "unknown",
      },
      {
        id: "company-director",
        value: record.isCompanyDirector ?? "unknown",
      },
      ...(record.taxCode == null
        ? []
        : [{ id: "observed-tax-code", value: record.taxCode }]),
      ...scenarioAssumptions,
    ],
  });
}

function calculationObservations(
  record: SalaryHistoryRecord,
  multiplier: number,
): SalaryPeriodCalculation["observations"] {
  return {
    incomeTaxPence: observedPence(record.observedIncomeTax, multiplier),
    employeeNationalInsurancePence: observedPence(
      record.observedEmployeeNationalInsurance,
      multiplier,
    ),
    takeHomePayPence: observedPence(record.takeHomePay, multiplier),
  };
}

function reconcileCalculation(
  result: HistoricalSalaryResult,
  observations: SalaryPeriodCalculation["observations"],
): SalaryPeriodCalculation["reconciliation"] {
  if (!result.available) return null;
  return {
    incomeTaxVariancePence: variance(
      result.components.incomeTaxPence,
      observations.incomeTaxPence,
    ),
    employeeNationalInsuranceVariancePence: variance(
      result.components.employeeNationalInsurancePence,
      observations.employeeNationalInsurancePence,
    ),
    takeHomePayVariancePence: variance(
      result.components.takeHomePayPence,
      observations.takeHomePayPence,
    ),
  };
}

function calculationNotes(
  record: SalaryHistoryRecord,
  multiplier: number | null,
  multipleEmployment: boolean,
): string[] {
  const notes = [
    record.amountKind === "periodPay"
      ? `Actual ${record.payFrequency} pay is annualised across ${multiplier ?? "an unknown number of"} periods.`
      : "The figure is an annual salary-rate estimate, not prorated earnings.",
  ];
  if (record.taxCode != null) {
    notes.push(
      `Tax code ${record.taxCode} is preserved as an observation but is not used in the annual liability estimate.`,
    );
  }
  if (multipleEmployment) {
    notes.push(
      "Another employment overlaps this tax year. The other-income assumption must include taxable pay from that employment.",
    );
  }
  return notes;
}

function calculateSegment(
  record: SalaryHistoryRecord,
  segment: { taxYear: string; from: string; to: string },
  multipleEmployment: boolean,
): SalaryPeriodCalculation {
  const multiplier = annualMultiplier(record);
  const reasons = inputReasons(record);
  if (multiplier == null) {
    reasons.push({
      code: "unsupported-pay-frequency",
      detail:
        "Irregular pay cannot be annualised without a user-supplied period.",
    });
  }
  const pension =
    multiplier == null
      ? { pension: null, reasons: [] }
      : buildPension(record, multiplier);
  reasons.push(...pension.reasons);
  const result = calculateResult(record, segment, multiplier, pension, reasons);
  const observations = calculationObservations(record, multiplier ?? 1);
  const reconciliation = reconcileCalculation(result, observations);
  const notes = calculationNotes(record, multiplier, multipleEmployment);
  return {
    id: `${record.id}:${segment.from}:${segment.to}`,
    recordId: record.id,
    person: record.person,
    employer: record.employer,
    employmentId: record.employmentId,
    taxYear: segment.taxYear,
    effectiveFrom: segment.from,
    effectiveTo: segment.to,
    amountBasis: record.amountKind === "periodPay" ? "pay-period" : "annual",
    result,
    observations,
    reconciliation,
    notes,
  };
}

function noPensionComparison(
  baseline: HistoricalSalaryResult,
  scenario: HistoricalSalaryResult,
): NoPensionSalaryPeriodCalculation["comparison"] {
  if (!(baseline.available && scenario.available)) return null;
  return {
    grossCashPayChangePence:
      scenario.components.grossCashPayPence -
      baseline.components.grossCashPayPence,
    incomeTaxChangePence:
      scenario.components.incomeTaxPence - baseline.components.incomeTaxPence,
    employeeNationalInsuranceChangePence:
      scenario.components.employeeNationalInsurancePence -
      baseline.components.employeeNationalInsurancePence,
    foregoneEmployeeContributionPence:
      baseline.components.employeePensionContributionPence,
    employerPensionContributionPence:
      scenario.components.employerPensionContributionPence,
    takeHomePayChangePence:
      scenario.components.takeHomePayPence -
      baseline.components.takeHomePayPence,
  };
}

function calculateNoPensionSegment(
  record: SalaryHistoryRecord,
  segment: { taxYear: string; from: string; to: string },
  multipleEmployment: boolean,
): NoPensionSalaryPeriodCalculation {
  const baseline = calculateSegment(record, segment, multipleEmployment);
  const multiplier = annualMultiplier(record);
  const reasons = inputReasons(record);
  if (multiplier == null) {
    reasons.push({
      code: "unsupported-pay-frequency",
      detail:
        "Irregular pay cannot be annualised without a user-supplied period.",
    });
  }
  const pension =
    multiplier == null
      ? { pension: null, reasons: [] }
      : buildNoEmployeePension(record, multiplier);
  reasons.push(...pension.reasons);
  const result = calculateResult(
    record,
    segment,
    multiplier,
    pension,
    reasons,
    [
      { id: "scenario", value: "hypothetical-no-employee-pension" },
      { id: "employee-pension-contribution-pence", value: 0 },
      { id: "salary-sacrifice-pence", value: 0 },
    ],
  );
  return {
    ...baseline,
    scenario: "hypothetical-no-employee-pension",
    baselineResult: baseline.result,
    result,
    comparison: noPensionComparison(baseline.result, result),
    notes: [
      ...baseline.notes,
      "Hypothetical scenario: employee pension contributions and salary sacrifice are zero. Employer pension remains outside spendable pay.",
    ],
  };
}

function overlaps(
  left: SalaryHistoryRecord,
  right: SalaryHistoryRecord,
): boolean {
  const leftEnd = left.effectiveEnd ?? "9999-12-31";
  const rightEnd = right.effectiveEnd ?? "9999-12-31";
  return left.effectiveStart <= rightEnd && right.effectiveStart <= leftEnd;
}

function hasMultipleEmployment(
  record: SalaryHistoryRecord,
  records: readonly SalaryHistoryRecord[],
): boolean {
  return records.some(
    (candidate) =>
      candidate.id !== record.id &&
      candidate.person === record.person &&
      candidate.employmentId !== record.employmentId &&
      overlaps(record, candidate),
  );
}

export function calculateSalaryHistory(
  records: readonly SalaryHistoryRecord[],
  asOf = new Date().toISOString().slice(0, 10),
): SalaryPeriodCalculation[] {
  return records.flatMap((record) =>
    recordTaxYearSegments(record, asOf)
      .flatMap(splitAtRuleChanges)
      .map((segment) =>
        calculateSegment(
          record,
          segment,
          hasMultipleEmployment(record, records),
        ),
      ),
  );
}

export function calculateNoPensionSalaryHistory(
  records: readonly SalaryHistoryRecord[],
  asOf = new Date().toISOString().slice(0, 10),
): NoPensionSalaryPeriodCalculation[] {
  return records.flatMap((record) =>
    recordTaxYearSegments(record, asOf)
      .flatMap(splitAtRuleChanges)
      .map((segment) =>
        calculateNoPensionSegment(
          record,
          segment,
          hasMultipleEmployment(record, records),
        ),
      ),
  );
}
