import { describe, expect, it } from "vitest";
import {
  projectRetirementIncome,
  type RetirementIncomeStream,
  RetirementIncomeStreamSchema,
  retirementIncomeSourceLabel,
} from "@/app/_projects/personal-finance-app/domain";

const lineage = {
  calculationVersion: "1",
  ruleDatasetVersion: "2026.10.3",
  ruleId: "uk-income-tax-2026-27",
};

const propertyTaxLineage = {
  calculationVersion: "1",
  ruleDatasetVersion: "2026.10.3",
  ruleId: "uk-property-income-tax-scenario",
};

function stream(
  overrides: Partial<RetirementIncomeStream> &
    Pick<RetirementIncomeStream, "id" | "name" | "ownerId">,
): RetirementIncomeStream {
  return {
    kind: "other",
    amount: 12_000,
    amountBasis: "gross",
    frequency: "annual",
    currency: "GBP",
    startDate: "2035-01-01",
    inflation: { kind: "level" },
    provenance: {
      kind: "verified-entitlement",
      provider: "Test provider",
      reference: "statement-1",
      observedAt: "2026-10-25T12:00:00Z",
    },
    taxTreatment: { kind: "fixed-rate", rate: 0.2, lineage },
    interactingBenefits: [],
    ...overrides,
  };
}

describe("projectRetirementIncome", () => {
  it("starts a later State Pension on its dated forecast month", () => {
    const statePension = stream({
      id: "state-pension",
      name: "State Pension estimate",
      ownerId: "alex",
      kind: "state-pension",
      startDate: "2037-04-01",
    });

    expect(
      projectRetirementIncome({
        date: "2037-03-01",
        streams: [statePension],
      }).netAmount,
    ).toBe(0);
    expect(
      projectRetirementIncome({
        date: "2037-04-01",
        streams: [statePension],
      }).netAmount,
    ).toBe(800);
  });

  it("combines overlapping defined-benefit and annuity income by owner", () => {
    const result = projectRetirementIncome({
      date: "2036-06-01",
      streams: [
        stream({
          id: "db",
          name: "Defined-benefit pension",
          ownerId: "alex",
          kind: "defined-benefit-pension",
          amount: 600,
          frequency: "monthly",
        }),
        stream({
          id: "annuity",
          name: "Annuity",
          ownerId: "sam",
          kind: "annuity",
          amount: 300,
          frequency: "monthly",
          amountBasis: "net",
          taxTreatment: { kind: "already-net" },
        }),
      ],
    });

    expect(result.netAmount).toBe(780);
    expect(result.streams).toEqual([
      expect.objectContaining({ ownerId: "alex", netAmount: 480 }),
      expect.objectContaining({ ownerId: "sam", netAmount: 300 }),
    ]);
  });

  it("applies annual inflation while level income stays unchanged", () => {
    const result = projectRetirementIncome({
      date: "2037-01-01",
      streams: [
        stream({
          id: "linked",
          name: "Linked pension",
          ownerId: "alex",
          amount: 1_000,
          frequency: "monthly",
          startDate: "2035-07-01",
          inflation: { kind: "fixed-rate", annualRate: 0.05 },
        }),
        stream({
          id: "level",
          name: "Level pension",
          ownerId: "alex",
          amount: 1_000,
          frequency: "monthly",
        }),
      ],
    });

    expect(result.streams.map(({ grossAmount }) => grossAmount)).toEqual([
      1_050, 1_000,
    ]);
  });

  it("applies scenario overrides without changing accepted stream facts", () => {
    const accepted = stream({
      id: "state-pension",
      name: "State Pension estimate",
      ownerId: "alex",
      provenance: { kind: "manual-estimate", note: "Forecast statement" },
    });
    const result = projectRetirementIncome({
      date: "2036-01-01",
      streams: [accepted],
      overrides: [
        {
          streamId: accepted.id,
          startDate: "2036-01-01",
          amount: 18_000,
          inflation: { kind: "fixed-rate", annualRate: 0.03 },
        },
      ],
    });

    expect(result.streams[0]).toMatchObject({
      sourceLabel: "Manual estimate",
      grossAmount: 1_500,
    });
    expect(accepted).toMatchObject({
      amount: 12_000,
      startDate: "2035-01-01",
      inflation: { kind: "level" },
    });
    expect(retirementIncomeSourceLabel(accepted.provenance)).toBe(
      "Manual estimate",
    );
  });

  it("flags unsupported tax, interacting benefits, and missing FX", () => {
    const result = projectRetirementIncome({
      date: "2035-01-01",
      streams: [
        stream({
          id: "rent",
          name: "Rental income",
          ownerId: "alex",
          kind: "rental-income",
          rentalIncome: {
            annualOperatingExpenses: 2_000,
            annualAllowableExpenses: 2_000,
            annualResidentialFinanceCosts: 0,
            expenseTreatment: { kind: "actual-expenses" },
          },
          taxTreatment: {
            kind: "unsupported",
            reason: "Property expenses need a separate calculation",
          },
          interactingBenefits: ["Pension Credit"],
        }),
        stream({
          id: "foreign-pension",
          name: "Foreign pension",
          ownerId: "sam",
          currency: "EUR",
        }),
      ],
    });

    expect(result.netAmount).toBe(0);
    expect(result.issues.map(({ code }) => code)).toEqual([
      "interacting-benefit",
      "unsupported-tax",
      "unsupported-currency",
    ]);
  });

  it("taxes rental profit after allowable expenses and records cash costs", () => {
    const result = projectRetirementIncome({
      date: "2035-01-01",
      streams: [
        stream({
          id: "rental",
          name: "Rental property",
          ownerId: "alex",
          kind: "rental-income",
          amount: 24_000,
          rentalIncome: {
            annualOperatingExpenses: 4_000,
            annualAllowableExpenses: 4_000,
            annualResidentialFinanceCosts: 6_000,
            expenseTreatment: { kind: "actual-expenses" },
          },
          taxTreatment: {
            kind: "fixed-rate",
            rate: 0.2,
            lineage: propertyTaxLineage,
          },
        }),
      ],
    });

    expect(result.streams[0]).toMatchObject({
      grossAmount: 2_000,
      taxableAmount: 1_666.67,
      cashDeductions: 833.33,
      taxAmount: 333.33,
      netAmount: 833.34,
    });
    expect(result.issues).toEqual([
      expect.objectContaining({ code: "property-finance-cost-relief" }),
    ]);
  });

  it("supports a versioned property-allowance election", () => {
    const result = projectRetirementIncome({
      date: "2035-01-01",
      streams: [
        stream({
          id: "rental",
          name: "Rental property",
          ownerId: "alex",
          kind: "rental-income",
          amount: 12_000,
          rentalIncome: {
            annualOperatingExpenses: 400,
            annualAllowableExpenses: 400,
            annualResidentialFinanceCosts: 0,
            expenseTreatment: {
              kind: "property-allowance",
              annualAllowance: 1_000,
              lineage: propertyTaxLineage,
            },
          },
          taxTreatment: {
            kind: "fixed-rate",
            rate: 0.2,
            lineage: propertyTaxLineage,
          },
        }),
      ],
    });

    expect(result.streams[0]).toMatchObject({
      grossAmount: 1_000,
      taxableAmount: 916.67,
      cashDeductions: 33.33,
      taxAmount: 183.33,
      netAmount: 783.34,
    });
  });

  it("requires one aggregate property-business stream per owner", () => {
    const rental = stream({
      id: "rental-one",
      name: "Rental property",
      ownerId: "alex",
      kind: "rental-income",
      rentalIncome: {
        annualOperatingExpenses: 0,
        annualAllowableExpenses: 0,
        annualResidentialFinanceCosts: 0,
        expenseTreatment: { kind: "actual-expenses" },
      },
      taxTreatment: {
        kind: "fixed-rate",
        rate: 0.2,
        lineage: propertyTaxLineage,
      },
    });

    expect(() =>
      projectRetirementIncome({
        date: "2035-01-01",
        streams: [rental, { ...rental, id: "rental-two" }],
      }),
    ).toThrow("must be combined into one property-business stream");
  });

  it("validates survivor treatment and amount basis", () => {
    expect(() =>
      RetirementIncomeStreamSchema.parse({
        ...stream({ id: "db", name: "DB", ownerId: "alex" }),
        amountBasis: "net",
      }),
    ).toThrow("A net retirement income amount must use already-net");
    expect(() =>
      RetirementIncomeStreamSchema.parse({
        ...stream({ id: "db", name: "DB", ownerId: "alex" }),
        survivorTreatment: { kind: "percentage" },
      }),
    ).toThrow("Percentage survivor treatment needs an owner and percentage");
    expect(() =>
      RetirementIncomeStreamSchema.parse({
        ...stream({
          id: "rent",
          name: "Rental property",
          ownerId: "alex",
          kind: "rental-income",
        }),
      }),
    ).toThrow("Rental income needs a property-profit tax basis");
  });
});
