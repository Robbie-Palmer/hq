import { APIError } from "better-auth/api";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addOAuthServerContext: vi.fn(),
  getAuthoritativeSessionFromCtx: vi.fn(),
  getOAuthState: vi.fn(),
}));

vi.mock("better-auth/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("better-auth/api")>();
  return {
    ...actual,
    addOAuthServerContext: mocks.addOAuthServerContext,
    getAuthoritativeSessionFromCtx: mocks.getAuthoritativeSessionFromCtx,
    getOAuthState: mocks.getOAuthState,
  };
});

import {
  agentApprovalReauthentication,
  validateAgentApprovalReauthIdentity,
  validateAgentApprovalReauthUser,
} from "../src/agent-reauthentication";

function approvalReauthenticationHook() {
  const hook = agentApprovalReauthentication().hooks?.before?.[0];
  if (!hook) throw new Error("Agent reauthentication hook is missing");
  return hook;
}

describe("agent approval reauthentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("only marks social sign-ins that opt into the agent approval flow", () => {
    const matches = approvalReauthenticationHook().matcher;
    const context = (body: unknown, path = "/sign-in/social") =>
      ({ body, context: {}, path }) as Parameters<typeof matches>[0];

    expect(
      matches(
        context({ additionalData: { flow: "agent-approval" } }),
      ),
    ).toBe(true);
    expect(matches(context({ additionalData: { flow: "other" } }))).toBe(
      false,
    );
    expect(matches(context(null))).toBe(false);
    expect(matches(context({ additionalData: null }))).toBe(false);
    expect(
      matches(
        context(
          { additionalData: { flow: "agent-approval" } },
          "/sign-in/email",
        ),
      ),
    ).toBe(false);
  });

  it("binds the OAuth state to the current server-side user", async () => {
    mocks.getAuthoritativeSessionFromCtx.mockResolvedValue({
      session: { id: "session-1" },
      user: { id: "user-1" },
    });

    await approvalReauthenticationHook().handler({} as never);

    expect(mocks.addOAuthServerContext).toHaveBeenCalledWith({
      agentApprovalReauthUserId: "user-1",
    });
  });

  it("requires a current session before starting step-up authentication", async () => {
    mocks.getAuthoritativeSessionFromCtx.mockResolvedValue(null);

    await expect(
      approvalReauthenticationHook().handler({} as never),
    ).rejects.toBeInstanceOf(APIError);
    expect(mocks.addOAuthServerContext).not.toHaveBeenCalled();
  });

  it("rejects a different user after the OAuth callback", async () => {
    expect(validateAgentApprovalReauthUser(undefined, "user-2")).toBeUndefined();
    expect(
      validateAgentApprovalReauthUser("user-1", "user-1"),
    ).toBeUndefined();
    expect(validateAgentApprovalReauthUser("user-1", "user-2")).toEqual({
      error: "agent_reauth_identity_mismatch",
      errorDescription:
        "Use the same account that started the agent approval request.",
    });

    mocks.getOAuthState.mockResolvedValue({
      serverContext: { agentApprovalReauthUserId: "user-1" },
    });
    await expect(validateAgentApprovalReauthIdentity("user-2")).resolves.toEqual(
      expect.objectContaining({ error: "agent_reauth_identity_mismatch" }),
    );
  });
});
