import { corporationTaxBoundaryScenario } from "./limitedCompanySyntheticScenarios";
import { OFF_PAYROLL_STATUS_CONTRACT_VERSION } from "./offPayrollStatus";
import {
  UMBRELLA_SCENARIO_VERSION,
  UmbrellaScenarioInputSchema,
  type UmbrellaScenarioInput,
} from "./umbrellaScenario";

const monthlyDates2026 = [
  "2026-04-30",
  "2026-05-31",
  "2026-06-30",
  "2026-07-31",
  "2026-08-31",
  "2026-09-30",
  "2026-10-31",
  "2026-11-30",
  "2026-12-31",
  "2027-01-31",
  "2027-02-28",
  "2027-03-31",
] as const;

const monthlyDates2025 = [
  "2025-04-30",
  "2025-05-31",
  "2025-06-30",
  "2025-07-31",
  "2025-08-31",
  "2025-09-30",
  "2025-10-31",
  "2025-11-30",
  "2025-12-31",
  "2026-01-31",
  "2026-02-28",
  "2026-03-31",
] as const;

const assignmentPeriods = (dates: readonly string[]) =>
  dates.map((paidOn, index) => {
    const gap = index === 4;
    return {
      id: `assignment:${paidOn.slice(0, 7)}`,
      paidOn,
      assignmentRatePence: 50_000,
      rateUnit: "day" as const,
      workedUnits: gap ? 0 : 20,
      workedHours: gap ? 0 : 150,
      assignmentBonusPence: index === 8 ? 500_000 : 0,
      marginCharged: !gap,
    };
  });

const salarySacrificePension = {
  providerArrangementStatus: "confirmed" as const,
  employee: {
    kind: "percentage" as const,
    taxTreatment: "salary-sacrifice" as const,
    basis: "gross-pay" as const,
    rateBasisPoints: 500,
  },
  employer: {
    kind: "flat-rate" as const,
    basis: "gross-pay" as const,
    rateBasisPoints: 300,
    schemeMinimumRateBasisPoints: 300,
  },
};

const directEmploymentPension = {
  providerArrangementStatus: "confirmed" as const,
  employee: {
    kind: "percentage" as const,
    taxTreatment: "net-pay" as const,
    basis: "qualifying-earnings" as const,
    rateBasisPoints: 500,
  },
  employer: {
    kind: "flat-rate" as const,
    basis: "qualifying-earnings" as const,
    rateBasisPoints: 300,
    schemeMinimumRateBasisPoints: 300,
  },
};

const umbrellaWorkBasis = {
  workedDays: 220,
  unpaidNonWorkingDays: 20,
  workerPaidExpensesPence: 120_000,
  rights: {
    paidHolidayDays: 15,
    paidSickDays: 5,
    sickPay: "statutory-only" as const,
  },
};

const directWorkBasis = {
  workedDays: 220,
  unpaidNonWorkingDays: 10,
  workerPaidExpensesPence: 0,
  rights: {
    paidHolidayDays: 25,
    paidSickDays: 5,
    sickPay: "contractual" as const,
  },
};

const companyWorkBasis = {
  workedDays: 220,
  unpaidNonWorkingDays: 40,
  workerPaidExpensesPence: 120_000,
  rights: {
    paidHolidayDays: 0,
    paidSickDays: 0,
    sickPay: "none" as const,
  },
};

export const authoritativeUmbrellaScenario: UmbrellaScenarioInput =
  UmbrellaScenarioInputSchema.parse({
    scenarioVersion: UMBRELLA_SCENARIO_VERSION,
    id: "scenario:umbrella-2026-27",
    label: "Umbrella employment with a gap and year-end bonus",
    savedAt: "2026-11-06T12:00:00.000Z",
    revision: 1,
    evaluatedOn: "2026-11-06",
    taxYear: "2026-27",
    incomeTaxJurisdiction: "england-and-northern-ireland",
    payPeriod: "monthly",
    providerSuitability: "confirmed",
    nationalInsuranceCategory: "A",
    minimumWageCategory: "age-21-and-over",
    assignmentPeriods: assignmentPeriods(monthlyDates2026),
    margin: { kind: "fixed-per-charged-period", amountPence: 12_000 },
    apprenticeshipLevy: {
      providerAssessment: "confirmed-over-threshold",
      providerAnnualPayBillPence: 500_000_000,
      evidenceReference: "provider-reconciliation:levy-2026-27",
    },
    holidayPay: {
      method: "rolled-up",
      workerPattern: "irregular-hours",
      rateBasisPoints: 1_207,
    },
    pension: salarySacrificePension,
    studentLoan: { standardPlan: "plan-2", postgraduateLoan: true },
    otherTaxableIncomePence: 5_000_000,
    otherDeductionsPence: 24_000,
    reimbursedExpensesPence: 120_000,
    workBasis: umbrellaWorkBasis,
    comparisonBasis: {
      startsOn: "2026-04-06",
      endsOn: "2027-04-05",
      availableWorkDays: 260,
      pensionTargetPence: 1_000_000,
    },
    offPayrollStatusEvidence: {
      contractVersion: OFF_PAYROLL_STATUS_CONTRACT_VERSION,
      engagementId: "engagement:software-client",
      engagementKind: "services",
      workerRoute: "own-intermediary",
      clientCategory: "private-medium-or-large",
      suppliedStatus: "outside",
      evidence: {
        kind: "status-determination-statement",
        reference: "sds:software-client:2026-04-06",
        assessedOn: "2026-04-06",
        reasons: [
          "The client records the right of substitution and working practices.",
        ],
      },
    },
    comparisons: {
      directEmployment: {
        id: "comparison:direct-employment",
        label: "Direct employment",
        workBasis: directWorkBasis,
        grossPayByPeriodPence: monthlyDates2026.map(() => 700_000),
        pension: directEmploymentPension,
        studentLoan: { standardPlan: "plan-2", postgraduateLoan: true },
        otherDeductionsPence: 24_000,
        reimbursedExpensesPence: 0,
      },
      company: {
        strategyId: "strategy:boundary",
        workBasis: companyWorkBasis,
        scenario: corporationTaxBoundaryScenario(10_000_000),
      },
    },
  });

export const netPayUmbrellaScenario: UmbrellaScenarioInput =
  UmbrellaScenarioInputSchema.parse({
    ...structuredClone(authoritativeUmbrellaScenario),
    id: "scenario:umbrella-net-pay",
    label: "Umbrella employment with net-pay pension",
    pension: {
      ...salarySacrificePension,
      employee: {
        ...salarySacrificePension.employee,
        taxTreatment: "net-pay",
      },
    },
    comparisons: { directEmployment: null, company: null },
  });

export const reliefAtSourceUmbrellaScenario: UmbrellaScenarioInput =
  UmbrellaScenarioInputSchema.parse({
    ...structuredClone(authoritativeUmbrellaScenario),
    id: "scenario:umbrella-relief-at-source",
    label: "Umbrella employment with relief-at-source pension",
    pension: {
      ...salarySacrificePension,
      employee: {
        ...salarySacrificePension.employee,
        taxTreatment: "relief-at-source",
      },
    },
    comparisons: { directEmployment: null, company: null },
  });

export const accruedHolidayUmbrellaScenario: UmbrellaScenarioInput =
  UmbrellaScenarioInputSchema.parse({
    ...structuredClone(authoritativeUmbrellaScenario),
    id: "scenario:umbrella-accrued-holiday",
    label: "Umbrella employment with holiday pay held and released",
    holidayPay: {
      method: "accrued-52-week-reference",
      workerPattern: "irregular-hours",
      accrualRateBasisPoints: 1_207,
      openingReservePence: 200_000,
      paidByPeriodPence: monthlyDates2026.map((_, index) =>
        index === 4 ? 200_000 : 0,
      ),
    },
    comparisons: { directEmployment: null, company: null },
  });

export const historicalBoundaryUmbrellaScenario: UmbrellaScenarioInput =
  UmbrellaScenarioInputSchema.parse({
    ...structuredClone(authoritativeUmbrellaScenario),
    id: "scenario:umbrella-2025-26",
    label: "Umbrella employment before the 2026 payroll boundary",
    evaluatedOn: "2026-03-31",
    taxYear: "2025-26",
    assignmentPeriods: assignmentPeriods(monthlyDates2025),
    comparisonBasis: {
      ...authoritativeUmbrellaScenario.comparisonBasis,
      startsOn: "2025-04-06",
      endsOn: "2026-04-05",
    },
    offPayrollStatusEvidence: {
      ...structuredClone(authoritativeUmbrellaScenario.offPayrollStatusEvidence),
      evidence: {
        ...structuredClone(
          authoritativeUmbrellaScenario.offPayrollStatusEvidence.evidence,
        ),
        assessedOn: "2025-04-06",
        reference: "sds:software-client:2025-04-06",
      },
    },
    comparisons: { directEmployment: null, company: null },
  });

export const fixableOmissionsUmbrellaScenario: UmbrellaScenarioInput =
  UmbrellaScenarioInputSchema.parse({
    ...structuredClone(authoritativeUmbrellaScenario),
    id: "scenario:umbrella-fixable-omissions",
    label: "Umbrella quote with missing provider details",
    providerSuitability: "not-reviewed",
    apprenticeshipLevy: {
      providerAssessment: "unknown",
      providerAnnualPayBillPence: null,
      evidenceReference: null,
    },
    pension: {
      ...salarySacrificePension,
      providerArrangementStatus: "not-reviewed",
    },
    holidayPay: { method: "unknown", workerPattern: "unknown" },
    offPayrollStatusEvidence: {
      contractVersion: OFF_PAYROLL_STATUS_CONTRACT_VERSION,
      engagementId: "engagement:software-client",
      engagementKind: "services",
      workerRoute: "own-intermediary",
      clientCategory: "unknown",
      suppliedStatus: "under-review",
      evidence: {
        kind: "none",
        reference: null,
        assessedOn: null,
        reasons: [],
      },
    },
    comparisons: { directEmployment: null, company: null },
  });
