import { describe, expect, it } from "vitest";
import {
  authoredTermObservationKey,
  AuthoredTermCandidateSchema,
  AuthoredTermProvenanceSchema,
  rankTermReviewQueue,
  TermResolutionCommandSchema,
  termHasCandidateCollision,
  termNeedsLocaleReview,
  normalizeAuthoredTerm,
} from "../src/authored-term";

describe("authored terms", () => {
  it("normalizes spacing and case without discarding meaningful text", () => {
    expect(normalizeAuthoredTerm("  Crème   Fraîche  ", "fr-FR")).toBe(
      "crème fraîche",
    );
    expect(normalizeAuthoredTerm("中華鍋 (小)", "zh-Hant")).toBe("中華鍋 (小)");
  });

  it("uses Unicode compatibility normalization", () => {
    expect(normalizeAuthoredTerm("ＦＯＯＤ　ＭＩＬＬ")).toBe("food mill");
  });

  it("falls back safely when a stored locale is invalid", () => {
    expect(normalizeAuthoredTerm("İRMİK", "not_a_locale")).toBe("i̇rmi̇k");
  });

  it("keeps identity stable across request locales", () => {
    expect(normalizeAuthoredTerm("IRMIK", "tr-TR")).toBe("irmik");
    expect(normalizeAuthoredTerm("IRMIK", "en-IE")).toBe("irmik");
  });

  it("validates candidate scores and import provenance", () => {
    expect(
      AuthoredTermCandidateSchema.safeParse({ slug: "red-onion", score: 1 })
        .success,
    ).toBe(true);
    expect(
      AuthoredTermCandidateSchema.safeParse({ slug: "red-onion", score: 1.1 })
        .success,
    ).toBe(false);
    expect(
      AuthoredTermProvenanceSchema.safeParse({
        kind: "import",
        actorUserId: "user-1",
        importJobId: "11111111-1111-4111-8111-111111111111",
      }).success,
    ).toBe(true);
  });

  it("ranks repeated submissions deterministically", () => {
    const lastSeenAt = new Date("2026-10-30T12:00:00.000Z");
    const ranked = rankTermReviewQueue([
      {
        kind: "equipment" as const,
        normalizedText: "spurtle",
        locale: "en-GB",
        submissionCount: 2,
        tenantCount: 2,
        lastSeenAt,
      },
      {
        kind: "ingredient" as const,
        normalizedText: "scallion",
        locale: "en-US",
        submissionCount: 7,
        tenantCount: 1,
        lastSeenAt,
      },
      {
        kind: "ingredient" as const,
        normalizedText: "spring onion",
        locale: "en-GB",
        submissionCount: 7,
        tenantCount: 3,
        lastSeenAt,
      },
    ]);

    expect(ranked.map(({ normalizedText }) => normalizedText)).toEqual([
      "spring onion",
      "scallion",
      "spurtle",
    ]);
  });

  it("requires explicit review for ambiguous locale and candidate evidence", () => {
    expect(termNeedsLocaleReview("und", ["und"])).toBe(true);
    expect(termNeedsLocaleReview("en-GB", ["en-GB", "en-US"])).toBe(true);
    expect(termNeedsLocaleReview("en-GB", ["en-GB", "und"])).toBe(false);
    expect(termHasCandidateCollision(["green-onion", "spring-onion"])).toBe(
      true,
    );
    expect(termHasCandidateCollision(["green-onion", "green-onion"])).toBe(
      false,
    );
  });

  it("validates action-specific resolution evidence", () => {
    const base = {
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      rationale: "Common regional synonym.",
    };
    expect(
      TermResolutionCommandSchema.safeParse({
        ...base,
        action: "alias",
        targetSlug: "spring-onion",
      }).success,
    ).toBe(true);
    expect(
      TermResolutionCommandSchema.safeParse({
        ...base,
        action: "new_canonical",
        targetSlug: "spurtle",
      }).success,
    ).toBe(false);
    expect(
      TermResolutionCommandSchema.safeParse({
        ...base,
        action: "reversal",
      }).success,
    ).toBe(false);
  });

  it("builds stable observation keys without losing field boundaries", () => {
    const key = authoredTermObservationKey({
      locale: "en-GB",
      sourceContext: {
        flow: "recipe",
        resourceId: "recipe|1",
        field: "ingredients",
      },
      provenance: { kind: "user", actorUserId: "user-1" },
    });
    expect(key).toBe(
      "en-GB|recipe|recipe%7C1|ingredients|user|user-1|",
    );
  });
});
