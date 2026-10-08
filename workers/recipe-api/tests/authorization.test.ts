import { APIError } from "better-auth";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type AuthenticatedSession,
  authorizeHouseholdMembershipManagement,
  authorizeOwnerOnly,
  authorizeRecipeRead,
  forbidden,
  loadBetterAuthSession,
  requireAuthorization,
  requireAuthenticatedUser,
} from "../src/http/authorization";
import { createAuth } from "../src/auth";

vi.mock("../src/auth", () => ({ createAuth: vi.fn() }));

const mockedCreateAuth = vi.mocked(createAuth);

const ownerSession = {
  user: {
    id: "user-owner",
    email: "owner@example.test",
    name: "Owner",
    emailVerified: true,
    banned: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  },
  session: {
    id: "session-owner",
    token: "token-owner",
    userId: "user-owner",
    expiresAt: new Date("2026-01-02T00:00:00.000Z"),
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  },
} satisfies AuthenticatedSession;

describe("authorization policies", () => {
  it("allows public recipe reads without a user", () => {
    expect(
      authorizeRecipeRead(undefined, {
        userId: "recipe-owner",
        visibility: "public",
      }),
    ).toEqual({ allowed: true });
  });

  it("requires authentication before private or household recipe reads", () => {
    expect(
      authorizeRecipeRead(undefined, {
        userId: "recipe-owner",
        visibility: "private",
      }),
    ).toEqual({
      allowed: false,
      status: 401,
      error: "Authentication required",
    });

    expect(
      authorizeRecipeRead(undefined, {
        userId: "recipe-owner",
        visibility: "household",
      }),
    ).toEqual({
      allowed: false,
      status: 401,
      error: "Authentication required",
    });
  });

  it("allows owner-only resource access only to the resource owner", () => {
    expect(
      authorizeOwnerOnly(ownerSession.user, { userId: "user-owner" }),
    ).toEqual({ allowed: true });
    expect(
      authorizeOwnerOnly(ownerSession.user, { userId: "someone-else" }),
    ).toEqual({
      allowed: false,
      status: 403,
      error: "Authorization required",
    });
  });

  it("allows household-shared recipe reads for household members", () => {
    expect(
      authorizeRecipeRead(
        ownerSession.user,
        {
          userId: "someone-else",
          visibility: "household",
        },
        { userSharesHouseholdWithOwner: true },
      ),
    ).toEqual({ allowed: true });
  });

  it("keeps household membership management owner-only", () => {
    expect(
      authorizeHouseholdMembershipManagement(ownerSession.user, {
        ownerId: "user-owner",
      }),
    ).toEqual({ allowed: true });
    expect(
      authorizeHouseholdMembershipManagement(ownerSession.user, {
        ownerId: "someone-else",
      }),
    ).toEqual({
      allowed: false,
      status: 403,
      error: "Authorization required",
    });
  });
});

function sessionContext(headers: Record<string, string>) {
  const raw = new Headers(headers);
  return {
    req: {
      header: (name: string) => raw.get(name) ?? undefined,
      raw: { headers: raw },
    },
    env: { BETTER_AUTH_URL: "https://recipes.test", BETTER_AUTH_SECRET: "s" },
  } as unknown as Parameters<typeof loadBetterAuthSession>[0];
}

const db = {} as Parameters<typeof loadBetterAuthSession>[1];

function stubGetSession(
  getSession: () => Promise<AuthenticatedSession | null>,
) {
  mockedCreateAuth.mockReturnValue({
    api: { getSession },
  } as unknown as ReturnType<typeof createAuth>);
}

describe("loadBetterAuthSession", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns no session before Better Auth runs when no session signal exists", async () => {
    await expect(loadBetterAuthSession(sessionContext({}), db)).resolves.toBe(
      null,
    );
    expect(mockedCreateAuth).not.toHaveBeenCalled();
  });

  it("treats an unusable session (401) as no session", async () => {
    stubGetSession(() => {
      throw new APIError("UNAUTHORIZED", { message: "Failed to get session" });
    });

    await expect(
      loadBetterAuthSession(sessionContext({ authorization: "Bearer t" }), db),
    ).resolves.toBe(null);
  });

  it("rethrows a genuine internal failure so it stays visible", async () => {
    stubGetSession(() => {
      throw new APIError("INTERNAL_SERVER_ERROR", {
        message: "Failed to get session",
      });
    });

    await expect(
      loadBetterAuthSession(sessionContext({ authorization: "Bearer t" }), db),
    ).rejects.toBeInstanceOf(APIError);
  });

  it("returns the session when Better Auth resolves one", async () => {
    stubGetSession(() => Promise.resolve(ownerSession));

    await expect(
      loadBetterAuthSession(sessionContext({ authorization: "Bearer t" }), db),
    ).resolves.toBe(ownerSession);
  });
});

describe("authorization middleware", () => {
  it("continues to the route with auth context when a session exists", async () => {
    const app = new Hono<{
      Variables: {
        authSession: AuthenticatedSession;
        authUser: AuthenticatedSession["user"];
      };
    }>();
    app.use(
      "/protected",
      requireAuthenticatedUser(async () => ownerSession),
    );
    app.get("/protected", (c) =>
      c.json({
        userId: c.var.authUser.id,
        sessionUserId: c.var.authSession.session.userId,
      }),
    );

    const res = await app.request("/protected");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      userId: "user-owner",
      sessionUserId: "user-owner",
    });
  });

  it("returns 401 when a privileged route has no authenticated session", async () => {
    const app = new Hono();
    app.use(
      "/protected",
      requireAuthenticatedUser(async () => null),
    );
    app.get("/protected", (c) => c.json({ ok: true }));

    const res = await app.request("/protected");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Authentication required" });
  });

  it("returns 403 when an authenticated user is not authorized", async () => {
    const app = new Hono();
    app.use(
      "/owner-only",
      requireAuthorization(
        async () => ownerSession,
        () => forbidden(),
      ),
    );
    app.get("/owner-only", (c) => c.json({ ok: true }));

    const res = await app.request("/owner-only");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Authorization required" });
  });

  it("continues to the route when authorization allows the session", async () => {
    const app = new Hono();
    app.use(
      "/owner-only",
      requireAuthorization(
        async () => ownerSession,
        () => ({ allowed: true }),
      ),
    );
    app.get("/owner-only", (c) => c.json({ ok: true }));

    const res = await app.request("/owner-only");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
