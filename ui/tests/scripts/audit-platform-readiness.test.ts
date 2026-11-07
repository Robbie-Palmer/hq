import { describe, expect, it } from "vitest";
import {
  buildPlatformReadinessAudit,
  d1SelectionFindings,
} from "@/scripts/audit-platform-readiness";

describe("platform readiness audit", () => {
  it("passes the repository migration and Personal Finance proof", () => {
    const audit = buildPlatformReadinessAudit();

    expect(audit.passed).toBe(true);
    expect(audit.findings).toEqual([]);
    expect(audit.checks.map(({ id }) => id)).toEqual([
      "adr-migration-integrity",
      "canonical-decision-ownership",
      "legacy-adr-routes",
      "personal-finance-provenance",
      "rendered-slot-users",
      "d1-selection-state",
    ]);
  });

  it("rejects D1 prose that presents a selected target", () => {
    expect(
      d1SelectionFindings(
        "## Target architecture\n\nCloudflare D1 stores application records.",
        "project.mdx",
      ),
    ).toEqual([
      "project.mdx:3 presents D1 without a historical or rejected label",
    ]);
  });

  it("allows D1 in an explicitly rejected comparison", () => {
    expect(
      d1SelectionFindings(
        "## Cloudflare Workers + D1 (rejected)\n\nD1 uses SQLite.",
        "adr.mdx",
      ),
    ).toEqual([]);
  });
});
