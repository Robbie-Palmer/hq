import { describe, expect, it } from "vitest";
import {
  appendSideIncomeActualObservation,
  appendSideIncomeRecommendationRecalculation,
  appendSideIncomeRecommendationReviews,
  buildSideIncomeAccountantReviewPacket,
  createSideIncomeRecommendationDecision,
  detectSideIncomeRecommendationReviewTriggers,
  reconcileSideIncomeRecommendationDecision,
  type RecommendationReviewSignal,
} from "../src/sideIncomeRecommendationDecision";
import { evaluateSideIncomeRecommendation } from "../src/sideIncomeRecommendation";
import { growingRetainedProfitRecommendationScenario } from "../src/sideIncomeRecommendationSyntheticScenarios";

const original = evaluateSideIncomeRecommendation(
  growingRetainedProfitRecommendationScenario,
);

const originalSignals: RecommendationReviewSignal[] = [
  {
    id: "signal:revenue",
    kind: "revenue",
    value: "£100,000 forecast",
    sourceId: "fact:company-revenue-2026",
    sourceRevision: "1",
    certainty: "forecast",
  },
  {
    id: "signal:employment",
    kind: "employment",
    value: "PAYE employment active",
    sourceId: "employment:main-job",
    sourceRevision: "1",
    certainty: "actual",
  },
  {
    id: "signal:household-cash",
    kind: "household-cash-need",
    value: "£20,000",
    sourceId: "household-plan:2026",
    sourceRevision: "1",
    certainty: "forecast",
  },
  {
    id: "signal:cost",
    kind: "cost",
    value: "£10,050",
    sourceId: "business-cost-plan:2026",
    sourceRevision: "1",
    certainty: "forecast",
  },
  {
    id: "signal:rules",
    kind: "rule-version",
    value: "2026-27",
    sourceId: "uk-limited-company-rules",
    sourceRevision: "2026-11-06",
    certainty: "actual",
  },
];

const decision = () =>
  createSideIncomeRecommendationDecision({
    id: "decision:growing-company",
    savedAt: "2026-11-06T14:00:00.000Z",
    chosenCandidateId: "candidate:growing:company",
    action: {
      kind: "review-with-accountant",
      detail: "Review the extraction and pension assumptions before any change.",
    },
    rationale: "Retained cash and pension funding match the stated priorities.",
    originalRecommendation: original,
    originalReviewSignals: originalSignals,
  });

describe("side-income recommendation decisions and revisit", () => {
  it("freezes the original comparison when corrected facts are recalculated", () => {
    const created = decision();
    const frozen = structuredClone(created.originalRecommendation);
    const correctedInput = structuredClone(
      growingRetainedProfitRecommendationScenario,
    );
    correctedInput.sideIncomeCaseRevision = 2;
    correctedInput.id = "recommendation:growing-retained-profit:corrected";
    const correctedCandidate = correctedInput.candidates.find(
      ({ id }) => id === "candidate:growing:company",
    );
    if (correctedCandidate === undefined) throw new Error("Missing company candidate");
    correctedCandidate.metrics.incrementalHouseholdCashPence = 1_800_000;
    const corrected = evaluateSideIncomeRecommendation(correctedInput);

    const saved = appendSideIncomeRecommendationRecalculation(created, {
      id: "recalculation:revenue-correction",
      recalculatedAt: "2026-11-07T09:00:00.000Z",
      reason: "Corrected the revenue forecast source.",
      correctedFactIds: ["fact:company-revenue-2026"],
      recommendation: corrected,
    });

    expect(saved.originalRecommendation).toEqual(frozen);
    expect(saved.recalculations).toHaveLength(1);
    expect(saved.recalculations[0]?.recommendation.sideIncomeCaseRevision).toBe(2);
  });

  it("reconciles actual results without treating unknown evidence as fact", () => {
    const created = decision();
    const chosen = created.originalRecommendation.assessments.find(
      ({ candidate }) => candidate.id === created.chosenCandidateId,
    );
    if (chosen === undefined) throw new Error("Missing chosen candidate");
    const observed = appendSideIncomeActualObservation(created, {
      id: "actual:year-one",
      candidateId: created.chosenCandidateId,
      observedAt: "2027-04-30T12:00:00.000Z",
      metrics: {
        ...chosen.candidate.metrics,
        incrementalHouseholdCashPence: 4_000_000,
        totalTaxPence: 2_000_000,
      },
      evidence: [
        {
          id: "evidence:actual:bank",
          kind: "household-fact",
          label: "Household cash received",
          value: "£40,000",
          sourceId: "bank-import:2027-04",
          sourceRevision: "1",
          validOn: "2027-04-30",
          certainty: "actual",
        },
        {
          id: "evidence:actual:tax",
          kind: "tax-rule",
          label: "Final tax liability",
          value: "Return not filed",
          sourceId: "self-assessment:2026-27",
          sourceRevision: "draft",
          validOn: "2027-04-30",
          certainty: "unknown",
        },
      ],
      note: "Cash is observed; the final tax liability remains unknown.",
      divergenceSources: [
        {
          kind: "changed-reality",
          label: "Customer paid later than forecast",
          impactPence: -200_000,
          sourceEvidenceIds: ["evidence:actual:bank"],
        },
      ],
    });
    const reconciliation = reconcileSideIncomeRecommendationDecision(observed)[0];

    expect(reconciliation?.variances).toContainEqual(
      expect.objectContaining({
        metric: "incrementalHouseholdCashPence",
        actual: 4_000_000,
        variance: expect.any(Number),
      }),
    );
    expect(reconciliation?.uncertaintyPreserved).toBe(true);
    expect(created.actualObservations).toHaveLength(0);
  });

  it("triggers a review for revenue, employment, cash need, costs, and rules", () => {
    const created = decision();
    const current = originalSignals.map((signal) => ({
      ...signal,
      value: `${signal.value} changed`,
      sourceRevision: "2",
    }));
    const triggers = detectSideIncomeRecommendationReviewTriggers(
      created,
      current,
      "2027-01-10T08:00:00.000Z",
    );
    const saved = appendSideIncomeRecommendationReviews(created, triggers);

    expect(new Set(triggers.map(({ kind }) => kind))).toEqual(
      new Set([
        "revenue",
        "employment",
        "household-cash-need",
        "cost",
        "rule-version",
      ]),
    );
    expect(saved.reviews.every(({ state }) => state === "review-required")).toBe(
      true,
    );
  });

  it("exports questions and uncertainty without taking legal or tax actions", () => {
    const packet = buildSideIncomeAccountantReviewPacket(
      decision(),
      "2026-11-06T15:00:00.000Z",
    );

    expect(packet.questions.length).toBeGreaterThan(0);
    expect(packet.uncertainAssumptions).toContainEqual(
      expect.objectContaining({ label: "future extraction", status: "estimated" }),
    );
    expect(packet.automaticActions).toEqual([]);
    expect(packet.disclaimer).toMatch(/does not incorporate|register with HMRC/);
  });

  it("rejects a preference-based choice of an ineligible route", () => {
    const insideInput = structuredClone(
      growingRetainedProfitRecommendationScenario,
    );
    const company = insideInput.candidates.find(
      ({ route }) => route === "uk-limited-company",
    );
    if (company === undefined) throw new Error("Missing company candidate");
    company.eligibility.state = "ineligible";
    company.eligibility.legalOrStatusBasis = "The supplied status is inside.";
    const result = evaluateSideIncomeRecommendation(insideInput);

    expect(() =>
      createSideIncomeRecommendationDecision({
        id: "decision:invalid-company",
        savedAt: "2026-11-06T14:00:00.000Z",
        chosenCandidateId: company.id,
        action: {
          kind: "prepare-manual-change",
          detail: "Choose the high-cash route.",
        },
        rationale: "It has more forecast cash.",
        originalRecommendation: result,
        originalReviewSignals: originalSignals,
      }),
    ).toThrow(/legally ineligible/);
  });
});
