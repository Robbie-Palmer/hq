import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { legacyADRAliases } from "@/content/adr-aliases";

describe("legacy ADR aliases", () => {
  it("inventories every historical ADR URL exactly once", () => {
    expect(legacyADRAliases).toHaveLength(151);
    expect(new Set(legacyADRAliases.map(({ alias }) => alias)).size).toBe(151);
  });

  it("preserves every authored stub body as migration evidence", () => {
    const aliasesWithNotes = legacyADRAliases.filter(({ notes }) => notes);

    expect(aliasesWithNotes).toHaveLength(45);
    expect(
      aliasesWithNotes.find(
        ({ alias }) => alias === "homelab:024-doppler-secrets",
      ),
    ).toMatchObject({
      title: "ADR 024: Doppler for homelab secrets",
      notes: expect.stringContaining("# Recovery and migration"),
    });
  });

  it("preserves every canonical URL changed by sequence compaction", () => {
    const compactedAliases = legacyADRAliases.filter(({ alias, target }) => {
      const aliasProject = alias.slice(0, alias.indexOf(":"));
      const targetProject = target.slice(0, target.indexOf(":"));
      return aliasProject === targetProject;
    });

    expect(compactedAliases).toHaveLength(64);
  });

  it("redirects the superseded digital infrastructure draft URLs", () => {
    const aliases = new Map(
      legacyADRAliases.map(({ alias, target }) => [alias, target]),
    );

    expect(aliases.get("homelab:023-proton-drive-document-library")).toBe(
      "personal-digital-infrastructure:000-filen-document-library-trial",
    );
    expect(aliases.get("homelab:024-restic-backblaze-personal-archive")).toBe(
      "homelab:023-restic-backblaze-personal-archive",
    );
    expect(aliases.get("homelab:025-human-and-machine-secret-boundaries")).toBe(
      "personal-digital-infrastructure:001-proton-pass-trial",
    );
    expect(aliases.get("homelab:026-proton-vpn-programmable-egress")).toBe(
      "homelab:024-proton-vpn-programmable-egress",
    );
    expect(aliases.get("homelab:027-ente-locker-recovery-packet")).toBe(
      "personal-digital-infrastructure:003-ente-locker-recovery-packet",
    );
  });

  it.each([
    "agentic-code-review",
    "homelab",
    "personal-knowledge-graph",
    "recipe-site",
    "work-graph",
  ])("keeps %s ADR numbers unique and ordered", (projectSlug) => {
    const adrDir = path.join(
      process.cwd(),
      "content",
      "projects",
      projectSlug,
      "adrs",
    );
    const actualNumbers = fs
      .readdirSync(adrDir)
      .filter((file) => file.endsWith(".mdx"))
      .sort()
      .map((file) => file.slice(0, 3));
    expect(new Set(actualNumbers).size).toBe(actualNumbers.length);
    expect(actualNumbers).toEqual([...actualNumbers].sort());
  });
});
