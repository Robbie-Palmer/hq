import { describe, expect, it } from "vitest";
import { AuthorizationDeniedError, requireAuthorization } from "../src/authorization";
import { createRuntimeApp } from "../src/runtime";

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

    await expect(
      requireAuthorization(() => false, session, request),
    ).rejects.toBeInstanceOf(AuthorizationDeniedError);
    await expect(
      requireAuthorization(() => true, session, request),
    ).resolves.toBeUndefined();
  });
});
