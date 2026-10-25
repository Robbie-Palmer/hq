import { describe, expect, it } from "vitest";

import {
  applyDecisions,
  createDecision,
  createPassageRewrite,
  evaluatePassageRewrites,
  passageEvidenceGate,
  ProposalSchema,
  renderProposalReview,
  retrievePassageContext,
} from "../src";

const source = [
  "# Draft",
  "",
  "Café uses ModelPack. The result is current.",
  "",
  "Closing note.",
  "",
].join("\n");
const passageText = "Café uses ModelPack. The result is current.";
const proposedPassage = "Café packages models with ModelPack. The result remains current.";
const characterStart = source.indexOf(passageText);
const passage = {
  startByte: Buffer.byteLength(source.slice(0, characterStart), "utf8"),
  endByte:
    Buffer.byteLength(source.slice(0, characterStart), "utf8") +
    Buffer.byteLength(passageText, "utf8"),
  sourceText: passageText,
};
const retrievedAt = "2026-10-25T12:00:00.000Z";

function context() {
  return retrievePassageContext({
    snapshot: {
      retrievedAt,
      nodes: [
        {
          id: "project:agent-first-writing",
          name: "Agent-first Writing Editor",
          type: "project",
          href: "/projects/agent-first-writing",
          connections: 3,
        },
        {
          id: "adr:agent-first-writing/010-modelpack-compatible-model-metadata",
          name: "ADR 010: ModelPack-compatible model metadata",
          type: "adr",
          href: "/projects/agent-first-writing/adrs/010-modelpack-compatible-model-metadata",
        },
        {
          id: "technology:modelpack",
          name: "ModelPack",
          type: "technology",
          href: "/technologies/modelpack",
        },
        {
          id: "adr:another-project/001-foreign-term",
          name: "ADR 001: Foreign terminology",
          type: "adr",
        },
        {
          id: "technology:foreign-term",
          name: "ForeignTerm",
          type: "technology",
        },
      ],
      edges: [
        {
          source: "adr:agent-first-writing/010-modelpack-compatible-model-metadata",
          target: "project:agent-first-writing",
          type: "PART_OF_PROJECT",
          provenance: { source: "frontmatter" },
        },
        {
          source: "project:agent-first-writing",
          target: "technology:modelpack",
          type: "USES_TECHNOLOGY",
        },
        {
          source: "adr:another-project/001-foreign-term",
          target: "technology:foreign-term",
          type: "USES_TECHNOLOGY",
        },
      ],
      evidenceSignals: [{
        id: "evidence:modelpack-current",
        label: "ModelPack compatibility check",
        href: "/evidence/modelpack-current",
        observedAt: "2026-09-01T00:00:00.000Z",
        validUntil: "2026-10-01T00:00:00.000Z",
      }],
    },
    query: {
      projectId: "project:agent-first-writing",
      adrIds: [
        "adr:agent-first-writing/010-modelpack-compatible-model-metadata",
        "adr:agent-first-writing/missing",
        "adr:another-project/001-foreign-term",
      ],
      terminologyIds: [
        "technology:modelpack",
        "terminology:missing",
        "technology:foreign-term",
      ],
      evidenceIds: ["evidence:modelpack-current", "evidence:missing"],
    },
  });
}

function proposal() {
  return createPassageRewrite({
    documentId: "draft.md",
    revision: "git:abc123",
    source,
    passage,
    proposedPassage,
    reason: "Make the model packaging claim explicit without changing its terminology.",
    producer: {
      id: "context-bounded-passage-rewriter",
      version: "1.0.0",
      provenance: {
        kind: "model",
        modelId: "reviewed-upstream-rewrite",
        revision: "prompt:v1",
      },
    },
    context: context(),
    evidenceGate: {
      gateId: "passage-rewrite-pilot-v1",
      evaluationId: `passage-evaluation:v1:${"a".repeat(64)}`,
      decision: "gather-more-evidence",
      evaluatedAt: retrievedAt,
    },
  });
}

describe("context-bounded passage rewrites", () => {
  it("retrieves project context and exposes missing or stale evidence", () => {
    const retrieved = context();

    expect(retrieved.citations).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "project", freshness: "not-applicable" }),
      expect.objectContaining({ kind: "adr", freshness: "missing" }),
      expect.objectContaining({ kind: "terminology", label: "ModelPack" }),
      expect.objectContaining({
        kind: "terminology",
        id: "technology:foreign-term",
        freshness: "missing",
      }),
      expect.objectContaining({ kind: "evidence", freshness: "stale" }),
    ]));
    expect(retrieved.warnings.map(({ code }) => code)).toEqual(expect.arrayContaining([
      "fact-check-required",
      "missing-context",
      "terminology-context-missing",
      "stale-evidence",
    ]));
  });

  it("decomposes one bounded rewrite into a source-verified grouped proposal", () => {
    const result = proposal();
    const review = result.review;
    expect(review).toBeDefined();
    expect(result.suggestions.length).toBeGreaterThan(1);
    expect(result.suggestions.every(
      ({ span }) => span.startByte >= passage.startByte && span.endByte <= passage.endByte,
    )).toBe(true);
    expect(review).toMatchObject({
      proposedText: proposedPassage,
      defaultLoopEligible: false,
      authority: { factChecking: "author", publication: "author" },
    });

    const accepted = applyDecisions(source, [createDecision(result, "accepted", {
      reviewStartedAt: "2026-10-25T12:01:00.000Z",
      decidedAt: "2026-10-25T12:01:05.000Z",
    })]);
    expect(accepted).toBe(source.replace(passageText, proposedPassage));

    const rendered = renderProposalReview(result, source, "draft.md");
    expect(rendered).toContain("Reason: Make the model packaging claim explicit");
    expect(rendered).toContain("ADR 010: ModelPack-compatible model metadata");
    expect(rendered).toContain("expired before the context snapshot was retrieved");
    expect(rendered).toContain("Default loop: disabled");
    expect(rendered).toContain("@@");
  });

  it("uses the whole selected passage for a reviewer-changed replacement", () => {
    const result = proposal();
    const changed = applyDecisions(source, [createDecision(
      result,
      "changed",
      "The author supplied this replacement.",
      {
        reviewStartedAt: "2026-10-25T12:01:00.000Z",
        decidedAt: "2026-10-25T12:01:05.000Z",
      },
    )]);

    expect(changed).toBe(
      source.replace(passageText, "The author supplied this replacement."),
    );
  });

  it("rejects stale selections, no-op rewrites, and proposals that escape the passage", () => {
    const request = {
      documentId: "draft.md",
      revision: "git:abc123",
      source,
      passage,
      proposedPassage,
      reason: "Bounded rewrite.",
      producer: {
        id: "rewriter",
        version: "1.0.0",
        provenance: { kind: "rule" as const, ruleId: "fixture" },
      },
      context: context(),
      evidenceGate: {
        gateId: "pilot",
        evaluationId: `passage-evaluation:v1:${"b".repeat(64)}`,
        decision: "gather-more-evidence" as const,
        evaluatedAt: retrievedAt,
      },
    };
    expect(() => createPassageRewrite({
      ...request,
      passage: {
        ...passage,
        sourceText: "Café uses ModelPack. The result is outcome.",
      },
    })).toThrow(/does not match/);
    expect(() => createPassageRewrite({
      ...request,
      proposedPassage: passage.sourceText,
    })).toThrow(/must change/);

    const valid = proposal();
    expect(() => ProposalSchema.parse({
      ...valid,
      review: { ...valid.review, proposedText: `${proposedPassage} extra` },
    })).toThrow(/recreate proposedText/);
  });

  it("keeps per-case preservation failures visible behind aggregate scores", () => {
    const proposalId = proposal().proposalId;
    const assessments = Array.from({ length: 10 }, (_, index) => ({
      caseId: `case-${index + 1}`,
      proposalId,
      outcome: "accepted" as const,
      factualPreservation: index === 9 ? "failed" as const : "preserved" as const,
      terminologyPreservation: "preserved" as const,
      voicePreservation: "preserved" as const,
      usefulEdit: true,
      reviewMilliseconds: 1_000 + index,
      notes: index === 9 ? ["The rewrite changed a measured quantity."] : [],
    }));
    const gate = {
      gateId: "passage-rewrite-pilot-v1",
      minimumCases: 10,
      minimumFactualPreservation: 0.9,
      minimumTerminologyPreservation: 1,
      minimumVoicePreservation: 1,
      minimumUsefulEditYield: 0.8,
      maximumMedianReviewMilliseconds: 2_000,
      requireAllPreservationAssessed: true,
      allowCriticalFailures: false,
    };
    const evaluation = evaluatePassageRewrites({ gate, assessments });

    expect(evaluation.metrics.factualPreservation).toBe(0.9);
    expect(evaluation.gates.factualPreservation).toBe(true);
    expect(evaluation.gates.criticalFailures).toBe(false);
    expect(evaluation.caseFailures).toEqual([expect.objectContaining({
      caseId: "case-10",
      dimensions: ["facts"],
    })]);
    expect(evaluation.decision).toBe("gather-more-evidence");
    expect(passageEvidenceGate(evaluation, retrievedAt)).toMatchObject({
      evaluationId: evaluation.evaluationId,
      decision: "gather-more-evidence",
    });

    const adopted = evaluatePassageRewrites({
      gate,
      assessments: assessments.map((assessment) => ({
        ...assessment,
        factualPreservation: "preserved" as const,
        notes: [],
      })),
    });
    expect(adopted.decision).toBe("adopt");
  });
});
