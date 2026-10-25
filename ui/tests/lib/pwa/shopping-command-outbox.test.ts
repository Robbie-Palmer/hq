import { describe, expect, it } from "vitest";
import { ShoppingCommandOutboxRecordSchema } from "@/lib/pwa/shopping-command-outbox";

const record = {
  key: "user-1:019a1d20-1111-7111-8111-111111111111",
  commandId: "019a1d20-1111-7111-8111-111111111111",
  actorUserId: "user-1",
  resourceId: "household:household-1",
  householdId: "household-1",
  listId: "019a1d20-2222-7222-8222-222222222222",
  baseRevision: "12",
  command: {
    type: "set_checked",
    itemType: "ingredient",
    itemId: "garlic",
    checked: true,
  },
  outcome: "pending",
  attempts: 0,
  nextAttemptAt: 1,
  createdAt: 1,
  updatedAt: 1,
};

describe("shopping command outbox schema", () => {
  it("accepts a complete persisted record", () => {
    expect(ShoppingCommandOutboxRecordSchema.parse(record)).toEqual(record);
  });

  it("rejects invalid outcomes and incomplete metadata", () => {
    expect(
      ShoppingCommandOutboxRecordSchema.safeParse({
        ...record,
        outcome: "unknown",
      }).success,
    ).toBe(false);
    const { householdId: _householdId, ...incomplete } = record;
    expect(
      ShoppingCommandOutboxRecordSchema.safeParse(incomplete).success,
    ).toBe(false);
  });
});
