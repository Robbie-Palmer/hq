import { validatePostReleaseNote, WorkGraphError } from "../src/index";

describe("post-release note policy", () => {
  it("allows an identified author to append discussion to released work", () => {
    expect(() =>
      validatePostReleaseNote({
        workItemId: "work",
        lifecycle: "released",
        author: "agent-a",
      }),
    ).not.toThrow();
  });

  it.each(["open", "cancelled"] as const)(
    "rejects notes when work is %s",
    (lifecycle) => {
      expect(() =>
        validatePostReleaseNote({
          workItemId: "work",
          lifecycle,
          author: "agent-a",
        }),
      ).toThrowError(
        expect.objectContaining<Partial<WorkGraphError>>({
          code: "work_item_not_released",
        }),
      );
    },
  );

  it("requires author provenance", () => {
    expect(() =>
      validatePostReleaseNote({
        workItemId: "work",
        lifecycle: "released",
        author: "   ",
      }),
    ).toThrowError(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "invalid_note_author",
      }),
    );
  });
});
