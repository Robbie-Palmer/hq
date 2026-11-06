import { describe, expect, it } from "vitest";
import { SideIncomeRecommendationInputSchema } from "../src/sideIncomeRecommendation";
import { SideIncomeRecommendationDecisionSchema } from "../src/sideIncomeRecommendationDecision";
import { sideIncomeRecommendationDemoSeed } from "../src/sideIncomeRecommendationDemo";

describe("side-income recommendation demo seed", () => {
  it("contains render-ready comparisons for the main recommendation outcomes", () => {
    expect(sideIncomeRecommendationDemoSeed.comparisonCards).toHaveLength(7);
    for (const card of sideIncomeRecommendationDemoSeed.comparisonCards) {
      expect(SideIncomeRecommendationInputSchema.parse(card.input)).toEqual(
        card.input,
      );
    }

    expect(
      sideIncomeRecommendationDemoSeed.comparisonCards.map(({ result }) => ({
        status: result.status,
        recommendedCandidateId: result.recommendedCandidateId,
      })),
    ).toEqual([
      {
        status: "recommended",
        recommendedCandidateId: "candidate:small-product:sole-trader",
      },
      {
        status: "recommended",
        recommendedCandidateId: "candidate:growing:company",
      },
      {
        status: "recommended",
        recommendedCandidateId: "candidate:contract:direct",
      },
      {
        status: "recommended",
        recommendedCandidateId: "candidate:contract:direct",
      },
      {
        status: "recommended",
        recommendedCandidateId: "candidate:growing:sole-trader",
      },
      {
        status: "recommended",
        recommendedCandidateId: "candidate:growing:company",
      },
      {
        status: "insufficient-information",
        recommendedCandidateId: null,
      },
    ]);
  });

  it("seeds a revisited decision without rewriting the original comparison", () => {
    const decision = SideIncomeRecommendationDecisionSchema.parse(
      sideIncomeRecommendationDemoSeed.savedDecision,
    );

    expect(decision.originalRecommendation.sideIncomeCaseRevision).toBe(1);
    expect(decision.recalculations).toHaveLength(1);
    expect(decision.recalculations[0]?.recommendation.sideIncomeCaseRevision).toBe(
      2,
    );
    expect(decision.actualObservations).toHaveLength(1);
    expect(decision.reviews.map(({ kind }) => kind)).toEqual([
      "revenue",
      "cost",
    ]);
  });

  it("shows actual variance, preserves uncertainty, and exports manual review data", () => {
    const reconciliation = sideIncomeRecommendationDemoSeed.reconciliation[0];
    const cashVariance = reconciliation?.variances.find(
      ({ metric }) => metric === "incrementalHouseholdCashPence",
    );

    expect(cashVariance).toMatchObject({
      expected: 2_062_475,
      actual: 1_850_000,
      variance: -212_475,
    });
    expect(reconciliation?.uncertaintyPreserved).toBe(true);
    expect(
      sideIncomeRecommendationDemoSeed.accountantReviewPacket,
    ).toMatchObject({
      originalCaseRevision: 1,
      latestCaseRevision: 2,
      automaticActions: [],
    });
  });

  it("can be serialized for a demo adapter", () => {
    expect(() =>
      JSON.parse(JSON.stringify(sideIncomeRecommendationDemoSeed)),
    ).not.toThrow();
  });
});
