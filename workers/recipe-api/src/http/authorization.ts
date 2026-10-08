import { APIError } from "better-auth";
import type { Context, MiddlewareHandler } from "hono";
import type { Db } from "recipe-db";
import type { RecipeVisibility } from "recipe-domain/visibility";
import { createAuth, type Auth } from "../auth";

type AuthorizationEnv = Parameters<typeof createAuth>[1];

export type AuthenticatedSession = NonNullable<
  Awaited<ReturnType<Auth["api"]["getSession"]>>
>;
export type AuthenticatedUser = AuthenticatedSession["user"];

export type AuthorizationVariables = {
  authSession: AuthenticatedSession;
  authUser: AuthenticatedUser;
};

/** Narrowed variant used after `requireAuthenticatedUser` succeeds. */
export type AuthenticatedVariables = {
  authSession: AuthenticatedSession;
  authUser: AuthenticatedUser;
};

export type AuthorizationDecision =
  | { allowed: true }
  | { allowed: false; status: 401 | 403; error: string };
export type AuthorizationFailure = Extract<
  AuthorizationDecision,
  { allowed: false }
>;

export type OwnedResource = {
  userId: string;
};

export type RecipeResource = OwnedResource & {
  visibility: RecipeVisibility;
};

export type HouseholdResource = {
  ownerId: string;
};

export type HouseholdReadContext = {
  userSharesHouseholdWithOwner: boolean;
};

export type AuthSessionLoader = (
  c: Context,
) => Promise<AuthenticatedSession | null>;

const noHouseholdReadAccess: HouseholdReadContext = Object.freeze({
  userSharesHouseholdWithOwner: false,
});

export function hasSessionSignal(c: Context): boolean {
  if (c.req.header("authorization")) return true;

  const cookie = c.req.header("cookie");
  if (!cookie) return false;
  return /(?:^|;\s*)(?:__Secure-)?better-auth[.-]session_token=/.test(cookie);
}

export function allow(): AuthorizationDecision {
  return { allowed: true };
}

export function unauthenticated(): AuthorizationFailure {
  return {
    allowed: false,
    status: 401,
    error: "Authentication required",
  };
}

export function forbidden(): AuthorizationFailure {
  return {
    allowed: false,
    status: 403,
    error: "Authorization required",
  };
}

export function authorizationResponse(
  c: Context,
  decision: AuthorizationFailure,
): Response {
  return c.json({ error: decision.error }, decision.status);
}

/**
 * Better Auth answers `getSession` with a 401 `APIError` when a session token
 * is present but no longer usable — for example when concurrent requests race
 * to refresh one session and a request finds it already rotated or removed.
 * That is an unauthenticated result, not a server fault.
 */
function isUnusableSessionError(error: unknown): boolean {
  return error instanceof APIError && error.statusCode === 401;
}

export async function loadBetterAuthSession(
  c: Context<{
    Bindings: AuthorizationEnv;
    Variables: Partial<AuthorizationVariables>;
  }>,
  db: Db,
): Promise<AuthenticatedSession | null> {
  if (!hasSessionSignal(c)) return null;
  const auth = createAuth(db, c.env);
  try {
    return await auth.api.getSession({
      headers: c.req.raw.headers,
      query: { disableCookieCache: true },
    });
  } catch (error) {
    // Report an unusable session as "no session" so it resolves to a 401
    // instead of surfacing as a traced error and a 503. A genuine internal
    // failure keeps its status and stays visible in tracing and logs.
    if (isUnusableSessionError(error)) return null;
    throw error;
  }
}

export function requireAuthenticatedUser(
  loadSession: AuthSessionLoader,
): MiddlewareHandler<{ Variables: AuthenticatedVariables }> {
  return async (c, next) => {
    const session = await loadSession(c);
    if (!session) return authorizationResponse(c, unauthenticated());

    c.set("authSession", session);
    c.set("authUser", session.user);
    await next();
  };
}

export function requireAuthorization(
  loadSession: AuthSessionLoader,
  authorize: (
    session: AuthenticatedSession | null,
    c: Context<{ Variables: Partial<AuthorizationVariables> }>,
  ) => AuthorizationDecision | Promise<AuthorizationDecision>,
): MiddlewareHandler<{ Variables: Partial<AuthorizationVariables> }> {
  return async (c, next) => {
    const session = await loadSession(c);
    if (session) {
      c.set("authSession", session);
      c.set("authUser", session.user);
    }

    const decision = await authorize(session, c);
    if (!decision.allowed) return authorizationResponse(c, decision);
    await next();
  };
}

export function authorizeOwnerOnly(
  user: AuthenticatedUser | null | undefined,
  resource: OwnedResource,
): AuthorizationDecision {
  if (!user) return unauthenticated();
  return resource.userId === user.id ? allow() : forbidden();
}

export function authorizeRecipeRead(
  user: AuthenticatedUser | null | undefined,
  recipe: RecipeResource,
  household: HouseholdReadContext = noHouseholdReadAccess,
): AuthorizationDecision {
  if (recipe.visibility === "public") return allow();
  if (!user) return unauthenticated();
  if (recipe.userId === user.id) return allow();
  if (
    recipe.visibility === "household" &&
    household.userSharesHouseholdWithOwner
  ) {
    return allow();
  }
  return forbidden();
}

export function authorizeHouseholdMembershipManagement(
  user: AuthenticatedUser | null | undefined,
  household: HouseholdResource,
): AuthorizationDecision {
  if (!user) return unauthenticated();
  return household.ownerId === user.id ? allow() : forbidden();
}
