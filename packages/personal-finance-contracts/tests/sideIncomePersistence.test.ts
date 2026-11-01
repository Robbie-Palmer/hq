import { describe, expect, it } from "vitest";
import {
  requireSideIncomeScope,
  type SideIncomeAuthorization,
  SideIncomeCaseRevisionSchema,
  SideIncomeCorrectionCommandSchema,
  SideIncomeExportRequestSchema,
  SideIncomeImportRequestSchema,
} from "../src/sideIncomePersistence";
import { smallSideIncomeCase } from "../src/sideIncomeSyntheticCases";

const authorization: SideIncomeAuthorization = {
  actorId: "person:owner",
  householdId: "household:synthetic",
  grantedScopes: [
    "side-income:read",
    "side-income:write",
    "side-income:import",
    "side-income:export",
    "side-income:correct",
  ],
  authorizedAt: "2026-10-31T00:00:00.000Z",
  expiresAt: "2026-11-01T00:00:00.000Z",
};

describe("side-income persistence contracts", () => {
  it("requires the right household, scope, and active time", () => {
    expect(
      requireSideIncomeScope(
        authorization,
        "side-income:import",
        "household:synthetic",
        "2026-10-31T12:00:00.000Z",
      ),
    ).toEqual(authorization);
    expect(() =>
      requireSideIncomeScope(
        authorization,
        "side-income:import",
        "household:other",
        "2026-10-31T12:00:00.000Z",
      ),
    ).toThrow(/household/);
    expect(() =>
      requireSideIncomeScope(
        { ...authorization, grantedScopes: ["side-income:read"] },
        "side-income:import",
        "household:synthetic",
        "2026-10-31T12:00:00.000Z",
      ),
    ).toThrow(/grant/);
    expect(() =>
      requireSideIncomeScope(
        authorization,
        "side-income:import",
        "household:synthetic",
        "2026-11-01T00:00:00.000Z",
      ),
    ).toThrow(/not active/);
  });

  it("allows validate-only or append imports and forbids implicit replacement", () => {
    expect(
      SideIncomeImportRequestSchema.parse({
        authorization,
        mode: "append",
        conflictPolicy: "reject",
        importedAt: "2026-10-31T12:00:00.000Z",
        cases: [smallSideIncomeCase],
      }).mode,
    ).toBe("append");
    expect(
      SideIncomeImportRequestSchema.safeParse({
        authorization,
        mode: "replace",
        conflictPolicy: "overwrite",
        importedAt: "2026-10-31T12:00:00.000Z",
        cases: [smallSideIncomeCase],
      }).success,
    ).toBe(false);
  });

  it("models corrections as new revisions without changing identity", () => {
    expect(
      SideIncomeCorrectionCommandSchema.parse({
        authorization,
        caseId: smallSideIncomeCase.id,
        expectedRevision: 1,
        replacement: smallSideIncomeCase,
        reason: "Corrected an imported revenue amount.",
        correctedAt: "2026-10-31T12:00:00.000Z",
      }).caseId,
    ).toBe(smallSideIncomeCase.id);
    expect(
      SideIncomeCaseRevisionSchema.safeParse({
        case: smallSideIncomeCase,
        revision: 2,
        persistedAt: "2026-10-31T12:00:00.000Z",
        supersedesRevision: 1,
        correctionReason: null,
      }).success,
    ).toBe(false);
    expect(
      SideIncomeCorrectionCommandSchema.safeParse({
        authorization,
        caseId: "case:different",
        expectedRevision: 1,
        replacement: smallSideIncomeCase,
        reason: "Wrong identity.",
        correctedAt: "2026-10-31T12:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("requires export authority and makes revision-history intent explicit", () => {
    expect(
      SideIncomeExportRequestSchema.parse({
        authorization,
        requestedAt: "2026-10-31T12:00:00.000Z",
        caseIds: [smallSideIncomeCase.id],
        includeRevisionHistory: true,
      }).includeRevisionHistory,
    ).toBe(true);
    expect(
      SideIncomeExportRequestSchema.safeParse({
        authorization: {
          ...authorization,
          grantedScopes: ["side-income:read"],
        },
        requestedAt: "2026-10-31T12:00:00.000Z",
        caseIds: [smallSideIncomeCase.id],
        includeRevisionHistory: true,
      }).success,
    ).toBe(false);
  });
});
