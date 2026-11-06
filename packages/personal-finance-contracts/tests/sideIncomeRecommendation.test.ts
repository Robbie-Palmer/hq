import { describe, expect, it } from "vitest";
import {
  evaluateSideIncomeRecommendation,
  SideIncomeRecommendationInputSchema,
} from "../src/sideIncomeRecommendation";
import {
  divergentCashPreferenceRecommendationScenario,
  divergentPensionPreferenceRecommendationScenario,
  eligibleUmbrellaContractRecommendationScenario,
  growingRetainedProfitRecommendationScenario,
  irrelevantUmbrellaRecommendationScenario,
  recommendationBoundaryFixtures,
  savedSideIncomeRecommendationScenarios,
  smallProductAlongsidePayeRecommendationScenario,
  unknownStatusRecommendationScenario,
} from "../src/sideIncomeRecommendationSyntheticScenarios";

describe("side-income business-structure recommendation", () => {
  it("validates saved synthetic scenarios for every acceptance route", () => {
    expect(savedSideIncomeRecommendationScenarios).toHaveLength(7);
    for (const scenario of savedSideIncomeRecommendationScenarios) {
      expect(SideIncomeRecommendationInputSchema.parse(scenario)).toEqual(
        scenario,
      );
    }
    expect(
      smallProductAlongsidePayeRecommendationScenario.candidates.map(
        ({ route }) => route,
      ),
    ).toEqual([
      "sole-trader",
      "uk-limited-company",
      "umbrella-employment",
      "direct-employment",
    ]);
  });

  it("recommends the small sole trade and cannot rank an irrelevant umbrella", () => {
    const result = evaluateSideIncomeRecommendation(
      smallProductAlongsidePayeRecommendationScenario,
    );
    const umbrella = result.assessments.find(
      ({ candidate }) => candidate.route === "umbrella-employment",
    );

    expect(result).toMatchObject({
      status: "recommended",
      recommendedCandidateId: "candidate:small-product:sole-trader",
      legalEligibilityDeterminedBeforePreferences: true,
    });
    expect(umbrella).toMatchObject({
      legallyEligible: false,
      financiallyRankable: false,
      scoreBasisPoints: null,
    });
    expect(umbrella?.candidate.metrics.incrementalHouseholdCashPence).toBe(
      9_999_999,
    );
    expect(result.alternativesPreserved).toHaveLength(4);
    expect(
      result.assessments[0]?.candidate.evidence.find(
        ({ sourceId }) => sourceId === "fact:main-job-salary",
      ),
    ).toMatchObject({ kind: "household-fact", certainty: "actual" });
  });

  it("shows every requested measure without merging company and household cash", () => {
    const result = evaluateSideIncomeRecommendation(
      growingRetainedProfitRecommendationScenario,
    );
    const company = result.assessments.find(
      ({ candidate }) => candidate.route === "uk-limited-company",
    );

    expect(company?.candidate.metrics).toMatchObject({
      incrementalHouseholdCashPence: expect.any(Number),
      pensionContributionPence: expect.any(Number),
      retainedCompanyFundsPence: expect.any(Number),
      totalTaxPence: expect.any(Number),
      vatCollectedPence: expect.any(Number),
      vatPaidPence: expect.any(Number),
      setupCostsPence: expect.any(Number),
      ongoingCostsPence: expect.any(Number),
      administrationHours: expect.any(Number),
      taxReserveRequiredPence: expect.any(Number),
      runwayMonths: expect.any(Number),
    });
    expect(
      company?.candidate.metrics.retainedCompanyFundsPence,
    ).not.toBe(company?.candidate.metrics.incrementalHouseholdCashPence);
    expect(company?.candidate.assumptions).toContainEqual(
      expect.objectContaining({
        label: "future extraction",
        status: "estimated",
        editable: true,
      }),
    );
    expect(company?.goalAssessment).toMatchObject({
      householdCashNeedPence: 2_000_000,
      pensionGoalPence: 2_000_000,
      householdCashDeficitPence: expect.any(Number),
      pensionDeficitPence: 0,
    });
  });

  it("returns route-specific scores, reasons, trade-offs, and a clear result", () => {
    const result = evaluateSideIncomeRecommendation(
      growingRetainedProfitRecommendationScenario,
    );

    expect(result.status).toBe("recommended");
    expect(result.recommendedCandidateId).toBe(
      "candidate:growing:company",
    );
    expect(result.assessments[0]?.scoreContributions.length).toBeGreaterThan(5);
    expect(result.assessments[0]?.reasons.length).toBeGreaterThan(0);
    expect(result.assessments.every(({ candidate }) => candidate.evidence.length > 0))
      .toBe(true);
  });

  it("publishes low, base, and high break-even ranges for all five variables", () => {
    const result = evaluateSideIncomeRecommendation(
      growingRetainedProfitRecommendationScenario,
    );

    expect(result.sensitivities).toHaveLength(15);
    expect(
      new Set(result.breakEvenRanges.map(({ variable }) => variable)),
    ).toEqual(
      new Set([
        "revenue",
        "expenses",
        "pension",
        "extraction",
        "work-availability",
      ]),
    );
    expect(
      result.sensitivities.filter(
        ({ sensitivity }) =>
          sensitivity.futureRuleState === "changed-rule-assumption",
      ),
    ).toHaveLength(5);
    expect(result.sensitivityCaveat).toMatch(/not a universal/);
  });

  it("keeps direct employment, umbrella, and supplied outside status distinct", () => {
    const result = evaluateSideIncomeRecommendation(
      eligibleUmbrellaContractRecommendationScenario,
    );
    const byRoute = new Map(
      result.assessments.map((assessment) => [
        `${assessment.candidate.route}:${assessment.candidate.statusContext}`,
        assessment,
      ]),
    );

    expect(byRoute.get("umbrella-employment:not-applicable")).toMatchObject({
      legallyEligible: true,
      financiallyRankable: true,
    });
    expect(byRoute.get("direct-employment:not-applicable")).toMatchObject({
      legallyEligible: true,
      financiallyRankable: true,
    });
    expect(byRoute.get("uk-limited-company:outside")).toMatchObject({
      legallyEligible: true,
      financiallyRankable: true,
    });
  });

  it("does not infer an unknown status from the most profitable outcome", () => {
    const result = evaluateSideIncomeRecommendation(
      unknownStatusRecommendationScenario,
    );
    const company = result.assessments.find(
      ({ candidate }) => candidate.statusContext === "under-review",
    );

    expect(company?.candidate.metrics.incrementalHouseholdCashPence).toBe(
      9_999_999,
    );
    expect(company).toMatchObject({
      legallyEligible: false,
      financiallyRankable: false,
      scoreBasisPoints: null,
    });
    expect(
      company?.candidate.evidence.find(({ kind }) => kind === "legal-status")
        ?.certainty,
    ).toBe("unknown");
  });

  it("changes the recommendation when the user changes financial priorities", () => {
    const cash = evaluateSideIncomeRecommendation(
      divergentCashPreferenceRecommendationScenario,
    );
    const pension = evaluateSideIncomeRecommendation(
      divergentPensionPreferenceRecommendationScenario,
    );

    expect(cash.recommendedCandidateId).toBe("candidate:growing:sole-trader");
    expect(pension.recommendedCandidateId).toBe("candidate:growing:company");
  });

  it("returns insufficient information and asks only for the missing business input", () => {
    const result = evaluateSideIncomeRecommendation(
      recommendationBoundaryFixtures.missingBusinessInput,
    );

    expect(result).toMatchObject({
      status: "insufficient-information",
      recommendedCandidateId: null,
      missingBusinessQuestions: [
        {
          inputId: "input:extraction-plan",
          question: "How much company profit must reach the household this year?",
        },
      ],
    });
    expect(result.householdFactIdsUsed).toContain("fact:main-job-salary");
  });

  it("keeps an inside company route unsupported even when it has more cash", () => {
    const result = evaluateSideIncomeRecommendation(
      recommendationBoundaryFixtures.insideCompany,
    );

    expect(result.recommendedCandidateId).toBe("candidate:contract:umbrella");
    expect(result.assessments).toContainEqual(
      expect.objectContaining({
        legallyEligible: false,
        candidate: expect.objectContaining({ statusContext: "inside" }),
      }),
    );
  });

  it("keeps umbrella explicitly irrelevant for product sales", () => {
    const result = evaluateSideIncomeRecommendation(
      irrelevantUmbrellaRecommendationScenario,
    );
    expect(result.assessments.find(({ candidate }) => candidate.route === "umbrella-employment"))
      .toMatchObject({
        legallyEligible: false,
        candidate: {
          eligibility: {
            legalOrStatusBasis: "Umbrella employment does not cover product sales.",
          },
        },
      });
  });

  it("returns no clear winner when eligible routes tie", () => {
    const scenario = structuredClone(
      divergentCashPreferenceRecommendationScenario,
    );
    const first = scenario.candidates[0];
    const second = scenario.candidates[1];
    if (first === undefined || second === undefined) {
      throw new Error("Missing divergent candidates");
    }
    second.metrics = structuredClone(first.metrics);
    const result = evaluateSideIncomeRecommendation(scenario);

    expect(result).toMatchObject({
      status: "no-clear-winner",
      recommendedCandidateId: null,
      winnerGapBasisPoints: 0,
    });
    expect(result.assessments.filter(({ financiallyRankable }) => financiallyRankable))
      .toHaveLength(2);
  });

  it("excludes a route whose dates or work availability are not aligned", () => {
    const scenario = structuredClone(
      eligibleUmbrellaContractRecommendationScenario,
    );
    const company = scenario.candidates.find(
      ({ route }) => route === "uk-limited-company",
    );
    if (company === undefined) throw new Error("Missing company candidate");
    company.comparisonPeriod.startsOn = "2026-05-01";
    company.comparisonPeriod.availableWorkDays = 240;
    const result = evaluateSideIncomeRecommendation(scenario);
    const assessed = result.assessments.find(
      ({ candidate }) => candidate.id === company.id,
    );

    expect(assessed?.financiallyRankable).toBe(false);
    expect(assessed?.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "comparison-period-mismatch",
        "work-availability-mismatch",
      ]),
    );
  });
});
