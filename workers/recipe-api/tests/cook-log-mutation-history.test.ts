import type { Db } from "recipe-db";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ listCookLogMutationHistory: vi.fn() }));

vi.mock("../src/cook-log/repositories/cook-log-mutation-repository", () => ({
  listCookLogMutationHistory: mocks.listCookLogMutationHistory,
}));

import { listCookLogMutationHistory } from "../src/cook-log/services/list-cook-log-mutation-history";

describe("cook-log mutation history", () => {
  it("maps persistence values into the profile API contract", async () => {
    mocks.listCookLogMutationHistory.mockResolvedValue([
      {
        id: "change-set-1",
        actorType: "agent",
        actorAgentId: "agent-1",
        actorAgentName: "Meal planner",
        actorHostId: "host-1",
        actorHostName: null,
        capability: "cook_log.append",
        targetType: "cook_log",
        targetId: "user-1",
        reason: "Record dinner",
        compensatesChangeSetId: null,
        createdAt: new Date("2026-09-27T18:31:00.000Z"),
        items: [
          {
            sessionId: "0199a770-1111-7111-8111-111111111111",
            beforeValue: null,
            afterValue: null,
            beforeVersion: null,
            afterVersion: 1n,
          },
        ],
      },
    ]);
    const tx = {};
    const db = {
      transaction: vi.fn((operation: (value: typeof tx) => unknown) =>
        operation(tx),
      ),
    } as unknown as Db;

    await expect(
      listCookLogMutationHistory(db, "user-1"),
    ).resolves.toMatchObject([
      {
        id: "change-set-1",
        createdAt: "2026-09-27T18:31:00.000Z",
        items: [{ beforeVersion: null, afterVersion: "1" }],
      },
    ]);
  });
});
