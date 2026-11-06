import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedSession } from "../src/auth";
import { projectAuthorization } from "../src/project-authorization";
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

  it("denies a household resource owned by another user", () => {
    expect(projectAuthorization(session("user:one"), {
      action: "read",
      resourceId: "household-canary:user:two",
    })).toBe(false);
  });

  it.each([
    ["delete", "household-canary:user:one"],
    ["read", "account:user:one"],
  ])("denies unsupported project authorization", (action, resourceId) => {
    expect(projectAuthorization(session("user:one"), {
      action,
      resourceId,
    })).toBe(false);
  });
});
