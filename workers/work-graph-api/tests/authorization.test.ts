import {
  workGraphActionForRequest,
  workGraphAuthorizer,
} from "../src/authorization";
import {
  createWorkGraphApp,
  type WorkGraphApiRepository,
} from "../src/app";

describe("Work Graph Cedar authorization", () => {
  it("allows the full authority profile to read, write, and invoke MCP", () => {
    for (const [action, method, path] of [
      ["api.read", "GET", "/api/work-items"],
      ["api.write", "POST", "/api/work-items"],
      ["mcp.invoke", "POST", "/mcp"],
    ] as const) {
      expect(
        workGraphAuthorizer.authorize({
          action,
          authorityProfileId: "authority:work-graph-full",
          method,
          path,
          principalId: "client:operator",
        }),
      ).toMatchObject({ decision: "allow" });
    }
  });

  it("allows read-only clients to read and explicitly denies mutations", () => {
    expect(
      workGraphAuthorizer.authorize({
        action: "api.read",
        authorityProfileId: "authority:work-graph-read-only",
        method: "GET",
        path: "/api/work-items",
        principalId: "client:observer",
      }),
    ).toMatchObject({ decision: "allow" });

    for (const [action, path] of [
      ["api.write", "/api/work-items"],
      ["mcp.invoke", "/mcp"],
    ] as const) {
      expect(
        workGraphAuthorizer.authorize({
          action,
          authorityProfileId: "authority:work-graph-read-only",
          method: "POST",
          path,
          principalId: "client:observer",
        }),
      ).toMatchObject({
        decision: "deny",
        reason: "cedar-policy-deny",
      });
    }
  });

  it("fails closed when the authorization request is malformed", () => {
    expect(
      workGraphAuthorizer.authorize({
        action: "api.read",
        authorityProfileId: "authority:work-graph-full",
        method: "",
        path: "/api/work-items",
        principalId: "client:operator",
      }),
    ).toMatchObject({
      decision: "deny",
      reason: "cedar-evaluation-error",
    });
  });

  it("maps HTTP and MCP requests to concrete actions", () => {
    expect(workGraphActionForRequest("GET", "/api/work-items")).toBe(
      "api.read",
    );
    expect(workGraphActionForRequest("HEAD", "/api/work-items")).toBe(
      "api.read",
    );
    expect(workGraphActionForRequest("QUERY", "/api/work-items/search")).toBe(
      "api.read",
    );
    expect(workGraphActionForRequest("POST", "/api/work-items")).toBe(
      "api.write",
    );
    expect(workGraphActionForRequest("POST", "/mcp")).toBe("mcp.invoke");
  });

  it("enforces the resolved client profile before a route handler runs", async () => {
    const app = createWorkGraphApp({} as WorkGraphApiRepository, {
      authorization: {
        resolveIdentity: () => ({
          authorityProfileId: "authority:work-graph-read-only",
          principalId: "client:observer",
        }),
      },
    });

    const response = await app.request("/api/work-items", { method: "POST" });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "authorization_denied",
        message: "The authenticated client cannot perform this action.",
      },
    });
  });
});
