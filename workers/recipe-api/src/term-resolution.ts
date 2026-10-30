import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "recipe-db";
import * as schema from "recipe-db/schema";
import {
  rankTermReviewQueue,
  type AuthoredTermKind,
  type AuthoredTermResolutionStatus,
  type TermResolutionCommand,
  termHasCandidateCollision,
  termNeedsLocaleReview,
} from "recipe-domain/authored-term";
import { z } from "zod";
import type { DbTransaction } from "./db/types";

type ResolutionDb = Db | DbTransaction;

export type TermResolutionTarget = {
  kind: AuthoredTermKind;
  normalizedText: string;
  locale: string;
};

type TermState = {
  id: string;
  resolutionStatus: AuthoredTermResolutionStatus;
  canonicalSlug: string | null;
};

type RegistryEntryState = {
  kind: AuthoredTermKind;
  normalizedText: string;
  locale: string;
  canonicalSlug: string;
  canonicalName: string | null;
  registryVersion: number;
} | null;

type ResolutionSnapshot = {
  terms: TermState[];
  registryEntry: RegistryEntryState;
};

const resolutionSnapshotSchema = z.object({
  terms: z.array(
    z.object({
      id: z.uuid(),
      resolutionStatus: z.enum([
        "unresolved",
        "resolved",
        "deferred",
        "rejected",
      ]),
      canonicalSlug: z.string().nullable(),
    }),
  ),
  registryEntry: z
    .object({
      kind: z.enum(["ingredient", "equipment"]),
      normalizedText: z.string(),
      locale: z.string(),
      canonicalSlug: z.string(),
      canonicalName: z.string().nullable(),
      registryVersion: z.number().int().positive(),
    })
    .nullable(),
});

export class TermResolutionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TermResolutionConflictError";
  }
}

export class TermResolutionNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TermResolutionNotFoundError";
  }
}

export type TermReviewQueueItem = {
  kind: AuthoredTermKind;
  normalizedText: string;
  locale: string;
  registryVersion: number;
  rawTexts: string[];
  submissionCount: number;
  tenantCount: number;
  lastSeenAt: Date;
  localeReviewRequired: boolean;
  collisionReviewRequired: boolean;
  contexts: Array<{
    termId: string;
    observationKey: string;
    rawText: string;
    locale: string;
    sourceContext: (typeof schema.authoredTermObservation.$inferSelect)["sourceContext"];
    provenance: (typeof schema.authoredTermObservation.$inferSelect)["provenance"];
    candidateMatches: (typeof schema.authoredTermObservation.$inferSelect)["candidateMatches"];
    submissionCount: number;
    firstSeenAt: Date;
    lastSeenAt: Date;
  }>;
};

function targetFilter(target: TermResolutionTarget) {
  return and(
    eq(schema.authoredTerm.kind, target.kind),
    eq(schema.authoredTerm.normalizedText, target.normalizedText),
    eq(schema.authoredTerm.locale, target.locale),
  );
}

function targetKey(target: TermResolutionTarget): string {
  return JSON.stringify([target.kind, target.normalizedText, target.locale]);
}

function sourceKey(
  observation: Pick<
    typeof schema.authoredTermObservation.$inferSelect,
    "observationKey"
  >,
): string {
  return observation.observationKey;
}

function groupBy<T>(
  values: readonly T[],
  keyFor: (value: T) => string,
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const value of values) {
    const key = keyFor(value);
    const group = groups.get(key);
    if (group) group.push(value);
    else groups.set(key, [value]);
  }
  return groups;
}

export async function listTermReviewQueue(
  db: Db,
): Promise<TermReviewQueueItem[]> {
  const registryVersion = await currentRegistryVersion(db);
  const terms = await db
    .select({
      id: schema.authoredTerm.id,
      kind: schema.authoredTerm.kind,
      rawText: schema.authoredTerm.rawText,
      normalizedText: schema.authoredTerm.normalizedText,
      locale: schema.authoredTerm.locale,
      frequency: schema.authoredTerm.frequency,
      lastSeenAt: schema.authoredTerm.lastSeenAt,
    })
    .from(schema.authoredTerm)
    .where(
      inArray(schema.authoredTerm.resolutionStatus, ["unresolved", "deferred"]),
    );
  if (terms.length === 0) return [];

  const observations = await db
    .select()
    .from(schema.authoredTermObservation)
    .where(
      inArray(
        schema.authoredTermObservation.termId,
        terms.map(({ id }) => id),
      ),
    )
    .orderBy(desc(schema.authoredTermObservation.lastSeenAt));
  const observationsByTerm = groupBy(observations, ({ termId }) => termId);
  const localesByIdentity = groupBy(
    terms,
    ({ kind, normalizedText }) => JSON.stringify([kind, normalizedText]),
  );
  const groups = groupBy(terms, (term) =>
    targetKey({
      kind: term.kind,
      normalizedText: term.normalizedText,
      locale: term.locale,
    }),
  );

  return rankTermReviewQueue(
    Array.from(groups.values(), (group): TermReviewQueueItem => {
      const first = group[0];
      if (!first) throw new Error("Term review group cannot be empty");
      const contexts = group.flatMap((term) =>
        (observationsByTerm.get(term.id) ?? []).map((observation) => ({
          termId: term.id,
          observationKey: observation.observationKey,
          rawText: observation.rawText,
          locale: observation.locale,
          sourceContext: observation.sourceContext,
          provenance: observation.provenance,
          candidateMatches: observation.candidateMatches,
          submissionCount: observation.submissionCount,
          firstSeenAt: observation.firstSeenAt,
          lastSeenAt: observation.lastSeenAt,
        })),
      );
      const identityLocales =
        localesByIdentity.get(
          JSON.stringify([first.kind, first.normalizedText]),
        ) ?? [];
      const candidates = contexts.flatMap(({ candidateMatches }) =>
        candidateMatches.map(({ slug }) => slug),
      );
      return {
        kind: first.kind,
        normalizedText: first.normalizedText,
        locale: first.locale,
        registryVersion,
        rawTexts: Array.from(new Set(group.map(({ rawText }) => rawText))).sort(),
        submissionCount: group.reduce(
          (total, { frequency }) => total + frequency,
          0,
        ),
        tenantCount: group.length,
        lastSeenAt: new Date(
          Math.max(...group.map(({ lastSeenAt }) => lastSeenAt.getTime())),
        ),
        localeReviewRequired: termNeedsLocaleReview(
          first.locale,
          identityLocales.map(({ locale }) => locale),
        ),
        collisionReviewRequired: termHasCandidateCollision(candidates),
        contexts,
      };
    }),
  );
}

async function currentRegistryVersion(db: ResolutionDb): Promise<number> {
  const [latest] = await db
    .select({ version: schema.termRegistryRevision.version })
    .from(schema.termRegistryRevision)
    .orderBy(desc(schema.termRegistryRevision.version))
    .limit(1);
  return latest?.version ?? 0;
}

async function currentRegistryEntry(
  db: ResolutionDb,
  target: TermResolutionTarget,
): Promise<RegistryEntryState> {
  const [entry] = await db
    .select({
      kind: schema.termRegistryEntry.kind,
      normalizedText: schema.termRegistryEntry.normalizedText,
      locale: schema.termRegistryEntry.locale,
      canonicalSlug: schema.termRegistryEntry.canonicalSlug,
      canonicalName: schema.termRegistryEntry.canonicalName,
      registryVersion: schema.termRegistryEntry.registryVersion,
    })
    .from(schema.termRegistryEntry)
    .where(
      and(
        eq(schema.termRegistryEntry.kind, target.kind),
        eq(schema.termRegistryEntry.normalizedText, target.normalizedText),
        eq(schema.termRegistryEntry.locale, target.locale),
      ),
    )
    .limit(1);
  return entry ?? null;
}

async function snapshotTarget(
  db: ResolutionDb,
  target: TermResolutionTarget,
): Promise<ResolutionSnapshot> {
  const terms = await db
    .select({
      id: schema.authoredTerm.id,
      resolutionStatus: schema.authoredTerm.resolutionStatus,
      canonicalSlug: schema.authoredTerm.canonicalSlug,
    })
    .from(schema.authoredTerm)
    .where(targetFilter(target))
    .orderBy(schema.authoredTerm.id);
  return { terms, registryEntry: await currentRegistryEntry(db, target) };
}

function snapshotsEqual(left: ResolutionSnapshot, right: ResolutionSnapshot) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function commandMatchesDecision(
  decision: typeof schema.termResolutionDecision.$inferSelect,
  target: TermResolutionTarget,
  command: TermResolutionCommand,
): boolean {
  return (
    decision.kind === target.kind &&
    decision.normalizedText === target.normalizedText &&
    decision.locale === target.locale &&
    decision.action === command.action &&
    decision.targetSlug === ("targetSlug" in command ? command.targetSlug : null) &&
    decision.canonicalName ===
      ("canonicalName" in command ? command.canonicalName : null) &&
    decision.reversesDecisionId ===
      ("reversesDecisionId" in command ? command.reversesDecisionId : null)
  );
}

async function assertExplicitReviews(
  tx: DbTransaction,
  target: TermResolutionTarget,
  command: TermResolutionCommand,
) {
  if (command.action === "defer" || command.action === "reversal") return;
  const matchingLocales = await tx
    .select({ locale: schema.authoredTerm.locale })
    .from(schema.authoredTerm)
    .where(
      and(
        eq(schema.authoredTerm.kind, target.kind),
        eq(schema.authoredTerm.normalizedText, target.normalizedText),
      ),
    );
  if (
    termNeedsLocaleReview(
      target.locale,
      matchingLocales.map(({ locale }) => locale),
    ) &&
    !command.localeReview
  ) {
    throw new TermResolutionConflictError(
      "This term has an ambiguous locale and requires explicit locale review",
    );
  }

  const termIds = (
    await tx
      .select({ id: schema.authoredTerm.id })
      .from(schema.authoredTerm)
      .where(targetFilter(target))
  ).map(({ id }) => id);
  if (termIds.length === 0) return;
  const evidence = await tx
    .select({ candidateMatches: schema.authoredTermObservation.candidateMatches })
    .from(schema.authoredTermObservation)
    .where(inArray(schema.authoredTermObservation.termId, termIds));
  if (
    termHasCandidateCollision(
      evidence.flatMap(({ candidateMatches }) =>
        candidateMatches.map(({ slug }) => slug),
      ),
    ) &&
    !command.collisionReview
  ) {
    throw new TermResolutionConflictError(
      "Candidate evidence collides and requires explicit collision review",
    );
  }
}

async function assertTargetSemantics(
  tx: DbTransaction,
  target: TermResolutionTarget,
  command: TermResolutionCommand,
) {
  if (
    target.kind !== "ingredient" ||
    !("targetSlug" in command)
  ) {
    return;
  }
  const [ingredient] = await tx
    .select({ slug: schema.ingredient.slug })
    .from(schema.ingredient)
    .where(eq(schema.ingredient.slug, command.targetSlug))
    .limit(1);
  if (command.action === "new_canonical" && ingredient) {
    throw new TermResolutionConflictError(
      `Canonical ingredient ${command.targetSlug} already exists`,
    );
  }
  if (command.action !== "new_canonical" && !ingredient) {
    throw new TermResolutionConflictError(
      `Canonical ingredient ${command.targetSlug} does not exist`,
    );
  }
}

async function insertRegistryRevision(
  tx: DbTransaction,
  input: {
    decisionId: string;
    target: TermResolutionTarget;
    action: TermResolutionCommand["action"];
    canonicalSlug: string | null;
    canonicalName: string | null;
    reviewerUserId: string;
  },
): Promise<number> {
  const [revision] = await tx
    .insert(schema.termRegistryRevision)
    .values({
      decisionId: input.decisionId,
      ...input.target,
      action: input.action,
      canonicalSlug: input.canonicalSlug,
      canonicalName: input.canonicalName,
      createdByUserId: input.reviewerUserId,
    })
    .returning({ version: schema.termRegistryRevision.version });
  if (!revision) throw new Error("Registry revision insert failed");
  return revision.version;
}

async function applySnapshot(
  tx: DbTransaction,
  target: TermResolutionTarget,
  snapshot: ResolutionSnapshot,
  registryVersion: number,
) {
  for (const term of snapshot.terms) {
    await tx
      .update(schema.authoredTerm)
      .set({
        resolutionStatus: term.resolutionStatus,
        canonicalSlug: term.canonicalSlug,
        updatedAt: new Date(),
      })
      .where(eq(schema.authoredTerm.id, term.id));
  }
  if (snapshot.registryEntry) {
    await tx
      .insert(schema.termRegistryEntry)
      .values({
        ...snapshot.registryEntry,
        registryVersion,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          schema.termRegistryEntry.kind,
          schema.termRegistryEntry.normalizedText,
          schema.termRegistryEntry.locale,
        ],
        set: {
          canonicalSlug: snapshot.registryEntry.canonicalSlug,
          canonicalName: snapshot.registryEntry.canonicalName,
          registryVersion,
          updatedAt: new Date(),
        },
      });
  } else {
    await tx
      .delete(schema.termRegistryEntry)
      .where(
        and(
          eq(schema.termRegistryEntry.kind, target.kind),
          eq(schema.termRegistryEntry.normalizedText, target.normalizedText),
          eq(schema.termRegistryEntry.locale, target.locale),
        ),
      );
  }
}

type DecisionPlan = {
  desiredState: ResolutionSnapshot;
  targetSlug: string | null;
  canonicalName: string | null;
  reversesDecisionId: string | null;
};

async function findIdempotentDecision(
  tx: DbTransaction,
  target: TermResolutionTarget,
  command: TermResolutionCommand,
) {
  const [existing] = await tx
    .select()
    .from(schema.termResolutionDecision)
    .where(
      eq(schema.termResolutionDecision.idempotencyKey, command.idempotencyKey),
    )
    .limit(1);
  if (!existing) return undefined;
  if (!commandMatchesDecision(existing, target, command)) {
    throw new TermResolutionConflictError(
      "The idempotency key was already used for a different resolution",
    );
  }
  return existing;
}

function assertExpectedRegistryVersion(
  expected: number | undefined,
  current: number,
) {
  if (expected === undefined || expected === current) return;
  throw new TermResolutionConflictError(
    `Registry version changed from ${expected} to ${current}`,
  );
}

async function reversalPlan(
  tx: DbTransaction,
  target: TermResolutionTarget,
  command: Extract<TermResolutionCommand, { action: "reversal" }>,
  beforeState: ResolutionSnapshot,
): Promise<DecisionPlan> {
  const [prior] = await tx
    .select()
    .from(schema.termResolutionDecision)
    .where(eq(schema.termResolutionDecision.id, command.reversesDecisionId))
    .limit(1);
  if (!prior) {
    throw new TermResolutionNotFoundError("The decision to reverse was not found");
  }
  const sameTarget =
    prior.kind === target.kind &&
    prior.normalizedText === target.normalizedText &&
    prior.locale === target.locale;
  if (!sameTarget) {
    throw new TermResolutionConflictError(
      "A reversal must target the same authored term identity",
    );
  }
  const priorAfter = resolutionSnapshotSchema.parse(prior.afterState);
  if (!snapshotsEqual(beforeState, priorAfter)) {
    throw new TermResolutionConflictError(
      "The term changed after this decision and cannot be reversed safely",
    );
  }
  return {
    desiredState: resolutionSnapshotSchema.parse(prior.beforeState),
    targetSlug: null,
    canonicalName: null,
    reversesDecisionId: prior.id,
  };
}

function forwardPlan(
  target: TermResolutionTarget,
  command: Exclude<TermResolutionCommand, { action: "reversal" }>,
  beforeState: ResolutionSnapshot,
  registryVersion: number,
): DecisionPlan {
  const targetSlug = "targetSlug" in command ? command.targetSlug : null;
  const canonicalName =
    "canonicalName" in command ? command.canonicalName : null;
  const resolutionStatus: AuthoredTermResolutionStatus = targetSlug
    ? "resolved"
    : command.action === "defer"
      ? "deferred"
      : "rejected";
  return {
    desiredState: {
      terms: beforeState.terms.map(({ id }) => ({
        id,
        resolutionStatus,
        canonicalSlug: targetSlug,
      })),
      registryEntry: targetSlug
        ? {
            ...target,
            canonicalSlug: targetSlug,
            canonicalName,
            registryVersion: registryVersion + 1,
          }
        : null,
    },
    targetSlug,
    canonicalName,
    reversesDecisionId: null,
  };
}

async function buildDecisionPlan(
  tx: DbTransaction,
  target: TermResolutionTarget,
  command: TermResolutionCommand,
  beforeState: ResolutionSnapshot,
  registryVersion: number,
): Promise<DecisionPlan> {
  return command.action === "reversal"
    ? reversalPlan(tx, target, command, beforeState)
    : forwardPlan(target, command, beforeState, registryVersion);
}

async function insertDecision(
  tx: DbTransaction,
  reviewerUserId: string,
  target: TermResolutionTarget,
  command: TermResolutionCommand,
  beforeState: ResolutionSnapshot,
  plan: DecisionPlan,
) {
  const [decision] = await tx
    .insert(schema.termResolutionDecision)
    .values({
      idempotencyKey: command.idempotencyKey,
      ...target,
      action: command.action,
      targetSlug: plan.targetSlug,
      canonicalName: plan.canonicalName,
      rationale: command.rationale,
      evidence: command.evidence,
      localeReview: command.localeReview,
      collisionReview: command.collisionReview,
      decidedByUserId: reviewerUserId,
      reversesDecisionId: plan.reversesDecisionId,
      beforeState,
      afterState: plan.desiredState,
    })
    .returning();
  if (!decision) throw new Error("Term resolution decision insert failed");
  return decision;
}

async function applyDecision(
  tx: DbTransaction,
  reviewerUserId: string,
  target: TermResolutionTarget,
  command: TermResolutionCommand,
  decision: typeof schema.termResolutionDecision.$inferSelect,
  plan: DecisionPlan,
) {
  const version = await insertRegistryRevision(tx, {
    decisionId: decision.id,
    target,
    action: command.action,
    canonicalSlug: plan.desiredState.registryEntry?.canonicalSlug ?? null,
    canonicalName: plan.desiredState.registryEntry?.canonicalName ?? null,
    reviewerUserId,
  });
  const versionedState: ResolutionSnapshot = {
    ...plan.desiredState,
    registryEntry: plan.desiredState.registryEntry
      ? { ...plan.desiredState.registryEntry, registryVersion: version }
      : null,
  };
  await applySnapshot(tx, target, versionedState, version);
  if (command.action === "new_canonical" && target.kind === "ingredient") {
    const [ingredient] = await tx
      .insert(schema.ingredient)
      .values({ slug: command.targetSlug, name: command.canonicalName })
      .onConflictDoNothing()
      .returning({ slug: schema.ingredient.slug });
    if (!ingredient) {
      throw new TermResolutionConflictError(
        `Canonical ingredient ${command.targetSlug} already exists`,
      );
    }
  }
  const [updated] = await tx
    .update(schema.termResolutionDecision)
    .set({ registryVersion: version, afterState: versionedState })
    .where(eq(schema.termResolutionDecision.id, decision.id))
    .returning();
  await tx
    .insert(schema.termReprojectionRun)
    .values({ decisionId: decision.id })
    .onConflictDoNothing();
  if (!updated) throw new Error("Term resolution decision update failed");
  return updated;
}

async function createDecision(
  db: Db,
  reviewerUserId: string,
  target: TermResolutionTarget,
  command: TermResolutionCommand,
) {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('term-resolution-registry'))`,
    );
    const existing = await findIdempotentDecision(tx, target, command);
    if (existing) return existing;

    const registryVersion = await currentRegistryVersion(tx);
    assertExpectedRegistryVersion(command.expectedRegistryVersion, registryVersion);
    await assertExplicitReviews(tx, target, command);
    await assertTargetSemantics(tx, target, command);
    const beforeState = await snapshotTarget(tx, target);
    if (beforeState.terms.length === 0) {
      throw new TermResolutionNotFoundError("No authored terms match this target");
    }
    const plan = await buildDecisionPlan(
      tx,
      target,
      command,
      beforeState,
      registryVersion,
    );
    const decision = await insertDecision(
      tx,
      reviewerUserId,
      target,
      command,
      beforeState,
      plan,
    );
    return applyDecision(
      tx,
      reviewerUserId,
      target,
      command,
      decision,
      plan,
    );
  });
}

async function executeReprojection(db: Db, decisionId: string) {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`term-reprojection:${decisionId}`}))`,
    );
    const [decision] = await tx
      .select()
      .from(schema.termResolutionDecision)
      .where(eq(schema.termResolutionDecision.id, decisionId))
      .limit(1);
    if (!decision) throw new TermResolutionNotFoundError("Decision not found");
    const [existingRun] = await tx
      .select()
      .from(schema.termReprojectionRun)
      .where(eq(schema.termReprojectionRun.decisionId, decisionId))
      .limit(1);
    if (existingRun?.status === "succeeded") return existingRun;

    await tx
      .insert(schema.termReprojectionRun)
      .values({
        decisionId,
        status: "running",
        attemptCount: 1,
        startedAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.termReprojectionRun.decisionId,
        set: {
          status: "running",
          attemptCount: sql`${schema.termReprojectionRun.attemptCount} + 1`,
          lastError: null,
          startedAt: new Date(),
          completedAt: null,
          updatedAt: new Date(),
        },
      });

    const state = resolutionSnapshotSchema.parse(decision.afterState);
    const termIds = state.terms.map(({ id }) => id);
    await tx
      .delete(schema.authoredTermProjection)
      .where(inArray(schema.authoredTermProjection.termId, termIds));
    const resolved = new Map(
      state.terms
        .filter(
          (term): term is TermState & { canonicalSlug: string } =>
            term.resolutionStatus === "resolved" && term.canonicalSlug !== null,
        )
        .map((term) => [term.id, term.canonicalSlug]),
    );
    let projectedContextCount = 0;
    if (resolved.size > 0) {
      const observations = await tx
        .select()
        .from(schema.authoredTermObservation)
        .where(
          inArray(schema.authoredTermObservation.termId, Array.from(resolved.keys())),
        );
      if (observations.length > 0) {
        await tx
          .insert(schema.authoredTermProjection)
          .values(
            observations.map((observation) => ({
              termId: observation.termId,
              decisionId,
              sourceKey: sourceKey(observation),
              sourceContext: observation.sourceContext,
              canonicalSlug: resolved.get(observation.termId) as string,
              registryVersion: decision.registryVersion as number,
            })),
          )
          .onConflictDoUpdate({
            target: [
              schema.authoredTermProjection.termId,
              schema.authoredTermProjection.sourceKey,
            ],
            set: {
              decisionId,
              canonicalSlug: sql`excluded.canonical_slug`,
              registryVersion: decision.registryVersion as number,
              projectedAt: new Date(),
            },
          });
        projectedContextCount = observations.length;
      }
    }

    const [completed] = await tx
      .update(schema.termReprojectionRun)
      .set({
        status: "succeeded",
        projectedTermCount: resolved.size,
        projectedContextCount,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.termReprojectionRun.decisionId, decisionId))
      .returning();
    if (!completed) throw new Error("Reprojection run update failed");
    return completed;
  });
}

export async function runTermReprojection(db: Db, decisionId: string) {
  try {
    return await executeReprojection(db, decisionId);
  } catch (error) {
    await db
      .update(schema.termReprojectionRun)
      .set({
        status: "failed",
        attemptCount: sql`${schema.termReprojectionRun.attemptCount} + 1`,
        lastError: error instanceof Error ? error.message.slice(0, 2_000) : "Unknown error",
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.termReprojectionRun.decisionId, decisionId));
    throw error;
  }
}

export async function resolveAuthoredTerm(
  db: Db,
  reviewerUserId: string,
  target: TermResolutionTarget,
  command: TermResolutionCommand,
) {
  const decision = await createDecision(db, reviewerUserId, target, command);
  const reprojection = await runTermReprojection(db, decision.id);
  return { decision, reprojection };
}

export async function listTermResolutionAudit(db: Db, limit = 100) {
  const decisions = await db
    .select()
    .from(schema.termResolutionDecision)
    .orderBy(desc(schema.termResolutionDecision.createdAt))
    .limit(Math.min(Math.max(limit, 1), 200));
  if (decisions.length === 0) return [];
  const runs = await db
    .select()
    .from(schema.termReprojectionRun)
    .where(
      inArray(
        schema.termReprojectionRun.decisionId,
        decisions.map(({ id }) => id),
      ),
    );
  const runsByDecision = new Map(runs.map((run) => [run.decisionId, run]));
  return decisions.map((decision) => ({
    ...decision,
    reprojection: runsByDecision.get(decision.id) ?? null,
  }));
}
