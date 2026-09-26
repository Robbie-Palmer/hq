import { describe, expect, it } from "vitest";

import {
  ActorProfileSchema,
  ExecutionSessionIdentitySchema,
  OwnerPolicySchema,
  PortableContractSchema,
  TaskRequirementsSchema,
  WorkerAdapterIdentitySchema,
} from "../src";
import { actor, adapter, policy, session, task } from "./fixtures";

describe("portable contracts", () => {
  it.each([
    ["task", TaskRequirementsSchema, task],
    ["actor", ActorProfileSchema, actor],
    ["policy", OwnerPolicySchema, policy],
    ["adapter", WorkerAdapterIdentitySchema, adapter],
    ["session", ExecutionSessionIdentitySchema, session],
  ])("round trips the %s contract without changing it", (_name, schema, value) => {
    const wireValue = JSON.parse(JSON.stringify(value));
    expect(schema.parse(wireValue)).toEqual(value);
    expect(PortableContractSchema.parse(wireValue)).toEqual(value);
  });

  it("rejects an unsupported schema version", () => {
    expect(
      PortableContractSchema.safeParse({ ...task, schemaVersion: 2 }).success,
    ).toBe(false);
  });

  it("rejects incomplete and extended records", () => {
    const { requiredAccess: _requiredAccess, ...incomplete } = task;
    expect(TaskRequirementsSchema.safeParse(incomplete).success).toBe(false);
    expect(
      ActorProfileSchema.safeParse({ ...actor, modelName: "temporary-name" })
        .success,
    ).toBe(false);
  });

  it("rejects ambiguous duplicate capabilities and policy scopes", () => {
    expect(
      ActorProfileSchema.safeParse({
        ...actor,
        declaredCapabilities: [
          ...actor.declaredCapabilities,
          actor.declaredCapabilities[0],
        ],
      }).success,
    ).toBe(false);
    expect(
      OwnerPolicySchema.safeParse({
        ...policy,
        budgets: [...policy.budgets, policy.budgets[0]],
      }).success,
    ).toBe(false);
  });

  it("keeps session identity stable across an explicit handoff", () => {
    const nextSession = {
      ...session,
      sessionId: "session:01k5replacement",
      predecessorSessionId: session.sessionId,
    };
    expect(ExecutionSessionIdentitySchema.parse(nextSession)).toEqual(
      nextSession,
    );
    expect(
      ExecutionSessionIdentitySchema.safeParse({
        ...session,
        predecessorSessionId: session.sessionId,
      }).success,
    ).toBe(false);
  });
});
