import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  decideAgentApproval,
  listAgentMutations,
  listAgents,
  revokeAgent,
  undoAgentMutation,
} from "@/lib/api/agents";

const fetchMock = vi.fn<typeof fetch>();

describe("agent access API", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("parses the current user's agents", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({
        agents: [
          {
            agent_id: "agent-1",
            name: "Meal planner",
            status: "active",
            mode: "delegated",
            host_id: "host-1",
            host_name: "Kitchen helper host",
            agent_capability_grants: [
              {
                capability: "recipes.read",
                description: "Read recipes",
                status: "active",
                expires_at: "2026-09-21T09:00:00.000Z",
              },
            ],
            created_at: "2026-08-22T09:00:00.000Z",
            last_used_at: "2026-08-22T10:00:00.000Z",
            expires_at: "2026-09-21T09:00:00.000Z",
          },
        ],
      }),
    );

    await expect(listAgents()).resolves.toEqual([
      expect.objectContaining({
        id: "agent-1",
        hostName: "Kitchen helper host",
        capabilityGrants: [
          expect.objectContaining({ capability: "recipes.read" }),
        ],
      }),
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/agent/list?limit=200",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("rejects malformed agent rows", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ agents: [{}] }));

    await expect(listAgents()).rejects.toThrow(
      "The agent list response was invalid.",
    );
  });

  it("rejects unknown capability grant statuses", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({
        agents: [
          {
            agent_id: "agent-1",
            name: "Meal planner",
            status: "active",
            mode: "delegated",
            host_id: "host-1",
            host_name: "Kitchen helper host",
            agent_capability_grants: [
              { capability: "recipes.read", status: "unknown" },
            ],
            created_at: "2026-08-22T09:00:00.000Z",
            last_used_at: null,
            expires_at: "2026-09-21T09:00:00.000Z",
          },
        ],
      }),
    );

    await expect(listAgents()).rejects.toThrow(
      "The agent list response was invalid.",
    );
  });

  it.each(["created_at", "last_used_at", "expires_at"])(
    "rejects invalid %s timestamps",
    async (field) => {
      fetchMock.mockResolvedValueOnce(
        Response.json({
          agents: [
            {
              agent_id: "agent-1",
              name: "Meal planner",
              status: "active",
              mode: "delegated",
              host_id: "host-1",
              host_name: "Kitchen helper host",
              agent_capability_grants: [],
              created_at: "2026-08-22T09:00:00.000Z",
              last_used_at: null,
              expires_at: "2026-09-21T09:00:00.000Z",
              [field]: "not-a-datetime",
            },
          ],
        }),
      );

      await expect(listAgents()).rejects.toThrow(
        "The agent list response was invalid.",
      );
    },
  );

  it("revokes exactly the selected agent", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ agent_id: "agent-1", status: "revoked" }),
    );

    await expect(revokeAgent("agent-1")).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/agent/revoke",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({ agent_id: "agent-1" }),
      }),
    );
  });

  it("parses mutation history and requests an idempotent undo", async () => {
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

  it("rejects a mismatched approval response", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ status: "approved", agentId: "agent-2" }),
    );

    await expect(
      decideAgentApproval({
        agentId: "agent-1",
        code: "ABCD-1234",
        action: "approve",
      }),
    ).rejects.toThrow("The approval decision response was invalid.");
  });
});
