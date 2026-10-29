import { describe, expect, it } from "vitest";
import {
  IngestionRunSchema,
  ProjectPlatformAdoptionSchema,
  resolveEffectiveRecord,
  selectLatestSourceRevisions,
  sourceIdentityKey,
  sourceRevisionKey,
} from "../src/model";
import { provenance } from "./fixtures";

describe("source identity and revisions", () => {
  it("uses provider identity as the idempotency boundary", () => {
    const source = provenance("invoice:line-1").source;

    expect(sourceIdentityKey(source.identity)).toBe(
      '["provider:cloud","account:primary","billing-line-item","invoice:line-1"]',
    );
    expect(sourceRevisionKey(source)).toBe(
      '["[\\"provider:cloud\\",\\"account:primary\\",\\"billing-line-item\\",\\"invoice:line-1\\"]","1"]',
    );
  });

  it("projects a late revision without losing an as-of view", () => {
    const original = {
      id: "cost:original",
      provenance: provenance("invoice:line-1"),
    };
    const correction = {
      id: "cost:correction",
      provenance: provenance(
        "invoice:line-1",
        "2",
        "2026-02-10T00:00:00.000Z",
        "2026-02-11T00:00:00.000Z",
      ),
    };

    expect(selectLatestSourceRevisions([original, correction])).toEqual([
      correction,
    ]);
    expect(
      selectLatestSourceRevisions(
        [original, correction],
        "2026-02-05T00:00:00.000Z",
      ),
    ).toEqual([original]);
    expect(
      selectLatestSourceRevisions(
        [original, correction],
        "2026-02-11T00:00:00.000Z",
      ),
    ).toEqual([correction]);
  });
});

describe("ingestion runs", () => {
  const base = {
    id: "run:ingestion",
    providerId: "provider:cloud",
    collector: { id: "collector:billing", version: "1.0.0" },
    startedAt: "2026-02-02T00:00:00.000Z",
    sourceRevision: null,
  };

  it("accepts coherent running and completed states", () => {
    expect(
      IngestionRunSchema.parse({
        ...base,
        status: "running",
        completedAt: null,
      }).status,
    ).toBe("running");
    expect(
      IngestionRunSchema.parse({
        ...base,
        status: "succeeded",
        completedAt: "2026-02-02T01:00:00.000Z",
      }).status,
    ).toBe("succeeded");
  });

  it("rejects completion state contradictions", () => {
    expect(() =>
      IngestionRunSchema.parse({
        ...base,
        status: "running",
        completedAt: "2026-02-02T01:00:00.000Z",
      }),
    ).toThrow(/running ingestion cannot have/);
    expect(() =>
      IngestionRunSchema.parse({
        ...base,
        status: "failed",
        completedAt: null,
      }),
    ).toThrow(/finished ingestion needs/);
    expect(() =>
      IngestionRunSchema.parse({
        ...base,
        status: "partial",
        completedAt: "2026-02-01T23:59:59.000Z",
      }),
    ).toThrow(/cannot complete before/);
  });
});

describe("effective dating", () => {
  const base = {
    id: "adoption:project",
    projectId: "project:site",
    platformId: "platform:engineering",
    rationale: "The project uses the shared platform.",
    provenance: provenance("adoption:project"),
  };

  it("resolves adoption at a point in time", () => {
    const records = [
      ProjectPlatformAdoptionSchema.parse({
        ...base,
        state: "not-adopted",
        effectivePeriod: {
          startsAt: "2025-01-01T00:00:00.000Z",
          endsAt: "2026-01-01T00:00:00.000Z",
        },
      }),
      ProjectPlatformAdoptionSchema.parse({
        ...base,
        id: "adoption:project:2026",
        state: "adopted",
        effectivePeriod: {
          startsAt: "2026-01-01T00:00:00.000Z",
          endsAt: null,
        },
      }),
    ];

    expect(
      resolveEffectiveRecord(records, "2026-03-01T00:00:00.000Z")?.state,
    ).toBe("adopted");
  });

  it("rejects ambiguous effective records", () => {
    const records = [
      ProjectPlatformAdoptionSchema.parse({
        ...base,
        state: "adopted",
        effectivePeriod: {
          startsAt: "2026-01-01T00:00:00.000Z",
          endsAt: null,
        },
      }),
      ProjectPlatformAdoptionSchema.parse({
        ...base,
        id: "adoption:duplicate",
        state: "excluded",
        effectivePeriod: {
          startsAt: "2026-02-01T00:00:00.000Z",
          endsAt: null,
        },
      }),
    ];

    expect(() =>
      resolveEffectiveRecord(records, "2026-03-01T00:00:00.000Z"),
    ).toThrow(/Multiple records/);
  });

  it("includes the start and excludes the end of an effective period", () => {
    const record = ProjectPlatformAdoptionSchema.parse({
      ...base,
      state: "adopted",
      effectivePeriod: {
        startsAt: "2026-01-01T00:00:00.000Z",
        endsAt: "2026-02-01T00:00:00.000Z",
      },
    });

    expect(
      resolveEffectiveRecord([record], "2026-01-01T00:00:00.000Z"),
    ).toEqual(record);
    expect(
      resolveEffectiveRecord([record], "2026-02-01T00:00:00.000Z"),
    ).toBeUndefined();
  });
});
