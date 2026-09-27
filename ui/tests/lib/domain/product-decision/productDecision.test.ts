import { describe, expect, it } from "vitest";
import {
  ProductDecisionFrontmatterSchema,
  ProductDecisionStatusSchema,
} from "@/lib/domain/product-decision/productDecision";

const acceptedDecision = {
  title: "PDR 001: Publish agent-readable project pages",
  date: "2026-09-20",
  status: "Accepted",
  decision_date: "2026-09-21",
  evidence: [
    {
      title: "Agent Markdown integration tests",
      url: "https://example.com/evidence/agent-markdown",
    },
  ],
  outcome_metrics: [
    {
      name: "Project coverage",
      target: "Every public project has a Markdown twin",
      measurement: "Run the generated-route coverage test",
    },
  ],
  implementation_evidence: [
    {
      title: "Markdown route pull request",
      url: "https://github.com/example/repository/pull/1",
    },
  ],
  ideas: ["context-engineering"],
  affected_projects: ["personal-knowledge-graph"],
  adrs: ["personal-knowledge-graph:020-mdx"],
} as const;

describe("ProductDecisionFrontmatterSchema", () => {
  it("validates the full frontmatter contract", () => {
    expect(
      ProductDecisionFrontmatterSchema.safeParse(acceptedDecision).success,
    ).toBe(true);
  });

  it.each(["Accepted", "Rejected", "Deprecated"])(
    "requires decision_date for %s decisions",
    (status) => {
      const result = ProductDecisionFrontmatterSchema.safeParse({
        ...acceptedDecision,
        status,
        decision_date: undefined,
        deprecated_date: status === "Deprecated" ? "2026-09-22" : undefined,
      });

      expect(result.success).toBe(false);
    },
  );

  it("keeps Superseded as a derived status", () => {
    expect(ProductDecisionStatusSchema.parse("Superseded")).toBe("Superseded");
    expect(
      ProductDecisionFrontmatterSchema.safeParse({
        ...acceptedDecision,
        status: "Superseded",
      }).success,
    ).toBe(false);
  });

  it("requires deprecation dates only for deprecated decisions", () => {
    expect(
      ProductDecisionFrontmatterSchema.safeParse({
        ...acceptedDecision,
        status: "Deprecated",
        deprecated_date: "2026-09-22",
      }).success,
    ).toBe(true);
    expect(
      ProductDecisionFrontmatterSchema.safeParse({
        ...acceptedDecision,
        deprecated_date: "2026-09-22",
      }).success,
    ).toBe(false);
  });

  it("rejects backwards lifecycle dates", () => {
    expect(
      ProductDecisionFrontmatterSchema.safeParse({
        ...acceptedDecision,
        decision_date: "2026-09-19",
      }).success,
    ).toBe(false);
  });

  it("requires at least one affected project", () => {
    expect(
      ProductDecisionFrontmatterSchema.safeParse({
        ...acceptedDecision,
        affected_projects: [],
      }).success,
    ).toBe(false);
  });

  it("validates supersession references as PDR slugs", () => {
    expect(
      ProductDecisionFrontmatterSchema.safeParse({
        ...acceptedDecision,
        supersedes: "001-original-choice",
      }).success,
    ).toBe(true);
    expect(
      ProductDecisionFrontmatterSchema.safeParse({
        ...acceptedDecision,
        supersedes: "personal-knowledge-graph:001-original-choice",
      }).success,
    ).toBe(false);
  });
});
