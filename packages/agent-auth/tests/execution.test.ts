import type { AgentSession } from "@better-auth/agent-auth";
import { describe, expect, it } from "vitest";
import {
  createAgentExecutionHandler,
  enforceAgentExecutionRateLimits,
  type AgentExecutionAuditEvent,
  type AgentExecutionContext,
  type AgentExecutionRateLimits,
} from "../src/execution";

const limits = {
  capability: { max: 2, windowSeconds: 60 },
  agent: { max: 4, windowSeconds: 60 },
  user: { max: 10, windowSeconds: 60 },
  host: { max: 20, windowSeconds: 60 },
  ip: { max: 30, windowSeconds: 60 },
} satisfies AgentExecutionRateLimits;

function session(agentId = "agent-1"): AgentSession {
  return {
    type: "delegated",
    agentId,
    userId: "user-1",
    agent: {
      id: agentId,
      name: "Test agent",
      mode: "delegated",
      capabilityGrants: [],
      hostId: "host-1",
      createdAt: new Date("2026-09-01T00:00:00Z"),
      activatedAt: new Date("2026-09-01T00:01:00Z"),
      metadata: null,
    },
    host: { id: "host-1", userId: "user-1", status: "active" },
    user: { id: "user-1", name: "User", email: "user@example.test" },
  };
}

function context(input: {
  agentId?: string;
  requestId?: string;
  sourceIp?: string;
} = {}): AgentExecutionContext {
  const headers = new Headers();
  if (input.requestId) headers.set("x-request-id", input.requestId);
  if (input.sourceIp) headers.set("cf-connecting-ip", input.sourceIp);
  const responseHeaders = new Headers();
  return {
    ctx: {
      headers,
      responseHeaders,
      setHeader: (key: string, value: string) =>
        responseHeaders.set(key, value),
    },
    capability: "recipes.read",
    capabilityDef: { name: "recipes.read" },
    arguments: { slug: "soup", secret: "do-not-audit" },
    agentSession: session(input.agentId),
    grant: { id: "grant-1" },
    revokeGrant: async () => {},
  } as unknown as AgentExecutionContext;
}

function counter() {
  const counts = new Map<string, number>();
  const keys: string[] = [];
  return {
    counts,
    keys,
    consume: async (key: string, rule: { max: number }) => {
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      keys.push(key);
      return {
        allowed: count <= rule.max,
        retryAfter: count <= rule.max ? 0 : 60,
      };
    },
  };
}

describe("compound Agent Auth execution limits", () => {
  it("checks every dimension without storing raw subjects", async () => {
    const state = counter();
    const result = await enforceAgentExecutionRateLimits({
      limits,
      consumeRateLimit: state.consume,
      capability: "recipes.read",
      agentSession: session(),
      headers: new Headers({ "cf-connecting-ip": "203.0.113.9" }),
    });

    expect(result).toBeNull();
    expect(
      new Set(
        state.keys.map((key) => key.split(":").slice(0, 2).join(":")),
      ),
    ).toEqual(
      new Set([
        "agent-execution:capability",
        "agent-execution:agent",
        "agent-execution:user",
        "agent-execution:host",
        "agent-execution:ip",
      ]),
    );
    expect(state.keys.join(" ")).not.toContain("203.0.113.9");
    expect(state.keys.join(" ")).not.toContain("user-1");
  });

  it("charges every dimension for a denied attempt without blocking another agent", async () => {
    const state = counter();
    const input = {
      limits,
      consumeRateLimit: state.consume,
      capability: "recipes.read",
      headers: new Headers({ "cf-connecting-ip": "203.0.113.9" }),
    };
    await enforceAgentExecutionRateLimits({ ...input, agentSession: session() });
    await enforceAgentExecutionRateLimits({ ...input, agentSession: session() });
    const keyCount = state.keys.length;

    await expect(
      enforceAgentExecutionRateLimits({
        ...input,
        agentSession: session(),
      }),
    ).resolves.toEqual({ dimension: "capability", retryAfter: 60 });
    expect(state.keys).toHaveLength(keyCount + 5);
    await expect(
      enforceAgentExecutionRateLimits({
        ...input,
        agentSession: session("agent-2"),
      }),
    ).resolves.toBeNull();
  });
});

describe("guarded Agent Auth execution", () => {
  it("correlates successful results without auditing arguments", async () => {
    const audit: AgentExecutionAuditEvent[] = [];
    const handler = createAgentExecutionHandler({
      limits,
      consumeRateLimit: async () => ({ allowed: true, retryAfter: 0 }),
      audit: (event) => {
        audit.push(event);
      },
      execute: async () => ({ recipe: "soup" }),
    });
    const execution = context({
      requestId: "request-123",
      sourceIp: "203.0.113.9",
    });

    await expect(handler(execution)).resolves.toEqual({ recipe: "soup" });
    expect(execution.ctx.responseHeaders?.get("x-request-id")).toBe(
      "request-123",
    );
    expect(audit).toEqual([
      expect.objectContaining({
        correlationId: "request-123",
        outcome: "success",
      }),
    ]);
    expect(audit[0]).not.toHaveProperty("arguments");
  });

  it("returns a correlated protocol error and audits the exceeded dimension", async () => {
    const audit: AgentExecutionAuditEvent[] = [];
    const handler = createAgentExecutionHandler({
      limits,
      consumeRateLimit: async (key) => ({
        allowed: !key.startsWith("agent-execution:capability:"),
        retryAfter: 42,
      }),
      audit: (event) => {
        audit.push(event);
      },
      execute: async () => ({ recipe: "unreachable" }),
    });

    await expect(
      handler(context({ requestId: "limited-123" })),
    ).rejects.toMatchObject({
      status: "TOO_MANY_REQUESTS",
      body: {
        error: "rate_limited",
        correlation_id: "limited-123",
        limit: "capability",
        retry_after: 42,
      },
    });
    expect(audit).toEqual([
      expect.objectContaining({
        correlationId: "limited-123",
        outcome: "rate_limited:capability",
      }),
    ]);
  });

  it("propagates an unhandled audit persistence failure", async () => {
    const auditError = new Error("audit unavailable");
    let executions = 0;
    let auditAttempts = 0;
    const handler = createAgentExecutionHandler({
      limits,
      consumeRateLimit: async () => ({ allowed: true, retryAfter: 0 }),
      audit: () => {
        auditAttempts += 1;
        throw auditError;
      },
      execute: async () => {
        executions += 1;
        return { recipe: "soup" };
      },
    });

    await expect(handler(context())).rejects.toBe(auditError);
    expect(executions).toBe(1);
    expect(auditAttempts).toBe(1);
  });
});
