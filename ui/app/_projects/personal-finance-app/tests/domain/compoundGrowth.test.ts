import { describe, expect, it } from "vitest";
import {
  equivalentEffectiveAnnualRate,
  type GrowthScenario,
  projectCompoundGrowth,
} from "@/app/_projects/personal-finance-app/domain/compoundGrowth";

function scenario(overrides: Partial<GrowthScenario> = {}): GrowthScenario {
  return {
    id: "test-plan",
    name: "Test plan",
    startDate: "2026-04-06",
    horizonMonths: 12,
    principal: 1_000,
    linkedAccounts: [],
    cashFlows: [],
    contributionTiming: "end",
    annualReturn: 0,
    returnConvention: { kind: "effective-annual" },
    returnType: "uncertain-investment",
    annualFeeRate: 0,
    wrapper: "isa",
    taxableGrowthTaxRate: 0,
    futureInflationRate: 0,
    stressReturnDelta: 0,
    stressInflationDelta: 0,
    ...overrides,
  };
}

function expectedProjection(input: GrowthScenario) {
  const projection = projectCompoundGrowth(input)[0];
  if (projection == null) throw new Error("Expected projection is missing");
  return projection;
}

describe("projectCompoundGrowth", () => {
  it("handles zero and negative returns", () => {
    const zero = expectedProjection(scenario()).points.at(-1);
    const negative = expectedProjection(
      scenario({ annualReturn: -0.1 }),
    ).points.at(-1);

    expect(zero?.nominalBalance).toBe(1_000);
    expect(negative?.nominalBalance).toBeCloseTo(900, 2);
  });

  it("applies recurring and one-off cash flows at the configured frequency", () => {
    const projection = expectedProjection(
      scenario({
        cashFlows: [
          {
            id: "quarterly",
            label: "Quarterly saving",
            kind: "contribution",
            amount: 100,
            startDate: "2026-04-06",
            frequency: "quarterly",
          },
          {
            id: "withdrawal",
            label: "Purchase",
            kind: "withdrawal",
            amount: 250,
            startDate: "2026-10-06",
            frequency: "once",
          },
        ],
      }),
    );

    expect(projection.points.at(-1)).toMatchObject({
      contributions: 400,
      withdrawals: 250,
      nominalBalance: 1_150,
    });
  });

  it("distinguishes beginning from end-of-period contributions", () => {
    const cashFlows = [
      {
        id: "monthly",
        label: "Monthly saving",
        kind: "contribution" as const,
        amount: 100,
        startDate: "2026-04-06",
        frequency: "monthly" as const,
      },
    ];
    const beginning = expectedProjection(
      scenario({
        annualReturn: 0.12,
        cashFlows,
        contributionTiming: "beginning",
      }),
    ).points.at(-1)?.nominalBalance;
    const end = expectedProjection(
      scenario({ annualReturn: 0.12, cashFlows, contributionTiming: "end" }),
    ).points.at(-1)?.nominalBalance;

    expect(beginning).toBeGreaterThan(end ?? 0);
  });

  it("keeps fees, taxable growth tax, and inflation separate", () => {
    const projection = expectedProjection(
      scenario({
        annualReturn: 0.08,
        annualFeeRate: 0.01,
        wrapper: "taxable",
        taxableGrowthTaxRate: 0.2,
        futureInflationRate: 0.03,
      }),
    );
    const end = projection.points.at(-1);

    expect(end?.growth).toBeGreaterThan(0);
    expect(end?.fees).toBeGreaterThan(0);
    expect(end?.taxes).toBeGreaterThan(0);
    expect(end?.purchasingPower).toBeLessThan(end?.nominalBalance ?? 0);
  });

  it("reports sourced ISA contribution-limit breaches", () => {
    const projection = expectedProjection(
      scenario({
        cashFlows: [
          {
            id: "monthly",
            label: "Monthly saving",
            kind: "contribution",
            amount: 2_000,
            startDate: "2026-04-06",
            frequency: "monthly",
          },
        ],
      }),
    );

    expect(projection.limitIssues).toEqual([
      expect.objectContaining({
        taxYear: "2026-27",
        wrapper: "isa",
        contributions: 24_000,
        limit: 20_000,
        excess: 4_000,
      }),
    ]);
  });

  it("deduplicates household transfers and employer pension contributions", () => {
    const common = {
      label: "Employer contribution",
      kind: "contribution" as const,
      amount: 500,
      startDate: "2026-04-06",
      frequency: "once" as const,
      source: "employer-pension" as const,
      dedupeKey: "payroll-2026-04",
    };
    const projection = expectedProjection(
      scenario({
        cashFlows: [
          { ...common, id: "pension-record" },
          { ...common, id: "payroll-record" },
        ],
      }),
    );

    expect(projection.points.at(-1)?.contributions).toBe(500);
  });

  it("rejects horizons longer than 100 years", () => {
    expect(() =>
      projectCompoundGrowth(scenario({ horizonMonths: 1_201 })),
    ).toThrow("Horizon must be a whole number of months from 1 to 1200");
  });
});

describe("equivalentEffectiveAnnualRate", () => {
  it("converts nominal annual rates using their compounding frequency", () => {
    expect(
      equivalentEffectiveAnnualRate(0.12, {
        kind: "nominal-annual",
        compoundingPeriods: 12,
      }),
    ).toBeCloseTo(0.126_825, 6);
    expect(
      equivalentEffectiveAnnualRate(0.12, { kind: "effective-annual" }),
    ).toBe(0.12);
  });
});
