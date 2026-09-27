import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  listAgentMutations,
  undoAgentMutation,
} from "@/lib/api/recipe-agent-mutations";

const fetchMock = vi.fn<typeof fetch>();

describe("recipe agent mutations API", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("parses pantry mutation history and requests an idempotent undo", async () => {
    const changeSetId = "0198f1f0-5555-7555-8555-555555555555";
    fetchMock.mockResolvedValueOnce(
      Response.json({
        items: [
          {
            id: changeSetId,
            actorType: "agent",
            agentId: "agent-1",
            agentName: "Meal planner",
            hostId: "host-1",
            hostName: "Kitchen helper host",
            capability: "pantry.reconcile",
            targetType: "pantry",
            targetId: "user-1",
            reason: "Put away groceries",
            compensatesChangeSetId: null,
            createdAt: "2026-08-22T10:00:00.000Z",
            items: [
              {
                stableItemId: "0198f1f0-6666-7666-8666-666666666666",
                ingredientSlug: "onion",
                beforeValue: null,
                afterValue: { ingredientSlug: "onion", location: "fresh" },
                beforeVersion: null,
                afterVersion: "1",
              },
            ],
          },
        ],
      }),
    );
    await expect(listAgentMutations()).resolves.toMatchObject([
      { id: changeSetId, items: [{ ingredientSlug: "onion" }] },
    ]);

    fetchMock.mockResolvedValueOnce(
      Response.json({
        applied: true,
        changeSetId: "0198f1f0-7777-7777-8777-777777777777",
        replayed: false,
      }),
    );
    await expect(undoAgentMutation(changeSetId)).resolves.toBeUndefined();
    const [, request] = fetchMock.mock.calls.at(-1) ?? [];
    expect(request).toMatchObject({
      method: "POST",
      credentials: "same-origin",
      body: "{}",
    });
    expect(new Headers(request?.headers).get("idempotency-key")).toMatch(
      /^[0-9a-f-]{36}$/,
    );
  });
});
