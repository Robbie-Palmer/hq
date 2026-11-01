import {
  calculateHistoricalSalary,
  type HistoricalSalaryResult,
  type Jurisdiction,
  type PensionContributionMethod,
  ruleDataset,
} from "finance-tax-rules/historical-salary";
import {
  calculateWorkplacePension,
  type WorkplacePensionContributionBasis,
  type WorkplacePensionEmployeeContribution,
  type WorkplacePensionEmployerPolicy,
} from "finance-tax-rules/workplace-pension";
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
  employerPension: {
    contributionPence: number | null;
    unavailableReasons: CalculationReason[];
  };
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

const nationalInsurancePayPeriod = {
  weekly: "weekly",
  fortnightly: "fortnightly",
  fourWeekly: "four-weekly",
  monthly: "monthly",
  quarterly: "quarterly",
  annual: "annual",
  irregular: null,
} as const;

function distributedPeriods(total: number, periods: number): number[] {
  const base = Math.floor(total / periods);
  const remainder = total - base * periods;
  return Array.from(
    { length: periods },
    (_, index) => base + (index < remainder ? 1 : 0),
  );
}

function nationalInsurancePeriods(
  record: SalaryHistoryRecord,
  multiplier: number,
  pension: ReturnType<typeof buildPension>,
  oneOffGrossPay: number,
) {
  const payPeriod = nationalInsurancePayPeriod[record.payFrequency];
  const periods = PERIODS_PER_YEAR[record.payFrequency];
  if (payPeriod == null || periods == null || record.grossPay == null) {
    return undefined;
  }
  const regularPayPence = Math.round(record.grossPay * multiplier * 100);
  const earnings = distributedPeriods(regularPayPence, periods);
  if (oneOffGrossPay > 0) {
    earnings[0] = (earnings[0] ?? 0) + Math.round(oneOffGrossPay * 100);
  }
  const sacrifice =
    pension.pension?.salarySacrificeByPeriodPence ?? earnings.map(() => 0);
  return {
    payPeriod,
    postSacrificeEarningsPence: earnings.map((amount, index) =>
      Math.max(0, amount - (sacrifice[index] ?? 0)),
    ),
  };
}

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

const pensionPayPeriod = {
  weekly: "weekly",
  fortnightly: "fortnightly",
  fourWeekly: "four-weekly",
  monthly: "monthly",
  quarterly: "quarterly",
  annual: "annual",
  irregular: null,
} as const;

function needsQualifyingEarningsPeriod(
  employee: WorkplacePensionEmployeeContribution,
  employer: WorkplacePensionEmployerPolicy,
): boolean {
  return (
    (employee.kind === "percentage" &&
      employee.basis === "qualifying-earnings") ||
    ((employer.kind === "flat-rate" || employer.kind === "matching") &&
      employer.basis === "qualifying-earnings")
  );
}

function contributionBasis(
  contribution: PensionContribution,
): WorkplacePensionContributionBasis | null {
  if (contribution.basis === "grossPay") return "gross-pay";
  if (contribution.basis === "qualifyingEarnings") {
    return "qualifying-earnings";
  }
  if (contribution.basis === "pensionablePay") return "pensionable-pay";
  return null;
}

function employeeContribution(
  contribution: PensionContribution | undefined,
  multiplier: number,
): {
  contribution: WorkplacePensionEmployeeContribution;
  reasons: CalculationReason[];
} {
  if (contribution == null) {
    return {
      contribution: { kind: "unknown" },
      reasons: [
        {
          code: "missing-employee-pension",
          detail:
            "Confirm whether the employee pension contribution was zero or enter its amount.",
        },
      ],
    };
  }
  if (contribution.arrangement === "none") {
    return { contribution: { kind: "none" }, reasons: [] };
  }
  if (
    contribution.arrangement === "unknown" ||
    contribution.arrangement === "other"
  ) {
    return {
      contribution: { kind: "unknown" },
      reasons: [
        {
          code: "unsupported-employee-pension-method",
          detail:
            "The employee pension method must be salary sacrifice, net pay, relief at source, or explicitly none.",
        },
      ],
    };
  }
  const taxTreatment = {
    salarySacrifice: "salary-sacrifice",
    netPay: "net-pay",
    reliefAtSource: "relief-at-source",
  } as const;
  if (contribution.amount != null) {
    const cashAmountPence = Math.round(contribution.amount * multiplier * 100);
    return {
      contribution: {
        kind: "explicit-amount",
        taxTreatment: taxTreatment[contribution.arrangement],
        grossAmountPence:
          contribution.arrangement === "reliefAtSource"
            ? Math.round(cashAmountPence / 0.8)
            : cashAmountPence,
      },
      reasons: [],
    };
  }
  if (contribution.rate == null) {
    return {
      contribution: { kind: "unknown" },
      reasons: [
        {
          code: "missing-employee-pension-value",
          detail: "Enter the employee pension amount or rate.",
        },
      ],
    };
  }
  const basis = contributionBasis(contribution);
  if (basis == null) {
    return {
      contribution: { kind: "unknown" },
      reasons: [
        {
          code: "missing-employee-pension-basis",
          detail: "Choose the pay basis for the employee pension rate.",
        },
      ],
    };
  }
  const cashRateBasisPoints = Math.round(contribution.rate * 10_000);
  return {
    contribution: {
      kind: "percentage",
      taxTreatment: taxTreatment[contribution.arrangement],
      basis,
      rateBasisPoints:
        contribution.arrangement === "reliefAtSource"
          ? Math.round(cashRateBasisPoints / 0.8)
          : cashRateBasisPoints,
    },
    reasons: [],
  };
}

function employerPolicy(
  record: SalaryHistoryRecord,
  multiplier: number,
): { policy: WorkplacePensionEmployerPolicy; reasons: CalculationReason[] } {
  if (record.employerPensionPolicy != null) {
    return { policy: record.employerPensionPolicy, reasons: [] };
  }
  const contribution = record.employerPension;
  if (contribution == null) {
    return {
      policy: { kind: "unknown" },
      reasons: [
        {
          code: "missing-employer-pension",
          detail:
            "Confirm whether the employer pension contribution was zero or enter its rule.",
        },
      ],
    };
  }
  if (contribution.arrangement === "none") {
    return { policy: { kind: "none" }, reasons: [] };
  }
  if (contribution.arrangement === "unknown") {
    return {
      policy: { kind: "unknown" },
      reasons: [
        {
          code: "unsupported-employer-pension-method",
          detail:
            "The employer pension rule is unknown. Enter the scheme rule or an explicit amount.",
        },
      ],
    };
  }
  if (contribution.amount != null) {
    return {
      policy: {
        kind: "explicit-amount",
        amountPence: Math.round(contribution.amount * multiplier * 100),
      },
      reasons: [],
    };
  }
  if (contribution.rate == null) {
    return {
      policy: { kind: "unknown" },
      reasons: [
        {
          code: "missing-employer-pension-value",
          detail: "Enter the employer pension amount or rate.",
        },
      ],
    };
  }
  const basis = contributionBasis(contribution);
  if (basis == null) {
    return {
      policy: { kind: "unknown" },
      reasons: [
        {
          code: "missing-employer-pension-basis",
          detail: "Choose the pay basis for the employer pension rate.",
        },
      ],
    };
  }
  return {
    policy: {
      kind: "flat-rate",
      basis,
      rateBasisPoints: Math.round(contribution.rate * 10_000),
      schemeMinimumRateBasisPoints: 0,
    },
    reasons: [],
  };
}

function unavailable(reasons: CalculationReason[]): HistoricalSalaryResult {
  return { available: false, reasons };
}

function buildPension(
  record: SalaryHistoryRecord,
  multiplier: number,
  effectiveDate: string,
  oneOffGrossPay: number,
): {
  pension: {
    method: PensionContributionMethod;
    employeeGrossContributionPence: number;
    employeeCashDeductionPence: number;
    salarySacrificePence: number;
    employerContributionPence: number;
    providerTaxReliefPence: number;
    salarySacrificeByPeriodPence: number[];
  } | null;
  reasons: CalculationReason[];
} {
  const employee = employeeContribution(record.employeePension, multiplier);
  const employer = employerPolicy(record, multiplier);
  const reasons = [...employee.reasons, ...employer.reasons];
  if (reasons.length > 0) return { pension: null, reasons };
  const selectedPeriod = pensionPayPeriod[record.payFrequency];
  if (
    selectedPeriod == null &&
    needsQualifyingEarningsPeriod(employee.contribution, employer.policy)
  ) {
    return {
      pension: null,
      reasons: [
        {
          code: "unsupported-pension-pay-period",
          detail: "Irregular pay needs an explicit pension amount.",
        },
      ],
    };
  }
  if (record.grossPay == null) {
    return {
      pension: null,
      reasons: [
        {
          code: "missing-gross-pay",
          detail: "Pension calculations need gross pay.",
        },
      ],
    };
  }
  const period = selectedPeriod ?? "annual";
  const annualGrossPay = record.grossPay * multiplier + oneOffGrossPay;
  const calculation = calculateWorkplacePension({
    effectiveDate,
    payPeriod: period,
    annualGrossPayPence: Math.round(annualGrossPay * 100),
    annualQualifyingEarningsPayPence: Math.round(annualGrossPay * 100),
    qualifyingEarningsVariablePaymentsPence:
      oneOffGrossPay === 0 ? [] : [Math.round(oneOffGrossPay * 100)],
    annualPensionablePayPence: annualMoney(record.pensionablePay, multiplier),
    employee: employee.contribution,
    employer: employer.policy,
  });
  if (!calculation.available) {
    return { pension: null, reasons: calculation.reasons };
  }
  const method =
    employee.contribution.kind === "explicit-amount" ||
    employee.contribution.kind === "percentage"
      ? employee.contribution.taxTreatment
      : "net-pay";
  const hasContribution =
    calculation.employeeGrossContributionPence > 0 ||
    calculation.employerContributionPence > 0;
  return {
    pension: hasContribution
      ? {
          method,
          employeeGrossContributionPence:
            calculation.employeeGrossContributionPence,
          employeeCashDeductionPence: calculation.employeeCashDeductionPence,
          salarySacrificePence: calculation.salarySacrificePence,
          employerContributionPence: calculation.employerContributionPence,
          providerTaxReliefPence: calculation.providerTaxReliefPence,
          salarySacrificeByPeriodPence:
            calculation.salarySacrificeByPeriodPence,
        }
      : null,
    reasons: [],
  };
}

function buildNoEmployeePension(
  record: SalaryHistoryRecord,
  multiplier: number,
  effectiveDate: string,
  oneOffGrossPay: number,
): ReturnType<typeof buildPension> & {
  employerContributionPence: number | null;
  employerUnavailableReasons: CalculationReason[];
} {
  const employer = employerPolicy(record, multiplier);
  if (employer.reasons.length > 0) {
    return {
      pension: null,
      reasons: [],
      employerContributionPence: null,
      employerUnavailableReasons: employer.reasons,
    };
  }
  const selectedPeriod = pensionPayPeriod[record.payFrequency];
  if (
    selectedPeriod == null &&
    needsQualifyingEarningsPeriod({ kind: "none" }, employer.policy)
  ) {
    const unavailableReasons = [
      {
        code: "unsupported-pension-pay-period",
        detail: "Irregular pay needs an explicit pension amount.",
      },
    ];
    return {
      pension: null,
      reasons: [],
      employerContributionPence: null,
      employerUnavailableReasons: unavailableReasons,
    };
  }
  if (record.grossPay == null) {
    return {
      pension: null,
      reasons: [],
      employerContributionPence: null,
      employerUnavailableReasons: [
        {
          code: "missing-gross-pay",
          detail: "Pension calculations need gross pay.",
        },
      ],
    };
  }
  const period = selectedPeriod ?? "annual";
  const annualGrossPay = record.grossPay * multiplier + oneOffGrossPay;
  const calculation = calculateWorkplacePension({
    effectiveDate,
    payPeriod: period,
    annualGrossPayPence: Math.round(annualGrossPay * 100),
    annualQualifyingEarningsPayPence: Math.round(annualGrossPay * 100),
    qualifyingEarningsVariablePaymentsPence:
      oneOffGrossPay === 0 ? [] : [Math.round(oneOffGrossPay * 100)],
    annualPensionablePayPence: annualMoney(record.pensionablePay, multiplier),
    employee: { kind: "none" },
    employer: employer.policy,
  });
  if (!calculation.available) {
    return {
      pension: null,
      reasons: [],
      employerContributionPence: null,
      employerUnavailableReasons: calculation.reasons,
    };
  }
  const employerAmount = calculation.employerContributionPence;
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
            salarySacrificeByPeriodPence:
              calculation.salarySacrificeByPeriodPence,
          },
    reasons: [],
    employerContributionPence: employerAmount,
    employerUnavailableReasons: [],
  };
}

function inputReasons(record: SalaryHistoryRecord): CalculationReason[] {
  const reasons: CalculationReason[] = [];
  if (record.grossPay == null) {
    return [
      {
        code: "missing-gross-pay",
        detail:
          "Only take-home pay was recorded. Add gross pay later if you want a historical tax calculation.",
      },
    ];
  }
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
  oneOffGrossPay = 0,
  scenarioAssumptions: Array<{
    id: string;
    value: string | number | boolean;
  }> = [],
): HistoricalSalaryResult {
  const selectedJurisdiction = jurisdiction(record.jurisdiction);
  if (
    reasons.length > 0 ||
    multiplier == null ||
    record.grossPay == null ||
    selectedJurisdiction == null
  ) {
    return unavailable(reasons);
  }
  return calculateHistoricalSalary({
    effectiveDate: segment.from,
    taxYear: segment.taxYear,
    jurisdiction: selectedJurisdiction,
    contractualGrossPayPence: Math.round(
      (record.grossPay * multiplier + oneOffGrossPay) * 100,
    ),
    otherTaxableIncomePence: annualMoney(record.otherTaxableIncome, 1) ?? 0,
    otherDeductionsPence: annualMoney(record.otherDeductions, multiplier) ?? 0,
    nationalInsuranceCategory: "A",
    isCompanyDirector: false,
    nationalInsurancePeriods: nationalInsurancePeriods(
      record,
      multiplier,
      pension,
      oneOffGrossPay,
    ),
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
  oneOffGrossPay: number,
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
  if (oneOffGrossPay > 0) {
    notes.push(
      `Includes ${oneOffGrossPay.toLocaleString("en-GB", { style: "currency", currency: record.currency })} of one-off pay recorded in this tax year.`,
    );
  }
  return notes;
}

function calculateSegment(
  record: SalaryHistoryRecord,
  segment: { taxYear: string; from: string; to: string },
  multipleEmployment: boolean,
  oneOffGrossPay: number,
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
    multiplier == null || record.grossPay == null
      ? { pension: null, reasons: [] }
      : buildPension(record, multiplier, segment.from, oneOffGrossPay);
  reasons.push(...pension.reasons);
  const result = calculateResult(
    record,
    segment,
    multiplier,
    pension,
    reasons,
    oneOffGrossPay,
  );
  const observations = calculationObservations(record, multiplier ?? 1);
  const reconciliation = reconcileCalculation(result, observations);
  const notes = calculationNotes(
    record,
    multiplier,
    multipleEmployment,
    oneOffGrossPay,
  );
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
  oneOffGrossPay: number,
): NoPensionSalaryPeriodCalculation {
  const baseline = calculateSegment(
    record,
    segment,
    multipleEmployment,
    oneOffGrossPay,
  );
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
    multiplier == null || record.grossPay == null
      ? {
          pension: null,
          reasons: [],
          employerContributionPence: null,
          employerUnavailableReasons: [],
        }
      : buildNoEmployeePension(
          record,
          multiplier,
          segment.from,
          oneOffGrossPay,
        );
  reasons.push(...pension.reasons);
  const result = calculateResult(
    record,
    segment,
    multiplier,
    pension,
    reasons,
    oneOffGrossPay,
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
    employerPension: {
      contributionPence: pension.employerContributionPence,
      unavailableReasons: pension.employerUnavailableReasons,
    },
    comparison: noPensionComparison(baseline.result, result),
    notes: [
      ...baseline.notes,
      "Hypothetical scenario: employee pension contributions and salary sacrifice are zero. Employer pension remains outside spendable pay.",
    ],
  };
}

function isOneOffPay(record: SalaryHistoryRecord): boolean {
  return (
    record.amountKind === "periodPay" && record.payFrequency === "irregular"
  );
}

function oneOffGrossPayForSegment(
  record: SalaryHistoryRecord,
  segment: { from: string; to: string },
  records: readonly SalaryHistoryRecord[],
): number {
  return records
    .filter(
      (candidate) =>
        isOneOffPay(candidate) &&
        candidate.grossPay != null &&
        candidate.person === record.person &&
        candidate.employmentId === record.employmentId &&
        candidate.effectiveStart >= segment.from &&
        candidate.effectiveStart <= segment.to,
    )
    .reduce((total, candidate) => total + (candidate.grossPay ?? 0), 0);
}

function oneOffMatchesRegularSegment(
  oneOff: SalaryHistoryRecord,
  regularRecords: readonly SalaryHistoryRecord[],
  asOf: string,
): boolean {
  return regularRecords.some(
    (record) =>
      record.person === oneOff.person &&
      record.employmentId === oneOff.employmentId &&
      recordTaxYearSegments(record, asOf)
        .flatMap(splitAtRuleChanges)
        .some(
          (segment) =>
            oneOff.effectiveStart >= segment.from &&
            oneOff.effectiveStart <= segment.to,
        ),
  );
}

function standaloneOneOffRecords(
  records: readonly SalaryHistoryRecord[],
  asOf: string,
): SalaryHistoryRecord[] {
  const regularRecords = records.filter((record) => !isOneOffPay(record));
  return records.filter(
    (record) =>
      isOneOffPay(record) &&
      (record.grossPay == null ||
        !oneOffMatchesRegularSegment(record, regularRecords, asOf)),
  );
}

function calculateStandaloneOneOffs<T>(
  records: readonly SalaryHistoryRecord[],
  asOf: string,
  calculate: (
    record: SalaryHistoryRecord,
    segment: { taxYear: string; from: string; to: string },
    multipleEmployment: boolean,
    oneOffGrossPay: number,
  ) => T,
): T[] {
  return standaloneOneOffRecords(records, asOf).flatMap((record) =>
    recordTaxYearSegments(record, asOf)
      .flatMap(splitAtRuleChanges)
      .map((segment) =>
        calculate(record, segment, hasMultipleEmployment(record, records), 0),
      ),
  );
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
  const regularCalculations = records
    .filter((record) => !isOneOffPay(record))
    .flatMap((record) =>
      recordTaxYearSegments(record, asOf)
        .flatMap(splitAtRuleChanges)
        .map((segment) =>
          calculateSegment(
            record,
            segment,
            hasMultipleEmployment(record, records),
            oneOffGrossPayForSegment(record, segment, records),
          ),
        ),
    );
  const standaloneCalculations = calculateStandaloneOneOffs(
    records,
    asOf,
    calculateSegment,
  );
  return [...regularCalculations, ...standaloneCalculations];
}

export function calculateNoPensionSalaryHistory(
  records: readonly SalaryHistoryRecord[],
  asOf = new Date().toISOString().slice(0, 10),
): NoPensionSalaryPeriodCalculation[] {
  const regularCalculations = records
    .filter((record) => !isOneOffPay(record))
    .flatMap((record) =>
      recordTaxYearSegments(record, asOf)
        .flatMap(splitAtRuleChanges)
        .map((segment) =>
          calculateNoPensionSegment(
            record,
            segment,
            hasMultipleEmployment(record, records),
            oneOffGrossPayForSegment(record, segment, records),
          ),
        ),
    );
  const standaloneCalculations = calculateStandaloneOneOffs(
    records,
    asOf,
    calculateNoPensionSegment,
  );
  return [...regularCalculations, ...standaloneCalculations];
}
