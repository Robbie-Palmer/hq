import { describe, expect, it, vi } from "vitest";
import { createAuth } from "../src/auth";
import { AuthorizationDeniedError, requireAuthorization } from "../src/authorization";
import {
  authorizeProjectRequest,
  createRuntimeApp,
} from "../src/runtime";

describe("authenticated Worker runtime", () => {
  it("publishes health in the runtime and generated contract", async () => {
    const app = createRuntimeApp();
    const response = await app.request("/health");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
    expect(app.getOpenAPIDocument({
      openapi: "3.1.0",
      info: { title: "Test", version: "1" },
    }).paths).toHaveProperty("/health");
  });

  it("keeps authorization separate from authentication", async () => {
    const request = { action: "read", resourceId: "resource:test" };
    const session = {
      session: {},
      user: { id: "user:test" },
    } as never;

    const denied = requireAuthorization(() => false, session, request);
    await expect(denied).rejects.toBeInstanceOf(AuthorizationDeniedError);
    await expect(denied).rejects.toMatchObject({ request });
    await expect(
      requireAuthorization(() => true, session, request),
    ).resolves.toBeUndefined();
  });

  it("wires sessions and the project authorization policy into API routes", async () => {
    const closeDatabase = vi.fn(async () => undefined);
    const session = {
      session: {},
      user: { id: "user:test" },
    } as never;
    const auth = {
      api: { getSession: vi.fn(async () => session) },
      handler: vi.fn(async () => new Response("auth")),
    } as never;
    const app = createRuntimeApp({
      authorizationPolicy: () => true,
      closeDatabase,
      connectDatabase: () => ({ client: {} as never, db: {} as never }),
      createAuth: () => auth,
      registerRoutes: (runtime) => {
        runtime.get("/api/resources/:id", async (context) => {
          const id = context.req.param("id");
          await authorizeProjectRequest(context, {
            action: "read",
            resourceId: `resource:${id}`,
          });
          return context.json({ id });
        });
      },
    });

    const response = await app.request("/api/resources/test", {}, {} as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ id: "test" });
    const authResponse = await app.request("/api/auth/session", {}, {} as never);
    await expect(authResponse.text()).resolves.toBe("auth");
    expect(closeDatabase).toHaveBeenCalledTimes(2);
  });

  it("builds Better Auth from provider and session bindings", () => {
    const auth = createAuth({} as never, {
      BETTER_AUTH_SECRET: "test-only-better-auth-secret-00000000",
      BETTER_AUTH_URL: "https://app.example.test",
      GOOGLE_CLIENT_ID: "google-client-test",
      GOOGLE_CLIENT_SECRET: "google-secret-test",
    });

    expect(auth.api).toHaveProperty("getSession");
  });
});
