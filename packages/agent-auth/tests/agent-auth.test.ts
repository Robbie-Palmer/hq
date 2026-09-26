import type { AgentAuthEvent, Capability } from "@better-auth/agent-auth";
import { describe, expect, it } from "vitest";
import {
  createAgentAuthAuditHandler,
  createAgentAuthConfiguration,
  createAgentAuthPlugin,
  toAgentAuthAuditRecord,
} from "../src";

describe("Agent Auth protocol configuration", () => {
  it("builds canonical discovery endpoints from application metadata", () => {
    expect(
      createAgentAuthConfiguration({
        baseUrl: "https://recipes.example.test/path",
        providerName: "Recipes",
        description: "Recipe access",
      }),
    ).toMatchObject({
      version: "1.0-draft",
      provider_name: "Recipes",
      issuer: "https://recipes.example.test/api/auth",
      default_location:
        "https://recipes.example.test/api/auth/capability/execute",
      algorithms: ["Ed25519"],
      modes: ["delegated"],
      approval_methods: ["device_authorization"],
      endpoints: {
        register: "https://recipes.example.test/api/auth/agent/register",
        introspect: "https://recipes.example.test/api/auth/agent/introspect",
      },
    });
  });

  it("applies safe plugin defaults and validates declared capabilities", async () => {
    const capability = {
      name: "recipes.read",
      description: "Read recipes",
      approvalStrength: "session",
      grantTTL: 60,
      input: { type: "object" },
      output: { type: "object" },
    } as Capability;
    const plugin = createAgentAuthPlugin({
      providerName: "Recipes",
      capabilities: [capability],
    });

    expect(plugin.options).toMatchObject({
      modes: ["delegated"],
      approvalMethods: ["device_authorization"],
      allowDynamicHostRegistration: false,
      defaultHostCapabilities: [],
      jwtMaxAge: 60,
      jtiCacheStorage: "secondary-storage",
      jwksCacheStorage: "secondary-storage",
    });
    expect(
      await plugin.options?.validateCapabilities?.(["recipes.read"]),
    ).toBe(true);
    expect(
      await plugin.options?.validateCapabilities?.(["recipes.delete"]),
    ).toBe(false);
  });
});

describe("Agent Auth audit mapping", () => {
  it("maps execution results without copying capability arguments", () => {
    const event: AgentAuthEvent = {
      type: "capability.executed",
      actorType: "agent",
      actorId: "agent-1",
      agentId: "agent-1",
      hostId: "host-1",
      userId: "user-1",
      capability: "recipes.read",
      arguments: { secret: "do-not-copy" },
      status: "success",
      durationMs: 12,
    };

    const record = toAgentAuthAuditRecord(event);
    expect(record).toMatchObject({
      eventType: "capability.executed",
      userId: "user-1",
      capability: "recipes.read",
      outcome: "success",
      durationMs: 12,
    });
    expect(record).not.toHaveProperty("arguments");
  });

  it("can leave execution auditing to a guarded execution handler", async () => {
    const records: unknown[] = [];
    const handleAuditEvent = createAgentAuthAuditHandler({
      includeCapabilityExecutions: false,
      write: (record) => {
        records.push(record);
      },
    });

    await handleAuditEvent({
      type: "capability.executed",
      actorType: "agent",
      actorId: "agent-1",
      agentId: "agent-1",
      userId: "user-1",
      capability: "recipes.read",
      status: "success",
      durationMs: 12,
    });
    await handleAuditEvent({
      type: "capability.approved",
      actorType: "user",
      actorId: "user-1",
      agentId: "agent-1",
    });

    expect(records).toEqual([
      expect.objectContaining({
        eventType: "capability.approved",
        userId: "user-1",
        agentId: "agent-1",
      }),
    ]);
  });

  it("does not fail protocol operations when audit persistence fails", async () => {
    const failure = new Error("audit unavailable");
    const errors: unknown[] = [];
    const handleAuditEvent = createAgentAuthAuditHandler({
      write: () => {
        throw failure;
      },
      onError: (error) => {
        errors.push(error);
      },
    });

    await expect(
      handleAuditEvent({
        type: "capability.approved",
        actorType: "user",
        actorId: "user-1",
        agentId: "agent-1",
      }),
    ).resolves.toBeUndefined();
    expect(errors).toEqual([failure]);
  });

  it("propagates an audit persistence failure without an error handler", async () => {
    const failure = new Error("audit unavailable");
    const handleAuditEvent = createAgentAuthAuditHandler({
      write: () => {
        throw failure;
      },
    });

    await expect(
      handleAuditEvent({
        type: "capability.approved",
        actorType: "user",
        actorId: "user-1",
        agentId: "agent-1",
      }),
    ).rejects.toBe(failure);
  });
});
