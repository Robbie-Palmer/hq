import { describe, expect, it } from "vitest";
import {
  BusinessRealisationScenarioSchema,
  calculateBusinessRealisation,
  type HouseholdWealthConsolidation,
  reconcileBusinessRealisation,
  validateBusinessRealisationScenarios,
} from "@/app/_projects/personal-finance-app/domain";
import { businessRealisationFixture } from "@/app/_projects/personal-finance-app/tests/fixtures/businessRealisation";

describe("business realisation scenarios", () => {
  it("keeps a corrected share-sale price separate from its dated valuation", () => {
    const fixture = businessRealisationFixture();
    const result = calculateBusinessRealisation(fixture.input);

    expect(result).toMatchObject({
      complete: true,
      route: "share-sale",
      scenarioRecordId: "northstar-share-sale-v2",
      grossProceeds: {
        recordId: "northstar-share-sale-proceeds-v2",
        amount: { amount: 400_000 },
      },
      valuation: {
        recordId: "northstar-valuation-correction",
        amount: { state: "known", amount: 240_000 },
        ageDays: 46,
      },
      netProceedsBeforePersonalTax: 380_000,
      netProceedsRange: {
        lowerBound: 375_000,
        upperBound: 385_000,
      },
      totalPersonalTax: 46_620,
      netHouseholdProceeds: 238_380,
      unallocatedOwnershipFraction: 0.25,
    });
    expect(result?.distributions).toEqual([
      expect.objectContaining({
        ownerEntityId: "person:alex",
        ownershipFraction: 0.4,
        grossAmount: 152_000,
        personalTax: 25_020,
        netAmount: 126_980,
        taxTreatment: "capital-gain",
        taxableAmount: 139_000,
        businessAssetDisposalReliefApplied: true,
        businessAssetDisposalReliefAmount: 139_000,
      }),
      expect.objectContaining({
        ownerEntityId: "person:sam",
        ownershipFraction: 0.35,
        grossAmount: 133_000,
        personalTax: 21_600,
        netAmount: 111_400,
        taxTreatment: "capital-gain",
      }),
    ]);
    expect(result?.lineage.inputRecordIds).toEqual(
      expect.arrayContaining([
        "northstar-share-sale-v2",
        "northstar-share-sale-proceeds-v2",
        "northstar-valuation-correction",
        "interest-alex-current",
        "interest-sam-current",
        "share-sale-alex",
        "share-sale-sam",
      ]),
    );
  });

  it("selects the scenario correction that was known at the requested time", () => {
    const fixture = businessRealisationFixture();
    const beforeCorrection = calculateBusinessRealisation({
      ...fixture.input,
      asKnownAt: "2026-11-05T00:00:00.000Z",
    });
    const afterCorrection = calculateBusinessRealisation(fixture.input);

    expect(beforeCorrection?.scenarioRecordId).toBe("northstar-share-sale-v1");
    expect(beforeCorrection?.grossProceeds.amount.amount).toBe(390_000);
    expect(afterCorrection?.scenarioRecordId).toBe("northstar-share-sale-v2");
    expect(afterCorrection?.grossProceeds.amount.amount).toBe(400_000);
  });

  it("rejects correction chains that change the route or accepted order", () => {
    const fixture = businessRealisationFixture();
    expect(() =>
      validateBusinessRealisationScenarios(fixture.scenarios),
    ).not.toThrow();

    expect(() =>
      validateBusinessRealisationScenarios([
        fixture.shareSaleOriginal,
        {
          ...fixture.shareSaleCorrection,
          scenarioId: "different-scenario",
        },
      ]),
    ).toThrow("must preserve its scenario, company, and route");
  });

  it("uses dividend treatment for an asset sale followed by extraction", () => {
    const fixture = businessRealisationFixture();
    const result = calculateBusinessRealisation({
      ...fixture.input,
      scenarioId: fixture.assetSale.scenarioId,
    });

    expect(result).toMatchObject({
      complete: true,
      route: "company-asset-sale",
      netProceedsBeforePersonalTax: 210_000,
      totalPersonalTax: 55_948.75,
      netHouseholdProceeds: 101_551.25,
      settlements: [
        { kind: "liability", amount: { amount: 50_000 } },
        { kind: "company-tax", amount: { amount: 20_000 } },
      ],
    });
    expect(
      result?.distributions.every(
        ({ taxTreatment }) => taxTreatment === "dividend",
      ),
    ).toBe(true);
  });

  it("uses capital treatment for a supported solvent wind-down", () => {
    const fixture = businessRealisationFixture();
    const result = calculateBusinessRealisation({
      ...fixture.input,
      scenarioId: fixture.windDown.scenarioId,
    });

    expect(result).toMatchObject({
      complete: true,
      route: "solvent-wind-down",
      netProceedsBeforePersonalTax: 75_000,
      totalPersonalTax: 5_445,
      netHouseholdProceeds: 50_805,
    });
    expect(
      result?.distributions.every(
        ({ taxTreatment }) => taxTreatment === "capital-gain",
      ),
    ).toBe(true);
  });

  it("enforces the striking-off capital distribution threshold", () => {
    const fixture = businessRealisationFixture();
    const atThreshold = BusinessRealisationScenarioSchema.parse({
      ...fixture.windDown,
      recordId: "strike-off-at-threshold",
      scenarioId: "strike-off-at-threshold",
      correctsId: undefined,
      procedure: "striking-off",
      proceeds: {
        ...fixture.windDown.proceeds,
        recordId: "strike-off-proceeds-at-threshold",
        amount: { currency: "GBP", amount: 45_000 },
      },
      settlements: [],
      companyTaxTreatment: {
        state: "not-applicable",
        reason: "No company tax arises in the synthetic case",
      },
      relatedTransferRecordIds: [],
    });
    const aboveThreshold = BusinessRealisationScenarioSchema.parse({
      ...atThreshold,
      recordId: "strike-off-above-threshold",
      scenarioId: "strike-off-above-threshold",
      proceeds: {
        ...atThreshold.proceeds,
        recordId: "strike-off-proceeds-above-threshold",
        amount: { currency: "GBP", amount: 45_000.01 },
      },
    });
    const calculate = (scenario: typeof atThreshold) =>
      calculateBusinessRealisation({
        ...fixture.input,
        scenarioId: scenario.scenarioId,
        scenarios: [scenario],
      });

    expect(calculate(atThreshold)?.issues).not.toContainEqual(
      expect.objectContaining({
        code: "striking-off-distribution-limit-exceeded",
      }),
    );
    expect(calculate(aboveThreshold)).toMatchObject({
      complete: false,
      totalPersonalTax: null,
      netHouseholdProceeds: null,
      issues: [
        expect.objectContaining({
          code: "striking-off-distribution-limit-exceeded",
        }),
      ],
    });
  });

  it("preserves negative proceeds as a shortfall without inventing a distribution", () => {
    const fixture = businessRealisationFixture();
    const scenario = BusinessRealisationScenarioSchema.parse({
      ...fixture.shareSaleCorrection,
      recordId: "insufficient-share-sale",
      scenarioId: "insufficient-share-sale",
      correctsId: undefined,
      proceeds: {
        ...fixture.shareSaleCorrection.proceeds,
        recordId: "insufficient-share-sale-proceeds",
        amount: { currency: "GBP", amount: 10_000 },
      },
      relatedTransferRecordIds: [],
    });
    const result = calculateBusinessRealisation({
      ...fixture.input,
      scenarioId: scenario.scenarioId,
      scenarios: [scenario],
    });

    expect(result).toMatchObject({
      netProceedsBeforePersonalTax: -10_000,
      shortfall: 10_000,
      netHouseholdProceeds: 0,
    });
    expect(result?.distributions.map(({ grossAmount }) => grossAmount)).toEqual(
      [0, 0],
    );
  });

  it("reports stale valuation evidence without replacing proceeds with it", () => {
    const fixture = businessRealisationFixture();
    const scenario = BusinessRealisationScenarioSchema.parse({
      ...fixture.shareSaleCorrection,
      recordId: "stale-valuation-sale",
      scenarioId: "stale-valuation-sale",
      correctsId: undefined,
      maxValuationAgeDays: 30,
    });
    const result = calculateBusinessRealisation({
      ...fixture.input,
      scenarioId: scenario.scenarioId,
      scenarios: [scenario],
    });

    expect(result).toMatchObject({
      complete: false,
      grossProceeds: { amount: { amount: 400_000 } },
      valuation: { amount: { amount: 240_000 } },
      netProceedsBeforePersonalTax: 380_000,
      issues: [expect.objectContaining({ code: "stale-valuation" })],
    });
  });

  it("blocks precise personal tax when relief eligibility is unknown", () => {
    const fixture = businessRealisationFixture();
    const scenario = BusinessRealisationScenarioSchema.parse({
      ...fixture.shareSaleCorrection,
      recordId: "unknown-relief-sale",
      scenarioId: "unknown-relief-sale",
      correctsId: undefined,
      ownerTaxInputs: fixture.shareSaleCorrection.ownerTaxInputs.map((input) =>
        input.ownerEntityId === "person:alex"
          ? {
              ...input,
              reliefEligibility: {
                state: "unknown",
                reason: "Trading-company status has not been verified",
              },
            }
          : input,
      ),
    });
    const result = calculateBusinessRealisation({
      ...fixture.input,
      scenarioId: scenario.scenarioId,
      scenarios: [scenario],
    });

    expect(result).toMatchObject({
      complete: false,
      totalPersonalTax: null,
      netHouseholdProceeds: null,
      issues: [
        expect.objectContaining({
          code: "unknown-relief-eligibility",
          subjectId: "person:alex",
        }),
      ],
    });
  });

  it("eliminates inter-entity transfers and avoids counting destination cash twice", () => {
    const fixture = businessRealisationFixture();
    const realisation = calculateBusinessRealisation(fixture.input);
    if (realisation == null) throw new Error("realisation fixture is missing");
    const consolidation: HouseholdWealthConsolidation = {
      calculationVersion: "business-wealth-consolidation-v1",
      validAt: "2026-11-15",
      asKnownAt: "2026-11-20T00:00:00.000Z",
      baseCurrency: "GBP",
      knownSubtotal: 200_000,
      complete: true,
      contributions: [
        {
          id: "account:alex-cash",
          kind: "account",
          subjectId: "alex-cash",
          amount: 20_000,
          currency: "GBP",
          attribution: [
            { personEntityId: "person:alex", fraction: 1, amount: 20_000 },
          ],
          inputRecordIds: ["alex-cash-value"],
        },
        {
          id: "business-interest:company:northstar",
          kind: "business-interest",
          subjectId: "company:northstar",
          amount: 180_000,
          currency: "GBP",
          attribution: [],
          inputRecordIds: ["northstar-valuation-correction"],
        },
      ],
      businessReconciliations: [],
      includedContributionIds: [
        "account:alex-cash",
        "business-interest:company:northstar",
      ],
      excludedUnderlyingIds: [],
      excludedBusinessIds: [],
      eliminatedTransferIds: [],
      valuationRecordIds: ["northstar-valuation-correction"],
      valuationTreatmentRecordIds: [],
      ownershipRecordIds: [],
      exchangeRateObservationIds: [],
      issues: [],
    };

    const before = reconcileBusinessRealisation({
      consolidation,
      realisation,
      asOfDate: "2026-11-14",
    });
    const after = reconcileBusinessRealisation({
      consolidation,
      realisation,
      asOfDate: "2026-11-15",
    });

    expect(before).toMatchObject({
      knownSubtotal: 200_000,
      addedRealisationProceeds: 0,
      futureRealisationProceeds: 238_380,
    });
    expect(after).toMatchObject({
      knownSubtotal: 131_400,
      removedContributionIds: ["business-interest:company:northstar"],
      addedRealisationProceeds: 111_400,
      destinationAccountContributionIds: ["account:alex-cash"],
      excludedRealisationDistributionOwnerIds: ["person:alex"],
      eliminatedTransferIds: ["share-sale-alex", "share-sale-sam"],
    });
  });

  it("keeps unsupported legal and tax cases explicit", () => {
    const fixture = businessRealisationFixture();
    const scenario = BusinessRealisationScenarioSchema.parse({
      ...fixture.windDown,
      recordId: "unsupported-wind-down",
      scenarioId: "unsupported-wind-down",
      unsupportedCases: [
        {
          code: "anti-avoidance",
          detail:
            "The owner may continue the same trade through another company",
        },
        {
          code: "multiple-share-classes",
          detail: "Economic rights differ by share class",
        },
      ],
    });
    const result = calculateBusinessRealisation({
      ...fixture.input,
      scenarioId: scenario.scenarioId,
      scenarios: [scenario],
    });

    expect(result).toMatchObject({
      complete: false,
      totalPersonalTax: null,
      unsupportedCases: [
        { code: "anti-avoidance" },
        { code: "multiple-share-classes" },
      ],
    });
  });
});
