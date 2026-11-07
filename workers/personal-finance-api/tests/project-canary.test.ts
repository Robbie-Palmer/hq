import type * as cedar from "@cedar-policy/cedar-wasm";
import { describe, expect, it, vi } from "vitest";

import type { AuthenticatedSession } from "../src/auth";
import {
  createProjectAuthorization,
  householdAuthorizationRequest,
  projectAuthorization,
} from "../src/project-authorization";
import { PROJECT_AUTHORIZATION_POLICY } from "../src/project-authorization-policy";
import policyText from "../src/project-authorization.cedar";
import schemaDocument from "../src/project-authorization.cedarschema.json";
import { createRuntimeApp } from "../src/runtime";

function session(userId: string): AuthenticatedSession {
  return { session: {}, user: { id: userId } } as AuthenticatedSession;
}

function runtimeWith(options: {
  db: object;
  session: AuthenticatedSession | null;
}) {
  const auth = {
    api: { getSession: vi.fn(async () => options.session) },
    handler: vi.fn(async () => new Response("auth")),
  } as never;
  return createRuntimeApp({
    closeDatabase: vi.fn(async () => undefined),
    connectDatabase: () => ({ client: {} as never, db: options.db as never }),
    createAuth: () => auth,
  });
}

describe("synthetic household canary", () => {
  it("keeps the runtime policy synchronized with the reviewed Cedar file", () => {
    expect(PROJECT_AUTHORIZATION_POLICY.trim()).toBe(policyText.trim());
  });

  it("rejects an invalid or unnamed Cedar policy at startup", () => {
    expect(() => createProjectAuthorization(
      "this is not cedar",
      schemaDocument as cedar.Schema,
    )).toThrow("Cedar policy parse failure");
    expect(() => createProjectAuthorization(
      `permit (
        principal is PersonalFinance::User,
        action == PersonalFinance::Action::"household.read",
        resource is PersonalFinance::Household
      );`,
      schemaDocument as cedar.Schema,
    )).toThrow("must have an @id annotation");
  });

  it("rejects duplicate policy IDs and schema-invalid actions", () => {
    expect(() => createProjectAuthorization(
      `${policyText}\n${policyText}`,
      schemaDocument as cedar.Schema,
    )).toThrow("Duplicate Personal Finance Cedar policy id");
    expect(() => createProjectAuthorization(
      `@id("unknown-action")
      permit (
        principal is PersonalFinance::User,
        action == PersonalFinance::Action::"household.archive",
        resource is PersonalFinance::Household
      );`,
      schemaDocument as cedar.Schema,
    )).toThrow("Cedar validation diagnostics");
  });

  it("fails closed when Cedar cannot evaluate an entity", () => {
    const incompatibleSchema = structuredClone(schemaDocument);
    incompatibleSchema.PersonalFinance.entityTypes.Household.shape.attributes.ownerUserId = {
      type: "Long",
    } as never;
    const authorize = createProjectAuthorization(
      "",
      incompatibleSchema as cedar.Schema,
    );

    expect(authorize(
      session("user:one"),
      householdAuthorizationRequest("household.read", "user:one"),
    )).toMatchObject({ allowed: false, reason: "evaluation-error" });
  });

  it("fails closed when request entity construction throws", () => {
    const brokenSession = {
      get user() {
        throw "unavailable user";
      },
    } as never;

    expect(projectAuthorization(
      brokenSession,
      householdAuthorizationRequest("household.read", "user:one"),
    )).toEqual({
      allowed: false,
      reason: "evaluation-error",
      diagnostics: ["unavailable user"],
    });
  });

  it("allows an authenticated user to create only their synthetic record", async () => {
    const returning = vi.fn(async () => [{
      classification: "synthetic-only",
      id: "synthetic-household-user:test",
      label: "synthetic household",
      ownerUserId: "user:test",
    }]);
    const onConflictDoUpdate = vi.fn(() => ({ returning }));
    const values = vi.fn(() => ({ onConflictDoUpdate }));
    const insert = vi.fn(() => ({ values }));
    const app = runtimeWith({ db: { insert }, session: session("user:test") });

    const response = await app.request("/api/canary/household", {
      body: JSON.stringify({ label: "synthetic household" }),
      headers: { "content-type": "application/json" },
      method: "PUT",
    }, {} as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      classification: "synthetic-only",
      id: "synthetic-household-user:test",
      label: "synthetic household",
    });
    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      ownerUserId: "user:test",
    }));
  });

  it("uses a preview-only bearer identity for the isolated smoke check", async () => {
    const limit = vi.fn(async () => [{
      classification: "synthetic-only",
      id: "synthetic-household-preview-canary",
      label: "synthetic household",
      ownerUserId: "preview-canary",
    }]);
    const where = vi.fn(() => ({ limit }));
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    const app = runtimeWith({ db: { select }, session: null });

    const response = await app.request("/api/canary/household", {
      headers: { authorization: "Bearer preview-secret" },
    }, {
      CANARY_PREVIEW_AUTH_TOKEN: "preview-secret",
      DEPLOYMENT_ENV: "preview",
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      classification: "synthetic-only",
      id: "synthetic-household-preview-canary",
    });
  });

  it("rejects the preview substitute outside preview", async () => {
    const select = vi.fn();
    const app = runtimeWith({ db: { select }, session: null });

    const response = await app.request("/api/canary/household", {
      headers: { authorization: "Bearer preview-secret" },
    }, {
      CANARY_PREVIEW_AUTH_TOKEN: "preview-secret",
      DEPLOYMENT_ENV: "production",
    } as never);

    expect(response.status).toBe(401);
    expect(select).not.toHaveBeenCalled();
  });

  it.each([
    [undefined, undefined],
    ["preview-secret", "wrong-secret"],
  ])("rejects a missing or invalid preview credential", async (expected, actual) => {
    const select = vi.fn();
    const app = runtimeWith({ db: { select }, session: null });
    const headers = actual ? { authorization: `Bearer ${actual}` } : undefined;

    const response = await app.request(
      "/api/canary/household",
      { headers },
      {
        CANARY_PREVIEW_AUTH_TOKEN: expected,
        DEPLOYMENT_ENV: "preview",
      } as never,
    );

    expect(response.status).toBe(401);
    expect(select).not.toHaveBeenCalled();
  });

  it("returns not found before the synthetic record is written", async () => {
    const limit = vi.fn(async () => []);
    const where = vi.fn(() => ({ limit }));
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    const app = runtimeWith({ db: { select }, session: session("user:test") });

    const response = await app.request("/api/canary/household");

    expect(response.status).toBe(404);
  });

  it("fails closed when the database does not return the canary write", async () => {
    const returning = vi.fn(async () => []);
    const onConflictDoUpdate = vi.fn(() => ({ returning }));
    const values = vi.fn(() => ({ onConflictDoUpdate }));
    const insert = vi.fn(() => ({ values }));
    const app = runtimeWith({ db: { insert }, session: session("user:test") });

    const response = await app.request("/api/canary/household", {
      body: JSON.stringify({ label: "synthetic household" }),
      headers: { "content-type": "application/json" },
      method: "PUT",
    });

    expect(response.status).toBe(500);
  });

  it.each([
    ["household.create" as const, "create-owned-synthetic-household"],
    ["household.read" as const, "read-owned-synthetic-household"],
  ])("permits an owner to %s", (action, policyId) => {
    expect(projectAuthorization(
      session("user:one"),
      householdAuthorizationRequest(action, "user:one"),
    )).toEqual({ allowed: true, determiningPolicies: [policyId] });
  });

  it("denies a household resource owned by another user", () => {
    expect(projectAuthorization(
      session("user:one"),
      householdAuthorizationRequest("household.read", "user:two"),
    )).toMatchObject({ allowed: false, reason: "policy-deny" });
  });

  it("explicitly denies deletion of the synthetic household", () => {
    const request = householdAuthorizationRequest("household.read", "user:one");
    expect(projectAuthorization(session("user:one"), {
      ...request,
      action: "household.delete",
    })).toMatchObject({
      allowed: false,
      reason: "policy-deny",
      diagnostics: ["never-delete-synthetic-household"],
    });
  });

  it.each([
    ["household.archive", "household"],
    ["household.read", "account"],
  ])("fails closed for malformed project authorization", (action, type) => {
    expect(projectAuthorization(session("user:one"), {
      action,
      resource: {
        type,
        id: "household-canary:user:one",
        ownerUserId: "user:one",
        syntheticOnly: true,
      },
    })).toMatchObject({ allowed: false, reason: "evaluation-error" });
  });
});
