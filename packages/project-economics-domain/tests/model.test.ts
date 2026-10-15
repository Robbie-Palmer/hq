import { describe, expect, it } from "vitest";
import {
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
});
