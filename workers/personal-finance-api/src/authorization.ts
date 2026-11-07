import type { AuthenticatedSession } from "./auth";

export type AuthorizationRequest = {
  action: string;
  resource: {
    type: string;
    id: string;
    ownerUserId: string;
    syntheticOnly: boolean;
  };
};

export type AuthorizationDecision =
  | { allowed: true; determiningPolicies: string[] }
  | {
      allowed: false;
      reason: "evaluation-error" | "policy-deny";
      diagnostics: string[];
    };

export type AuthorizationPolicy = (
  session: AuthenticatedSession,
  request: AuthorizationRequest,
) => AuthorizationDecision | Promise<AuthorizationDecision>;

export async function requireAuthorization(
  policy: AuthorizationPolicy,
  session: AuthenticatedSession,
  request: AuthorizationRequest,
): Promise<void> {
  const decision = await policy(session, request);
  if (decision.allowed) return;
  throw new AuthorizationDeniedError(request, decision);
}

export class AuthorizationDeniedError extends Error {
  readonly request: AuthorizationRequest;
  readonly decision: Extract<AuthorizationDecision, { allowed: false }>;

  constructor(
    request: AuthorizationRequest,
    decision: Extract<AuthorizationDecision, { allowed: false }>,
  ) {
    super("The authenticated principal cannot perform this action");
    this.name = "AuthorizationDeniedError";
    this.request = request;
    this.decision = decision;
  }
}
