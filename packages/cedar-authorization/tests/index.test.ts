import * as cedar from "@cedar-policy/cedar-wasm";
import { describe, expect, it } from "vitest";
import { compileCedarPolicySet } from "../src";

const schema: cedar.Schema = {
  Test: {
    entityTypes: {
      User: {},
      Document: {},
    },
    actions: {
      read: {
        appliesTo: {
          principalTypes: ["User"],
          resourceTypes: ["Document"],
        },
      },
    },
  },
};

describe("compileCedarPolicySet", () => {
  it("validates named policies and returns determining policy ids", () => {
    const policySet = compileCedarPolicySet({
      engine: cedar,
      label: "test",
      schema,
      policies: `
        @id("allow-reader")
        permit (
          principal == Test::User::"reader",
          action == Test::Action::"read",
          resource
        );
      `,
    });

    expect(policySet.policyIds).toEqual(["allow-reader"]);
    expect(
      policySet.authorize({
        principal: { type: "Test::User", id: "reader" },
        action: { type: "Test::Action", id: "read" },
        resource: { type: "Test::Document", id: "one" },
        context: {},
        schema,
        validateRequest: true,
        entities: [],
      }),
    ).toMatchObject({
      decision: "allow",
      determiningPolicies: ["allow-reader"],
    });
  });

  it("rejects unnamed policies at load time", () => {
    expect(() =>
      compileCedarPolicySet({
        engine: cedar,
        label: "test",
        schema,
        policies: "permit (principal, action, resource);",
      }),
    ).toThrow(/must have an @id annotation/);
  });

  it("returns a deny for malformed requests", () => {
    const policySet = compileCedarPolicySet({
      engine: cedar,
      label: "test",
      schema,
      policies: `
        @id("allow-reader")
        permit (principal, action, resource);
      `,
    });

    expect(
      policySet.authorize({
        principal: { type: "Test::Document", id: "wrong-type" },
        action: { type: "Test::Action", id: "read" },
        resource: { type: "Test::Document", id: "one" },
        context: {},
        schema,
        validateRequest: true,
        entities: [],
      }),
    ).toMatchObject({
      decision: "deny",
      reason: "cedar-evaluation-error",
    });
  });
});
