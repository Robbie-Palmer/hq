import { describe, expect, it } from "vitest";
import {
  ShoppingListCommandBodySchema,
  ShoppingListCommandRequestSchema,
} from "../src/shopping-list";

const command = {
  type: "set_checked",
  itemType: "ingredient",
  itemId: "garlic",
  checked: true,
} as const;

describe("shopping-list command schemas", () => {
  it("validates the path identity and command body together", () => {
    expect(
      ShoppingListCommandRequestSchema.parse({
        commandId: "019a1d20-1111-7111-8111-111111111111",
        listId: "019a1d20-2222-7222-8222-222222222222",
        baseRevision: "12",
        command,
      }),
    ).toEqual({
      commandId: "019a1d20-1111-7111-8111-111111111111",
      listId: "019a1d20-2222-7222-8222-222222222222",
      baseRevision: "12",
      command,
    });
  });

  it("rejects malformed revisions and checklist commands", () => {
    expect(
      ShoppingListCommandBodySchema.safeParse({
        baseRevision: "latest",
        command,
      }).success,
    ).toBe(false);
    expect(
      ShoppingListCommandBodySchema.safeParse({
        baseRevision: "12",
        command: { ...command, itemType: "unknown" },
      }).success,
    ).toBe(false);
  });
});
