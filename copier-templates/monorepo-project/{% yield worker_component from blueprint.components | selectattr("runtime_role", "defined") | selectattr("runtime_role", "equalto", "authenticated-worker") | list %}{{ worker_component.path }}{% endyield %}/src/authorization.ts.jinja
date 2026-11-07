import type { AuthenticatedSession } from "./auth";

export type AuthorizationRequest = {
  action: string;
  resourceId: string;
};

export type AuthorizationPolicy = (
  session: AuthenticatedSession,
  request: AuthorizationRequest,
) => boolean | Promise<boolean>;

export async function requireAuthorization(
  policy: AuthorizationPolicy,
  session: AuthenticatedSession,
  request: AuthorizationRequest,
): Promise<void> {
  if (await policy(session, request)) return;
  throw new AuthorizationDeniedError(request);
}

export class AuthorizationDeniedError extends Error {
  readonly request: AuthorizationRequest;

  constructor(request: AuthorizationRequest) {
    super("The authenticated principal cannot perform this action");
    this.name = "AuthorizationDeniedError";
    this.request = request;
  }
}
