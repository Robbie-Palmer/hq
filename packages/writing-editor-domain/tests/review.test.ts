import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Readable } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import {
  applyDecisions,
  createDecision,
  createFinding,
  createProposal,
  createSuggestion,
  prepareReviewRecords,
  renderProposalDiff,
  ReviewConflictError,
  runReviewSession,
  sourceReference,
} from "../src";
import { main as reviewCommand } from "../src/review-cli";

const source = "# Draft\n\nCafé is very unique. It works well.\n";
const reference = sourceReference("draft.md", "git:abc123", source);
const timing = {
  reviewStartedAt: "2026-09-26T08:00:00.000Z",
  decidedAt: "2026-09-26T08:00:01.000Z",
};

function span(text: string) {
  const characterOffset = source.indexOf(text);
  const startByte = Buffer.byteLength(source.slice(0, characterOffset), "utf8");
  return {
    startByte,
    endByte: startByte + Buffer.byteLength(text, "utf8"),
    sourceText: text,
  };
}

function suggestion(text: string, replacement: string, producerId = "vale") {
  return createSuggestion({
    producer: {
      id: producerId,
      version: "1.2.3",
      provenance: { kind: "rule", ruleId: "plain-language" },
    },
    source: reference,
    span: span(text),
    replacement,
    category: "style",
    reason: "Use the direct wording.",
  });
}

function records() {
  const finding = createFinding({
    producer: {
      id: "detector",
      version: "2.0.0",
      provenance: { kind: "rule", ruleId: "review-only" },
    },
    source: reference,
    span: span("Café"),
    category: "needs-context",
    reason: "Check the name against the source.",
  });
  const first = createProposal([suggestion("very unique", "unique")]);
  const grouped = createProposal([
    suggestion("works", "reads"),
    suggestion("well", "cleanly"),
  ]);
  return { finding, first, grouped };
}

describe("repository review", () => {
  it("validates UTF-8 source records and sorts findings and proposals", () => {
    const { finding, first, grouped } = records();
    const prepared = prepareReviewRecords({
      documentId: "draft.md",
      revision: "git:abc123",
      findings: [finding],
      proposals: [grouped, first],
    }, source);

    expect(prepared.findings).toEqual([finding]);
    expect(prepared.proposals.map(({ proposalId }) => proposalId)).toEqual([
      first.proposalId,
      grouped.proposalId,
    ]);
    expect(renderProposalDiff(grouped, source, "draft.md")).toContain(
      "-Café is very unique. It works well.",
    );
    expect(renderProposalDiff(grouped, source, "draft.md")).toContain(
      "+Café is very unique. It reads cleanly.",
    );
  });

  it("stops before display when a hash or span is stale", () => {
    const { finding, first } = records();
    expect(() => prepareReviewRecords({
      documentId: "draft.md",
      revision: "git:abc123",
      findings: [finding],
      proposals: [first],
    }, source.replace("unique", "distinctive"))).toThrow(ReviewConflictError);
  });

  it("applies accepted and changed decisions while leaving rejected text alone", () => {
    const { first, grouped } = records();
    const output = applyDecisions(source, [
      createDecision(first, "accepted", timing),
      createDecision(grouped, "changed", "succeeds", timing),
    ]);
    expect(output).toBe("# Draft\n\nCafé is unique. It succeeds.\n");

    expect(applyDecisions(source, [
      createDecision(first, "rejected", timing),
    ])).toBe(source);
  });

  it("persists each outcome and resumes an interrupted session", async () => {
    const { first, grouped } = records();
    const prepared = prepareReviewRecords({
      documentId: "draft.md",
      revision: "git:abc123",
      proposals: [first, grouped],
      findings: [],
    }, source);
    const recordDecision = vi.fn(async () => undefined);
    const answers = [
      { outcome: "accepted" as const },
      { outcome: "quit" as const },
    ];
    const paused = await runReviewSession({
      source,
      records: prepared,
      decide: vi.fn(async () => answers.shift() ?? { outcome: "quit" as const }),
      recordDecision,
      now: () => timing.reviewStartedAt,
    });

    expect(paused.status).toBe("paused");
    expect(recordDecision).toHaveBeenCalledOnce();
    const existing = paused.decisions;
    const resumedDecide = vi.fn(async () => ({ outcome: "rejected" as const }));
    const completed = await runReviewSession({
      source,
      records: prepared,
      existingDecisions: existing,
      decide: resumedDecide,
      recordDecision: vi.fn(async () => undefined),
      now: () => timing.decidedAt,
    });

    expect(resumedDecide).toHaveBeenCalledOnce();
    expect(completed.status).toBe("completed");
    if (completed.status !== "completed") throw new Error("expected completion");
    expect(completed.source).toBe("# Draft\n\nCafé is unique. It works well.\n");
  });

  it("refuses overlapping accepted proposals", () => {
    const first = createProposal([suggestion("very unique", "unique", "one")]);
    const alternative = createProposal([
      suggestion("very unique", "distinctive", "two"),
    ]);
    expect(() => applyDecisions(source, [
      createDecision(first, "accepted", timing),
      createDecision(alternative, "accepted", timing),
    ])).toThrow(/overlap/);
  });

  it("runs the repository command and writes the decision before the source", async () => {
    const directory = await mkdtemp(join(tmpdir(), "writing-editor-review-"));
    try {
      const sourcePath = join(directory, "draft.md");
      const manifestPath = join(directory, "review.json");
      const decisionPath = `${sourcePath}.decisions.jsonl`;
      const { first } = records();
      await writeFile(sourcePath, source, "utf8");
      await writeFile(manifestPath, JSON.stringify({
        sourcePath: "draft.md",
        documentId: "draft.md",
        revision: "git:abc123",
        findings: [],
        proposals: [first],
      }), "utf8");
      const output = new PassThrough();
      let rendered = "";
      output.on("data", (chunk: Buffer) => {
        rendered += chunk.toString("utf8");
      });

      await reviewCommand([manifestPath], {
        input: Readable.from(["a\n"]),
        output,
      });

      expect(rendered).toContain("Actionable proposals (1)");
      expect(rendered).toContain("Review complete.");
      expect(await readFile(sourcePath, "utf8")).toBe(
        "# Draft\n\nCafé is unique. It works well.\n",
      );
      const decision = JSON.parse(await readFile(decisionPath, "utf8"));
      expect(decision).toMatchObject({
        outcome: "accepted",
        proposalId: first.proposalId,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
