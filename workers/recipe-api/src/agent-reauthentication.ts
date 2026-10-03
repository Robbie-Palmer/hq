import type { BetterAuthPlugin, ValidateUserInfoResult } from "better-auth";
import {
  APIError,
  addOAuthServerContext,
  createAuthMiddleware,
  getAuthoritativeSessionFromCtx,
  getOAuthState,
} from "better-auth/api";

export const AGENT_APPROVAL_REAUTH_FLOW = "agent-approval";

const EXPECTED_USER_ID_KEY = "agentApprovalReauthUserId";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAgentApprovalReauthRequest(body: unknown): boolean {
  if (!isRecord(body) || !isRecord(body.additionalData)) return false;
  return body.additionalData.flow === AGENT_APPROVAL_REAUTH_FLOW;
}

export function validateAgentApprovalReauthUser(
  expectedUserId: unknown,
  actualUserId: unknown,
): ValidateUserInfoResult | undefined {
  if (typeof expectedUserId !== "string") return undefined;
  if (actualUserId === expectedUserId) return undefined;
  return {
    error: "agent_reauth_identity_mismatch",
    errorDescription:
      "Use the same account that started the agent approval request.",
  };
}

export async function validateAgentApprovalReauthIdentity(
  actualUserId: unknown,
): Promise<ValidateUserInfoResult | undefined> {
  const state = await getOAuthState();
  return validateAgentApprovalReauthUser(
    state?.serverContext?.[EXPECTED_USER_ID_KEY],
    actualUserId,
  );
}

export function agentApprovalReauthentication(): BetterAuthPlugin {
  return {
    id: "agent-approval-reauthentication",
    hooks: {
      before: [
        {
          matcher: (context) =>
            context.path === "/sign-in/social" &&
            isAgentApprovalReauthRequest(context.body),
          handler: createAuthMiddleware(async (context) => {
            const session = await getAuthoritativeSessionFromCtx(context);
            if (!session) {
              throw new APIError("UNAUTHORIZED", {
                code: "agent_reauth_session_required",
                message: "Log in before confirming an agent approval.",
              });
            }
            await addOAuthServerContext({
              [EXPECTED_USER_ID_KEY]: session.user.id,
            });
          }),
        },
      ],
    },
  };
}
