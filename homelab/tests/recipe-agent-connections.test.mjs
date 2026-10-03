import assert from "node:assert/strict";
import test from "node:test";

import {
  reuseConnection,
  selectReusableConnection,
} from "../images/t3-code/recipe-agent-connections.mjs";

const now = Date.parse("2026-10-03T12:00:00Z");

function connection(overrides = {}) {
  return {
    agentId: "older",
    issuer: "https://recipes.example",
    mode: "delegated",
    createdAt: 1,
    capabilityGrants: [
      { capability: "pantry.read", status: "active" },
      {
        capability: "pantry.reconcile",
        status: "active",
        expires_at: "2026-11-03T12:00:00Z",
      },
    ],
    ...overrides,
  };
}

test("selects the newest connection with the requested active grants", () => {
  const selected = selectReusableConnection(
    [connection(), connection({ agentId: "newer", createdAt: 2 })],
    {
      issuer: "https://recipes.example",
      mode: "delegated",
      capabilities: ["pantry.read", { name: "pantry.reconcile" }],
    },
    now,
  );

  assert.equal(selected?.agentId, "newer");
});

test("does not reuse the wrong provider, mode, or an expired grant", () => {
  const candidates = [
    connection({ issuer: "https://other.example" }),
    connection({ mode: "autonomous" }),
    connection({
      capabilityGrants: [
        {
          capability: "pantry.reconcile",
          status: "active",
          expires_at: "2026-10-02T12:00:00Z",
        },
      ],
    }),
  ];

  assert.equal(
    selectReusableConnection(
      candidates,
      {
        issuer: "https://recipes.example",
        mode: "delegated",
        capabilities: ["pantry.reconcile"],
      },
      now,
    ),
    undefined,
  );
});

test("allows an omitted mode and capability list to reuse the latest provider connection", () => {
  const selected = selectReusableConnection(
    [
      connection(),
      connection({ agentId: "pending", createdAt: 4, capabilityGrants: [] }),
      connection({ agentId: "autonomous", mode: "autonomous", createdAt: 3 }),
    ],
    { issuer: "https://recipes.example" },
    now,
  );

  assert.equal(selected?.agentId, "autonomous");
});

test("returns the reusable connection in the connect-agent response shape", async () => {
  const storage = {
    async listAgentConnections() {
      return [connection({ agentId: "reused", hostId: "host" })];
    },
  };
  const client = {
    async getProviderConfig() {
      return { issuer: "https://recipes.example" };
    },
  };

  const result = await reuseConnection(storage, client, {
    provider: "Recipes",
    mode: "delegated",
    capabilities: ["pantry.read"],
  });

  assert.equal(result?.agentId, "reused");
  assert.equal(result?.hostId, "host");
  assert.equal(result?.status, "active");
  assert.equal(result?.reused, true);
});

test("bypasses reuse for forced approval and constrained capabilities", async () => {
  const client = {
    async getProviderConfig() {
      throw new Error("provider lookup should not run");
    },
  };
  const storage = {
    async listAgentConnections() {
      throw new Error("storage lookup should not run");
    },
  };

  assert.equal(
    await reuseConnection(storage, client, {
      force_approval: true,
      provider: "Recipes",
    }),
    null,
  );
  assert.equal(
    await reuseConnection(storage, client, {
      provider: "Recipes",
      capabilities: [
        { name: "pantry.read", constraints: { location: "cupboard" } },
      ],
    }),
    null,
  );
});
