import { and, desc, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import type { Db } from "recipe-db";
import * as schema from "recipe-db/schema";
import type { CookingOutcome } from "recipe-domain/cook-log";
import { resolvePantryScope } from "./pantry";

export type CookingSessionStart = {
  event: "started";
  sessionId: string;
  recipeSlug: string;
  recipeTitle: string;
  recipeVersion: string;
  servings: number;
};

export type CookingSessionCompletion = {
  event: "completed";
  sessionId: string;
  recipeSlug: string;
  recipeTitle: string;
  recipeVersion: string;
  servings: number;
  outcome: CookingOutcome | null;
};

export type CookingSessionEvent =
  | CookingSessionStart
  | CookingSessionCompletion;

export class CookingSessionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CookingSessionConflictError";
  }
}

const cookingSessionSelection = {
  id: schema.cookingSession.id,
  recipeSlug: schema.cookingSession.recipeSlug,
  recipeTitle: schema.cookingSession.recipeTitle,
  recipeVersion: schema.cookingSession.recipeVersion,
  servings: schema.cookingSession.servings,
  repeatOfSessionId: schema.cookingSession.repeatOfSessionId,
  startedAt: schema.cookingSession.startedAt,
  completedAt: schema.cookingSession.completedAt,
};

type CookingTransaction = Parameters<
  Parameters<Db["transaction"]>[0]
>[0];

async function ownedSession(
  db: Pick<Db, "select">,
  userId: string,
  sessionId: string,
) {
  const [session] = await db
    .select(cookingSessionSelection)
    .from(schema.cookingSession)
    .where(
      and(
        eq(schema.cookingSession.id, sessionId),
        eq(schema.cookingSession.userId, userId),
      ),
    )
    .limit(1);
  return session;
}

async function repeatSessionId(
  db: Pick<Db, "select">,
  userId: string,
  sessionId: string,
  recipeSlug: string,
) {
  const [session] = await db
    .select({ id: schema.cookingSession.id })
    .from(schema.cookingSession)
    .where(
      and(
        eq(schema.cookingSession.userId, userId),
        eq(schema.cookingSession.recipeSlug, recipeSlug),
        ne(schema.cookingSession.id, sessionId),
        isNotNull(schema.cookingSession.completedAt),
      ),
    )
    .orderBy(desc(schema.cookingSession.completedAt))
    .limit(1);
  return session?.id ?? null;
}

async function recordStartedSession(
  tx: CookingTransaction,
  userId: string,
  event: CookingSessionStart,
) {
  const [created] = await tx
    .insert(schema.cookingSession)
    .values({
      id: event.sessionId,
      userId,
      recipeSlug: event.recipeSlug,
      recipeTitle: event.recipeTitle,
      recipeVersion: event.recipeVersion,
      servings: event.servings,
    })
    .onConflictDoNothing()
    .returning({ id: schema.cookingSession.id });
  const session = await ownedSession(tx, userId, event.sessionId);
  if (!session) {
    throw new CookingSessionConflictError(
      "Cooking session ID is already in use",
    );
  }
  return { session, created: Boolean(created) };
}

async function recordCompletedSession(
  tx: CookingTransaction,
  userId: string,
  event: CookingSessionCompletion,
) {
  const scope = event.outcome ? await resolvePantryScope(tx, userId) : null;
  if (event.outcome?.audience === "household" && scope?.type !== "household") {
    throw new CookingSessionConflictError(
      "Join a household before sharing a cooking outcome with it",
    );
  }
  const repeatOfSessionId = await repeatSessionId(
    tx,
    userId,
    event.sessionId,
    event.recipeSlug,
  );
  const values = {
    recipeSlug: event.recipeSlug,
    recipeTitle: event.recipeTitle,
    recipeVersion: event.recipeVersion,
    servings: event.servings,
    repeatOfSessionId,
    completedAt: new Date(),
  } as const;

  const [created] = await tx
    .insert(schema.cookingSession)
    .values({ id: event.sessionId, userId, ...values })
    .onConflictDoNothing()
    .returning({ id: schema.cookingSession.id });
  let newlyCompleted = Boolean(created);
  if (!created) {
    const [updated] = await tx
      .update(schema.cookingSession)
      .set({
        ...values,
        version: sql`${schema.cookingSession.version} + 1`,
      })
      .where(
        and(
          eq(schema.cookingSession.id, event.sessionId),
          eq(schema.cookingSession.userId, userId),
          isNull(schema.cookingSession.completedAt),
        ),
      )
      .returning({ id: schema.cookingSession.id });
    newlyCompleted = Boolean(updated);
  }

  const session = await ownedSession(tx, userId, event.sessionId);
  if (!session) {
    throw new CookingSessionConflictError(
      "Cooking session ID is already in use",
    );
  }

  if (newlyCompleted && event.outcome) {
    if (!scope) {
      throw new CookingSessionConflictError(
        "Leftover ownership could not be resolved",
      );
    }
    await tx.insert(schema.leftoverBatch).values({
      cookingSessionId: event.sessionId,
      userId: scope.type === "personal" ? userId : null,
      organizationId: scope.type === "household" ? scope.householdId : null,
      recipeSlug: event.recipeSlug,
      recipeTitle: event.recipeTitle,
      recipeVersion: event.recipeVersion,
      portionsRemaining: event.outcome.leftoverPortions,
      storage: event.outcome.leftoverStorage,
      useBy: event.outcome.leftoverUseBy,
    });
  }

  return { session, created: Boolean(created) };
}

export async function recordCookingSession(
  db: Db,
  userId: string,
  event: CookingSessionEvent,
) {
  return db.transaction((tx) =>
    event.event === "started"
      ? recordStartedSession(tx, userId, event)
      : recordCompletedSession(tx, userId, event),
  );
}
