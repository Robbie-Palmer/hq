import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "recipe-db";
import * as schema from "recipe-db/schema";
import {
  authoredTermObservationKey,
  normalizeAuthoredTerm,
} from "recipe-domain/authored-term";
import {
  type AuthoredTermObservation,
  type AuthoredTermOwner,
  observeAuthoredTerm,
} from "../src/authored-terms";
import { resolveAuthoredTerm } from "../src/term-resolution";

type PreviewTermReviewUsers = {
  reviewerUserId: string;
  recipesUserId: string;
  householdOwnerUserId: string;
  householdId: string;
};

type PreviewTermObservation = {
  owner: AuthoredTermOwner;
  observation: AuthoredTermObservation;
  submissionCount: number;
};

function ownerFilter(owner: AuthoredTermOwner) {
  return owner.type === "user"
    ? and(
        eq(schema.authoredTerm.userId, owner.userId),
        isNull(schema.authoredTerm.organizationId),
      )
    : and(
        eq(schema.authoredTerm.organizationId, owner.organizationId),
        isNull(schema.authoredTerm.userId),
      );
}

async function existingObservationCount(
  db: Db,
  fixture: PreviewTermObservation,
): Promise<number> {
  const locale = fixture.observation.locale?.trim() || "und";
  const normalizedText = normalizeAuthoredTerm(
    fixture.observation.rawText,
    locale,
  );
  const [term] = await db
    .select({ id: schema.authoredTerm.id })
    .from(schema.authoredTerm)
    .where(
      and(
        ownerFilter(fixture.owner),
        eq(schema.authoredTerm.kind, fixture.observation.kind),
        eq(schema.authoredTerm.normalizedText, normalizedText),
      ),
    )
    .limit(1);
  if (!term) return 0;

  const observationKey = authoredTermObservationKey({
    locale,
    sourceContext: fixture.observation.sourceContext,
    provenance: fixture.observation.provenance,
  });
  const [observation] = await db
    .select({ submissionCount: schema.authoredTermObservation.submissionCount })
    .from(schema.authoredTermObservation)
    .where(
      and(
        eq(schema.authoredTermObservation.termId, term.id),
        eq(schema.authoredTermObservation.observationKey, observationKey),
      ),
    )
    .limit(1);
  return observation?.submissionCount ?? 0;
}

async function ensureObservationCount(
  db: Db,
  fixture: PreviewTermObservation,
): Promise<void> {
  const currentCount = await existingObservationCount(db, fixture);
  const missingCount = Math.max(fixture.submissionCount - currentCount, 0);
  await Promise.all(
    Array.from({ length: missingCount }, () =>
      observeAuthoredTerm(db, fixture.owner, fixture.observation),
    ),
  );
}

function pendingFixtures(
  users: PreviewTermReviewUsers,
): PreviewTermObservation[] {
  const recipesUser = { type: "user" as const, userId: users.recipesUserId };
  const household = {
    type: "household" as const,
    organizationId: users.householdId,
  };
  return [
    {
      owner: recipesUser,
      submissionCount: 3,
      observation: {
        kind: "ingredient",
        rawText: "Scallions",
        locale: "en-US",
        sourceContext: {
          flow: "recipe",
          resourceId: "preview-private-weeknight-pasta",
          field: "ingredients",
        },
        provenance: { kind: "user", actorUserId: users.recipesUserId },
        candidateMatches: [
          { slug: "spring-onion", score: 0.94 },
          { slug: "onion", score: 0.62 },
        ],
      },
    },
    {
      owner: recipesUser,
      submissionCount: 2,
      observation: {
        kind: "ingredient",
        rawText: "Scallions",
        locale: "en-US",
        sourceContext: {
          flow: "recipe",
          resourceId: "preview-imported-noodle-salad",
          field: "ingredients",
        },
        provenance: {
          kind: "import",
          actorUserId: users.recipesUserId,
          importJobId: "90000000-0000-4000-8000-000000000001",
        },
        candidateMatches: [
          { slug: "spring-onion", score: 0.92 },
          { slug: "onion", score: 0.6 },
        ],
      },
    },
    {
      owner: household,
      submissionCount: 2,
      observation: {
        kind: "ingredient",
        rawText: "scallions",
        locale: "en-US",
        sourceContext: {
          flow: "pantry",
          resourceId: users.householdId,
          field: "stock",
        },
        provenance: {
          kind: "user",
          actorUserId: users.householdOwnerUserId,
        },
        candidateMatches: [
          { slug: "spring-onion", score: 0.93 },
          { slug: "onion", score: 0.61 },
        ],
      },
    },
    {
      owner: recipesUser,
      submissionCount: 2,
      observation: {
        kind: "ingredient",
        rawText: "Green Onion",
        locale: "en-US",
        sourceContext: {
          flow: "diet",
          resourceId: users.recipesUserId,
          field: "excludedIngredients",
        },
        provenance: { kind: "user", actorUserId: users.recipesUserId },
        candidateMatches: [
          { slug: "spring-onion", score: 0.91 },
          { slug: "onion", score: 0.55 },
        ],
      },
    },
    {
      owner: household,
      submissionCount: 1,
      observation: {
        kind: "ingredient",
        rawText: "green onion",
        locale: "en-GB",
        sourceContext: {
          flow: "pantry",
          resourceId: users.householdId,
          field: "stock",
        },
        provenance: {
          kind: "user",
          actorUserId: users.householdOwnerUserId,
        },
        candidateMatches: [
          { slug: "spring-onion", score: 0.88 },
          { slug: "onion", score: 0.58 },
        ],
      },
    },
    {
      owner: recipesUser,
      submissionCount: 1,
      observation: {
        kind: "ingredient",
        rawText: "Charred Pepper Flakes",
        locale: "en-GB",
        sourceContext: {
          flow: "recipe",
          resourceId: "preview-private-weeknight-pasta",
          field: "ingredients",
        },
        provenance: { kind: "user", actorUserId: users.recipesUserId },
        candidateMatches: [],
      },
    },
    {
      owner: household,
      submissionCount: 1,
      observation: {
        kind: "ingredient",
        rawText: "Mystery Herb Blend",
        locale: "en-GB",
        sourceContext: {
          flow: "pantry",
          resourceId: users.householdId,
          field: "stock",
        },
        provenance: {
          kind: "user",
          actorUserId: users.householdOwnerUserId,
        },
        candidateMatches: [],
      },
    },
    {
      owner: household,
      submissionCount: 1,
      observation: {
        kind: "equipment",
        rawText: "Stovetop Griddle Thing",
        locale: "und",
        sourceContext: {
          flow: "equipment",
          resourceId: users.householdId,
          field: "inventory",
        },
        provenance: {
          kind: "user",
          actorUserId: users.householdOwnerUserId,
        },
        candidateMatches: [
          { slug: "griddle-pan", score: 0.72 },
          { slug: "frying-pan", score: 0.71 },
        ],
      },
    },
  ];
}

function completedAliasFixture(
  users: PreviewTermReviewUsers,
): PreviewTermObservation {
  return {
    owner: { type: "user", userId: users.recipesUserId },
    submissionCount: 1,
    observation: {
      kind: "ingredient",
      rawText: "Garbanzo Bean",
      locale: "en-US",
      sourceContext: {
        flow: "pantry",
        resourceId: users.recipesUserId,
        field: "stock",
      },
      provenance: { kind: "user", actorUserId: users.recipesUserId },
      candidateMatches: [{ slug: "chickpeas", score: 0.98 }],
    },
  };
}

export async function seedPreviewTermReviewFixtures(
  db: Db,
  users: PreviewTermReviewUsers,
): Promise<void> {
  await Promise.all(
    pendingFixtures(users).map((fixture) =>
      ensureObservationCount(db, fixture),
    ),
  );

  const completedAlias = completedAliasFixture(users);
  await ensureObservationCount(db, completedAlias);
  await resolveAuthoredTerm(
    db,
    users.reviewerUserId,
    {
      kind: "ingredient",
      normalizedText: normalizeAuthoredTerm(
        completedAlias.observation.rawText,
        completedAlias.observation.locale,
      ),
      locale: completedAlias.observation.locale ?? "und",
    },
    {
      action: "alias",
      idempotencyKey: "90000000-0000-4000-8000-000000000002",
      rationale: "Preview fixture: garbanzo bean is a regional name for chickpeas.",
      evidence: ["Seeded candidate chickpeas scored 0.98."],
      targetSlug: "chickpeas",
      localeReview: false,
      collisionReview: false,
    },
  );
}
