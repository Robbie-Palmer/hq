import { createRoute, z } from "@hono/zod-openapi";
import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { householdCanaryRecord } from "personal-finance-data";
import type { AuthenticatedSession } from "./auth";
import { requireAuthorization } from "./authorization";
import { householdAuthorizationRequest } from "./project-authorization";
import type { Bindings, RuntimeApp } from "./runtime";

const canaryResponse = z.object({
  classification: z.literal("synthetic-only"),
  id: z.string().max(128),
  label: z.literal("synthetic household"),
});

const writeCanaryRoute = createRoute({
  method: "put",
  path: "/api/canary/household",
  operationId: "writeSyntheticHouseholdCanary",
  security: [{ bearerAuth: [] }],
  tags: ["canary"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({ label: z.literal("synthetic household") }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "The synthetic household canary record.",
      content: { "application/json": { schema: canaryResponse } },
    },
  },
});

const readCanaryRoute = createRoute({
  method: "get",
  path: "/api/canary/household",
  operationId: "readSyntheticHouseholdCanary",
  security: [{ bearerAuth: [] }],
  tags: ["canary"],
  responses: {
    200: {
      description: "The synthetic household canary record.",
      content: { "application/json": { schema: canaryResponse } },
    },
    404: { description: "No synthetic household canary record exists." },
  },
});

type CanaryBindings = Bindings & {
  CANARY_PREVIEW_AUTH_TOKEN?: string;
};

async function tokensMatch(actual: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [actualHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(actual)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const actualBytes = new Uint8Array(actualHash);
  const expectedBytes = new Uint8Array(expectedHash);
  let difference = 0;
  for (let index = 0; index < actualBytes.length; index += 1) {
    difference |= (actualBytes.at(index) ?? 0) ^ (expectedBytes.at(index) ?? 0);
  }
  return difference === 0;
}

async function resolveCanarySession(
  session: AuthenticatedSession | null,
  request: Request,
  env: CanaryBindings,
): Promise<AuthenticatedSession> {
  if (session) return session;
  if (env.DEPLOYMENT_ENV !== "preview" || !env.CANARY_PREVIEW_AUTH_TOKEN) {
    throw new HTTPException(401, { message: "Authentication required" });
  }

  const authorization = request.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  const token = authorization.startsWith(prefix)
    ? authorization.slice(prefix.length)
    : "";
  if (!token || !(await tokensMatch(token, env.CANARY_PREVIEW_AUTH_TOKEN))) {
    throw new HTTPException(401, { message: "Authentication required" });
  }

  return {
    session: {},
    user: { id: "preview-canary" },
  } as AuthenticatedSession;
}

// Copier creates this route extension once. Register product routes here.
export function registerProjectRoutes(app: RuntimeApp): void {
  app.openapi(writeCanaryRoute, async (context) => {
    const session = await resolveCanarySession(
      context.var.session,
      context.req.raw,
      context.env as CanaryBindings,
    );
    await requireAuthorization(
      context.var.authorizationPolicy,
      session,
      householdAuthorizationRequest("household.create", session.user.id),
    );
    const body = context.req.valid("json");
    const id = `synthetic-household-${session.user.id}`;
    const [record] = await context.var.db
      .insert(householdCanaryRecord)
      .values({ id, ownerUserId: session.user.id, label: body.label })
      .onConflictDoUpdate({
        target: householdCanaryRecord.id,
        set: { label: body.label, updatedAt: new Date() },
      })
      .returning();
    if (!record) throw new HTTPException(500, { message: "Canary write failed" });
    return context.json({
      classification: "synthetic-only" as const,
      id: record.id,
      label: "synthetic household" as const,
    }, 200);
  });

  app.openapi(readCanaryRoute, async (context) => {
    const session = await resolveCanarySession(
      context.var.session,
      context.req.raw,
      context.env as CanaryBindings,
    );
    await requireAuthorization(
      context.var.authorizationPolicy,
      session,
      householdAuthorizationRequest("household.read", session.user.id),
    );
    const [record] = await context.var.db
      .select()
      .from(householdCanaryRecord)
      .where(and(
        eq(householdCanaryRecord.id, `synthetic-household-${session.user.id}`),
        eq(householdCanaryRecord.ownerUserId, session.user.id),
      ))
      .limit(1);
    if (!record) return context.body(null, 404);
    return context.json({
      classification: "synthetic-only" as const,
      id: record.id,
      label: "synthetic household" as const,
    }, 200);
  });
}
