import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { legacyADRAliases } from "@/content/adr-aliases";

describe("legacy ADR aliases", () => {
  it("inventories every historical ADR URL exactly once", () => {
    expect(legacyADRAliases).toHaveLength(146);
    expect(new Set(legacyADRAliases.map(({ alias }) => alias)).size).toBe(146);
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

    expect(compactedAliases).toHaveLength(62);
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
