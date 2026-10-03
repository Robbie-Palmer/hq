import assert from "node:assert/strict";
import test from "node:test";

import { selectReusableConnection } from "../images/t3-code/recipe-agent-connections.mjs";

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
