import { describe, expect, it } from "vitest";
import {
  AuthoredTermCandidateSchema,
  AuthoredTermProvenanceSchema,
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
});
