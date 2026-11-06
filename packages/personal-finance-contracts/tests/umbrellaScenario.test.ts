import { describe, expect, it } from "vitest";
import {
  evaluateUmbrellaScenario,
  UmbrellaScenarioInputSchema,
} from "../src/umbrellaScenario";
import {
  accruedHolidayUmbrellaScenario,
  authoritativeUmbrellaScenario,
  fixableOmissionsUmbrellaScenario,
  historicalBoundaryUmbrellaScenario,
  netPayUmbrellaScenario,
  reliefAtSourceUmbrellaScenario,
} from "../src/umbrellaSyntheticScenarios";

describe("UK umbrella employment scenario", () => {
  it("reconciles assignment revenue to gross pay before payslip deductions", () => {
    const result = evaluateUmbrellaScenario(authoritativeUmbrellaScenario);

    expect(result.available).toBe(true);
    expect(result.assignment).toMatchObject({
      assignmentRevenuePence: 11_500_000,
      workingPeriods: 11,
      workedDays: 220,
    });
    expect(result.reconciliation).toMatchObject({
      umbrellaMarginPence: 132_000,
      differencePence: 0,
      employerCostsAreGrossPayDeductions: false,
    });
    expect(result.reconciliation.contractualGrossPayPence).toBeGreaterThan(0);
    expect(
      result.reconciliation.employerCosts.employerNationalInsurancePence,
    ).toBeGreaterThan(0);
    expect(
      result.reconciliation.employerCosts.apprenticeshipLevyPence,
    ).toBeGreaterThan(0);
    expect(result.reconciliation.holidayPay.paidPence).toBeGreaterThan(0);
  });

  it("shows employee deductions, both loan types, and net cash", () => {
    const result = evaluateUmbrellaScenario(authoritativeUmbrellaScenario);

    expect(result.payslip.incomeTaxPence).toBeGreaterThan(0);
    expect(result.payslip.employeeNationalInsurancePence).toBeGreaterThan(0);
    expect(result.payslip.salarySacrificePence).toBeGreaterThan(0);
    expect(result.payslip.studentLoanPence).toBeGreaterThan(0);
    expect(result.payslip.postgraduateLoanPence).toBeGreaterThan(0);
    expect(result.payslip.netCashPence).toBeGreaterThan(0);
    expect(result.payslip.netCashPence).toBe(
      (result.payslip.employeeTakeHomePence ?? 0) -
        (result.payslip.studentLoanPence ?? 0) -
        (result.payslip.postgraduateLoanPence ?? 0),
    );
  });

  it("keeps gaps and bonuses in the pay-period calculation", () => {
    const result = evaluateUmbrellaScenario(authoritativeUmbrellaScenario);
    const gap = result.periods[4];
    const bonus = result.periods[8];

    expect(gap).toMatchObject({
      assignmentRevenuePence: 0,
      contractualGrossPayPence: 0,
      employerNationalInsurancePence: 0,
    });
    expect(bonus?.assignmentRevenuePence).toBe(1_500_000);
    expect(bonus?.contractualGrossPayPence).toBeGreaterThan(
      result.periods[0]?.contractualGrossPayPence ?? 0,
    );
  });

  it("compares equivalent direct employment and a supported outside company", () => {
    const result = evaluateUmbrellaScenario(authoritativeUmbrellaScenario);

    expect(result.comparisons.sharedBasis).toMatchObject({
      availableWorkDays: 260,
      pensionTargetPence: 1_000_000,
    });
    expect(result.comparisons.directEmployment).toMatchObject({
      state: "supported",
      workBasis: {
        rights: { paidHolidayDays: 25, paidSickDays: 5 },
      },
    });
    expect(result.comparisons.company).toMatchObject({
      state: "supported",
      workBasis: {
        rights: { paidHolidayDays: 0, paidSickDays: 0 },
      },
    });
    expect(result.comparisons.company?.retainedCompanyCashPence).toBeGreaterThan(0);
  });

  it("does not apply the company status decision to umbrella employment", () => {
    const result = evaluateUmbrellaScenario(authoritativeUmbrellaScenario);

    expect(result.offPayrollStatus).toMatchObject({
      suppliedEngagementEvidence: {
        relevant: true,
        status: "outside",
        separation: { inferredFromFinancialOutcome: false },
      },
      umbrellaEmploymentApplicability: "not-applicable",
    });
  });

  it("supports salary sacrifice, net pay, and relief at source distinctly", () => {
    const salarySacrifice = evaluateUmbrellaScenario(
      authoritativeUmbrellaScenario,
    );
    const netPay = evaluateUmbrellaScenario(netPayUmbrellaScenario);
    const reliefAtSource = evaluateUmbrellaScenario(
      reliefAtSourceUmbrellaScenario,
    );

    expect(salarySacrifice.payslip.salarySacrificePence).toBeGreaterThan(0);
    expect(salarySacrifice.payslip.employeePensionCashDeductionPence).toBe(0);
    expect(netPay.payslip.salarySacrificePence).toBe(0);
    expect(netPay.payslip.employeePensionCashDeductionPence).toBeGreaterThan(0);
    expect(netPay.payslip.providerPensionTaxReliefPence).toBe(0);
    expect(reliefAtSource.payslip.salarySacrificePence).toBe(0);
    expect(reliefAtSource.payslip.providerPensionTaxReliefPence).toBeGreaterThan(0);
  });

  it("tracks holiday accrual, release, and the closing reserve", () => {
    const result = evaluateUmbrellaScenario(accruedHolidayUmbrellaScenario);
    const holiday = result.reconciliation.holidayPay;

    expect(holiday).toMatchObject({
      method: "accrued-52-week-reference",
      paidPence: 200_000,
    });
    expect(holiday.accruedPence).toBeGreaterThan(0);
    expect(holiday.closingReservePence).toBe(holiday.accruedPence);
    expect(result.reconciliation.differencePence).toBe(0);
  });

  it("selects the historical payroll rule and rejects Plan 5 before 2026-27", () => {
    const prior = evaluateUmbrellaScenario(historicalBoundaryUmbrellaScenario);
    const unsupported = structuredClone(historicalBoundaryUmbrellaScenario);
    unsupported.studentLoan.standardPlan = "plan-5";
    const plan5 = evaluateUmbrellaScenario(unsupported);

    expect(prior.lineage.payrollRuleId).toBe("uk.umbrella.payroll.2025-26");
    expect(prior.lineage.minimumWageRuleIds).toEqual([
      "uk.minimum-wage.2025-04-01",
    ]);
    expect(plan5.available).toBe(false);
    expect(plan5.issues).toContainEqual(
      expect.objectContaining({ code: "unsupported-student-loan-plan-period" }),
    );
  });

  it("returns fixable review states instead of filling provider omissions", () => {
    const result = evaluateUmbrellaScenario(fixableOmissionsUmbrellaScenario);

    expect(result.available).toBe(false);
    expect(result.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "umbrella-provider-not-confirmed",
        "apprenticeship-levy-applicability-unknown",
        "pension-arrangement-not-confirmed",
        "holiday-pay-method-unknown",
      ]),
    );
    expect(result.offPayrollStatus.suppliedEngagementEvidence.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "off-payroll-status-unresolved" }),
      ]),
    );
  });

  it("reports an inside company route as explicitly unsupported", () => {
    const scenario = structuredClone(authoritativeUmbrellaScenario);
    scenario.offPayrollStatusEvidence.suppliedStatus = "inside";
    const result = evaluateUmbrellaScenario(scenario);

    expect(result.comparisons.directEmployment?.state).toBe("supported");
    expect(result.comparisons.company).toMatchObject({
      state: "unsupported",
      issues: [
        expect.objectContaining({
          code: "inside-off-payroll-company-comparison-unsupported",
        }),
      ],
    });
  });

  it("blocks salary sacrifice that would breach minimum wage", () => {
    const scenario = structuredClone(authoritativeUmbrellaScenario);
    scenario.pension.employee = {
      kind: "percentage",
      taxTreatment: "salary-sacrifice",
      basis: "gross-pay",
      rateBasisPoints: 10_000,
    };
    const result = evaluateUmbrellaScenario(scenario);

    expect(result.available).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "minimum-wage-shortfall" }),
    );
  });

  it("validates a full pay-period schedule for saved scenarios", () => {
    const scenario = structuredClone(authoritativeUmbrellaScenario);
    scenario.assignmentPeriods.pop();

    expect(() => UmbrellaScenarioInputSchema.parse(scenario)).toThrow(
      "Expected 12 monthly assignment periods",
    );
  });

  it("validates unique periods, holiday releases, direct pay, and dates", () => {
    const duplicate = structuredClone(accruedHolidayUmbrellaScenario);
    const firstId = duplicate.assignmentPeriods[0]?.id;
    if (firstId === undefined || duplicate.assignmentPeriods[1] === undefined) {
      throw new Error("Missing synthetic assignment periods");
    }
    if (duplicate.holidayPay.method !== "accrued-52-week-reference") {
      throw new Error("Missing synthetic accrued holiday arrangement");
    }
    duplicate.assignmentPeriods[1].id = firstId;
    duplicate.holidayPay.paidByPeriodPence.pop();
    const direct = structuredClone(authoritativeUmbrellaScenario);
    direct.comparisons.directEmployment?.grossPayByPeriodPence.pop();
    direct.comparisonBasis.startsOn = "2027-04-06";
    direct.comparisonBasis.endsOn = "2027-04-05";

    const duplicateResult = UmbrellaScenarioInputSchema.safeParse(duplicate);
    const directResult = UmbrellaScenarioInputSchema.safeParse(direct);
    expect(duplicateResult.error?.issues.map(({ message }) => message)).toEqual(
      expect.arrayContaining([
        "Assignment period IDs must be unique.",
        "Expected 12 monthly holiday payment amounts.",
      ]),
    );
    expect(directResult.error?.issues.map(({ message }) => message)).toEqual(
      expect.arrayContaining([
        "Expected 12 monthly direct-employment pay amounts.",
        "The comparison period cannot end before it starts.",
      ]),
    );
  });

  it("supports annual and percentage margin timing", () => {
    const annual = structuredClone(netPayUmbrellaScenario);
    annual.margin = { kind: "annual-fixed", amountPence: 120_000 };
    const percentage = structuredClone(netPayUmbrellaScenario);
    percentage.margin = {
      kind: "percentage-of-assignment-revenue",
      rateBasisPoints: 100,
    };

    expect(evaluateUmbrellaScenario(annual).reconciliation.umbrellaMarginPence).toBe(
      120_000,
    );
    expect(
      evaluateUmbrellaScenario(percentage).reconciliation.umbrellaMarginPence,
    ).toBe(115_000);
  });

  it("records unsupported payroll, NI, and minimum-wage periods", () => {
    const scenario = structuredClone(netPayUmbrellaScenario);
    scenario.taxYear = "2027-28";
    scenario.evaluatedOn = "2027-11-06";
    scenario.nationalInsuranceCategory = "B";
    const first = scenario.assignmentPeriods[0];
    if (first === undefined) throw new Error("Missing synthetic assignment period");
    first.paidOn = "2024-03-31";
    const result = evaluateUmbrellaScenario(scenario);

    expect(result.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "unsupported-payroll-rule-period",
        "unsupported-national-insurance-category",
        "unsupported-minimum-wage-date",
        "umbrella-payroll-unavailable",
      ]),
    );
    expect(result.reconciliation.employerCosts.employerNationalInsurancePence).toBe(0);
  });

  it("flags conflicting levy evidence without guessing a replacement", () => {
    const scenario = structuredClone(netPayUmbrellaScenario);
    scenario.apprenticeshipLevy.providerAnnualPayBillPence = 100_000_000;
    scenario.apprenticeshipLevy.evidenceReference = null;
    const result = evaluateUmbrellaScenario(scenario);

    expect(result.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "apprenticeship-levy-evidence-missing",
        "apprenticeship-levy-assessment-conflict",
      ]),
    );
  });

  it("rejects unsupported holiday arrangements and releases", () => {
    const rolled = structuredClone(netPayUmbrellaScenario);
    rolled.holidayPay = {
      method: "rolled-up",
      workerPattern: "regular-hours",
      rateBasisPoints: 1_000,
    };
    const accrued = structuredClone(accruedHolidayUmbrellaScenario);
    if (accrued.holidayPay.method !== "accrued-52-week-reference") {
      throw new Error("Missing synthetic accrued holiday arrangement");
    }
    accrued.holidayPay.openingReservePence = 0;
    accrued.holidayPay.paidByPeriodPence = accrued.assignmentPeriods.map(
      (_, index) => (index === 0 ? 10_000_000 : 0),
    );

    expect(
      evaluateUmbrellaScenario(rolled).issues.map(({ code }) => code),
    ).toEqual(
      expect.arrayContaining([
        "rolled-up-holiday-pay-not-supported-for-worker-pattern",
        "nonstandard-rolled-up-holiday-rate",
      ]),
    );
    expect(evaluateUmbrellaScenario(accrued).issues).toContainEqual(
      expect.objectContaining({ code: "holiday-pay-release-exceeds-reserve" }),
    );
  });

  it("reports unknown pension rules and an assignment budget shortfall", () => {
    const unknown = structuredClone(netPayUmbrellaScenario);
    unknown.pension.employee = { kind: "unknown" };
    const shortfall = structuredClone(netPayUmbrellaScenario);
    shortfall.pension.employer = {
      kind: "explicit-amount",
      amountPence: 20_000_000,
    };

    expect(evaluateUmbrellaScenario(unknown).issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "unknown-employee-contribution",
        "umbrella-payroll-unavailable",
      ]),
    );
    expect(evaluateUmbrellaScenario(shortfall).issues).toContainEqual(
      expect.objectContaining({ code: "assignment-budget-insufficient" }),
    );
  });

  it("makes mismatched or infeasible comparisons explicit", () => {
    const scenario = structuredClone(authoritativeUmbrellaScenario);
    const direct = scenario.comparisons.directEmployment;
    const company = scenario.comparisons.company;
    if (direct === null || company === null) {
      throw new Error("Missing synthetic comparisons");
    }
    direct.workBasis.unpaidNonWorkingDays = 0;
    direct.pension.employee = { kind: "unknown" };
    company.workBasis.unpaidNonWorkingDays = 0;
    company.strategyId = "strategy:missing";
    const companyPeriod = company.scenario.companyPeriods[0];
    if (companyPeriod === undefined) {
      throw new Error("Missing synthetic company period");
    }
    companyPeriod.taxYear = "2025-26";
    const result = evaluateUmbrellaScenario(scenario);

    expect(result.comparisons.directEmployment?.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "comparison-work-availability-mismatch",
        "unknown-employee-contribution",
        "direct-employment-payroll-unavailable",
      ]),
    );
    expect(result.comparisons.company?.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "comparison-work-availability-mismatch",
        "company-strategy-unavailable",
        "company-comparison-period-mismatch",
      ]),
    );
  });
});
