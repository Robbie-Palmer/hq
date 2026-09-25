import {
  createKnowledgeScope,
  normalizeKnowledgeScopeArchiveReason,
  type KnowledgeScopeInput,
  validateKnowledgeScopeRelationships,
  WorkGraphError,
} from "../src/index";

describe("knowledge scope mirrors", () => {
  it("normalizes optional scheduling fields", () => {
    expect(
      createKnowledgeScope({
        id: "work-graph",
        kind: "project",
        title: "Work Graph",
        canonicalUrl: "https://example.test/projects/work-graph",
        markdownUrl: "https://example.test/projects/work-graph.md",
      }),
    ).toEqual({
      id: "work-graph",
      kind: "project",
      title: "Work Graph",
      canonicalUrl: "https://example.test/projects/work-graph",
      markdownUrl: "https://example.test/projects/work-graph.md",
      sourceRevision: null,
      lifecycle: "active",
      archiveReason: null,
      rank: null,
    });
  });

  it.each([
    [{ id: "", kind: "project" }, "invalid_knowledge_scope_id"],
    [{ id: "scope", kind: "team" }, "invalid_knowledge_scope_kind"],
    [
      { id: "scope", kind: "project", title: "" },
      "invalid_knowledge_scope_title",
    ],
    [
      { id: "scope", kind: "project", canonicalUrl: "relative" },
      "invalid_knowledge_scope_url",
    ],
    [
      { id: "scope", kind: "project", sourceRevision: "" },
      "invalid_knowledge_scope_source_revision",
    ],
    [{ id: "scope", kind: "project", rank: 0 }, "invalid_knowledge_scope_rank"],
  ] as const)("rejects invalid mirror fields", (override, code) => {
    expect(() =>
      createKnowledgeScope(
        Object.assign(
          {
            id: "scope",
            kind: "project",
            title: "Scope",
            canonicalUrl: "https://example.test/scope",
            markdownUrl: "https://example.test/scope.md",
          },
          override,
        ) as KnowledgeScopeInput,
      ),
    ).toThrowError(expect.objectContaining<Partial<WorkGraphError>>({ code }));
  });
});

describe("knowledge scope lifecycle", () => {
  it("keeps a specific reason for removing a scope from active scheduling", () => {
    expect(normalizeKnowledgeScopeArchiveReason("Completed project")).toBe(
      "Completed project",
    );
  });

  it.each(["", "   ", "a".repeat(10_001)])(
    "rejects an invalid archive reason",
    (reason) => {
      expect(() => normalizeKnowledgeScopeArchiveReason(reason)).toThrowError(
        expect.objectContaining<Partial<WorkGraphError>>({
          code: "invalid_knowledge_scope_archive_reason",
        }),
      );
    },
  );
});

describe("knowledge scope relationships", () => {
  const ids = new Set(["initiative", "project", "child"]);

  it("allows one scope to inherit from more than one parent", () => {
    expect(() =>
      validateKnowledgeScopeRelationships(ids, [
        {
          parentKnowledgeScopeId: "initiative",
          childKnowledgeScopeId: "project",
        },
        {
          parentKnowledgeScopeId: "child",
          childKnowledgeScopeId: "project",
        },
      ]),
    ).not.toThrow();
  });

  it("rejects duplicate, missing, and cyclic relationships", () => {
    const relationship = {
      parentKnowledgeScopeId: "initiative",
      childKnowledgeScopeId: "project",
    };
    expect(() =>
      validateKnowledgeScopeRelationships(ids, [relationship, relationship]),
    ).toThrowError(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "knowledge_scope_relationship_already_exists",
      }),
    );
    expect(() =>
      validateKnowledgeScopeRelationships(ids, [
        { ...relationship, childKnowledgeScopeId: "missing" },
      ]),
    ).toThrowError(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "knowledge_scope_not_found",
      }),
    );
    expect(() =>
      validateKnowledgeScopeRelationships(ids, [
        relationship,
        {
          parentKnowledgeScopeId: "project",
          childKnowledgeScopeId: "initiative",
        },
      ]),
    ).toThrowError(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "knowledge_scope_cycle",
      }),
    );
  });
});
