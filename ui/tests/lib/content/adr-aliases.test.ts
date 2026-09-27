import { describe, expect, it } from "vitest";
import { legacyADRAliases } from "@/content/adr-aliases";

describe("legacy ADR aliases", () => {
  it("inventories every removed inherited ADR stub exactly once", () => {
    expect(legacyADRAliases).toHaveLength(79);
    expect(new Set(legacyADRAliases.map(({ alias }) => alias)).size).toBe(79);
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
});
