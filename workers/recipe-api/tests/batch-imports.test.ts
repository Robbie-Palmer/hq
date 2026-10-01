import {
  CreateBatchSchema,
  MutableBatchDraftSchema,
} from "recipe-domain/batch-import";
import { describe, expect, it } from "vitest";
import { batchProgress, preflightSources } from "../src/batch-imports";

describe("batch preflight", () => {
  it("identifies duplicates across normalized URLs and preserves source order", () => {
    const sources = [
      { type: "url" as const, url: "https://recipes.example.test/soup#intro" },
      {
        type: "file" as const,
        filename: "soup.cook",
        content: "Mix @salt{1%g}.",
      },
      { type: "url" as const, url: "https://recipes.example.test/soup#recipe" },
      { type: "url" as const, url: "http://127.0.0.1/private" },
    ];
    const result = preflightSources(sources);
    expect(result.map((value) => value.position)).toEqual([0, 1, 2, 3]);
    expect(result[0]?.error).toBeUndefined();
    expect(result[1]?.label).toBe("soup.cook");
    expect(result[2]?.error).toMatch(/Duplicate/);
    expect(result[3]?.error).toMatch(/cannot be accessed/);
  });
  it("accepts 20 mixed sources and rejects excess count, unsupported files and multibyte oversize", () => {
    const input = {
      idempotencyKey: crypto.randomUUID(),
      sources: Array.from({ length: 20 }, (_, index) => ({
        type: "url",
        url: `https://example.test/${index}`,
      })),
    };
    expect(CreateBatchSchema.parse(input).sources).toHaveLength(20);
    expect(
      CreateBatchSchema.safeParse({
        ...input,
        sources: Array(51).fill(input.sources[0]),
      }).success,
    ).toBe(false);
    for (const source of [
      { type: "file", filename: "file.exe", content: "content" },
      { type: "file", filename: "file.cook", content: "界".repeat(40000) },
    ]) {
      expect(
        CreateBatchSchema.safeParse({ ...input, sources: [source] }).success,
      ).toBe(false);
    }
  });
  it("allows incomplete editor drafts to survive autosave", () => {
    expect(
      MutableBatchDraftSchema.safeParse({
        title: "",
        description: "",
        cuisine: "",
        servings: 1,
        source: "",
      }).success,
    ).toBe(true);
  });
});

describe("batch progress", () => {
  it("derives counters from child execution and review states", () => {
    expect(
      batchProgress([
        { status: "queued", reviewState: "waiting" },
        { status: "running", reviewState: "waiting" },
        { status: "succeeded", reviewState: "ready" },
        { status: "failed", reviewState: "needs_attention" },
        { status: "succeeded", reviewState: "accepted" },
        { status: "failed", reviewState: "skipped" },
      ]),
    ).toEqual({
      status: "processing",
      counts: { processing: 2, ready: 1, failed: 1, accepted: 1, skipped: 1 },
    });
    expect(
      batchProgress([{ status: "failed", reviewState: "needs_attention" }])
        .status,
    ).toBe("awaiting_review");
    expect(
      batchProgress([
        { status: "succeeded", reviewState: "accepted" },
        { status: "failed", reviewState: "skipped" },
      ]).status,
    ).toBe("completed");
  });
});
