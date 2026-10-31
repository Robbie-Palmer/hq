import { and, eq, inArray } from "drizzle-orm";
import { closeDbClient, createDb, schema } from "recipe-db";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { observeAuthoredTerm } from "../../src/authored-terms";
import {
  listTermReviewQueue,
  resolveAuthoredTerm,
  runTermReprojection,
  TermResolutionConflictError,
} from "../../src/term-resolution";

const databaseURL = process.env.DATABASE_URL;
if (!databaseURL) throw new Error("DATABASE_URL is required for integration tests");

const { db, client } = createDb(databaseURL);
const reviewerId = "term-reviewer";

async function seedUsers() {
  await db.insert(schema.user).values([
    {
      id: reviewerId,
      name: "Term Reviewer",
      email: "term-reviewer@example.test",
      emailVerified: true,
      role: "admin",
    },
    {
      id: "cook-a",
      name: "Cook A",
      email: "cook-a@example.test",
      emailVerified: true,
    },
    {
      id: "cook-b",
      name: "Cook B",
      email: "cook-b@example.test",
      emailVerified: true,
    },
  ]);
}

async function observeIngredient(input: {
  userId?: string;
  rawText: string;
  locale?: string;
  resourceId?: string;
  candidateMatches?: Array<{ slug: string; score: number }>;
}) {
  const userId = input.userId ?? "cook-a";
  return observeAuthoredTerm(db, { type: "user", userId }, {
    kind: "ingredient",
    rawText: input.rawText,
    locale: input.locale,
    sourceContext: {
      flow: "recipe",
      resourceId: input.resourceId ?? `recipe-${userId}`,
      field: "ingredients",
    },
    provenance: { kind: "user", actorUserId: userId },
    candidateMatches: input.candidateMatches,
  });
}

beforeEach(async () => {
  await client.unsafe('truncate table "user" restart identity cascade');
  await seedUsers();
  await db.insert(schema.ingredient).values([
    { slug: "test-existing-alias", name: "Existing alias target" },
    { slug: "test-existing-merge", name: "Existing merge target" },
    { slug: "canonical-herb-1", name: "Canonical herb one" },
    { slug: "canonical-herb-2", name: "Canonical herb two" },
  ]);
});

afterEach(async () => {
  await client.unsafe('truncate table "user" restart identity cascade');
  await db
    .delete(schema.ingredient)
    .where(
      inArray(schema.ingredient.slug, [
        "test-existing-alias",
        "test-existing-merge",
        "canonical-herb-1",
        "canonical-herb-2",
        "test-tigernut-flour",
      ]),
    );
});

afterAll(async () => {
  await closeDbClient(client);
});

describe("term resolution persistence", () => {
  it("ranks retained evidence and applies a concurrent alias command once", async () => {
    await observeIngredient({ rawText: "Scallion", locale: "en-US" });
    await observeIngredient({ rawText: "SCALLION", locale: "en-US" });
    await observeIngredient({
      userId: "cook-b",
      rawText: "scallion",
      locale: "en-US",
    });
    await observeIngredient({ rawText: "spurtle", locale: "en-GB" });

    const queue = await listTermReviewQueue(db);
    expect(queue[0]).toMatchObject({
      normalizedText: "scallion",
      locale: "en-US",
      registryVersion: 0,
      submissionCount: 3,
      tenantCount: 2,
    });
    expect(queue[0]?.contexts).toHaveLength(2);
    expect(queue[0]?.contexts[0]).toMatchObject({
      sourceContext: { flow: "recipe", field: "ingredients" },
      provenance: { kind: "user" },
    });

    const target = {
      kind: "ingredient" as const,
      normalizedText: "scallion",
      locale: "en-US",
    };
    const command = {
      action: "alias" as const,
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      rationale: "Regional synonym for spring onion.",
      evidence: ["Three submissions from two cooks."],
      targetSlug: "test-existing-alias",
      expectedRegistryVersion: 0,
      localeReview: false,
      collisionReview: false,
    };
    const [first, duplicate] = await Promise.all([
      resolveAuthoredTerm(db, reviewerId, target, command),
      resolveAuthoredTerm(db, reviewerId, target, command),
    ]);

    expect(duplicate.decision.id).toBe(first.decision.id);
    expect(first.decision.registryVersion).toBe(1);
    expect(first.reprojection.status).toBe("succeeded");
    expect(
      await db.select().from(schema.termResolutionDecision),
    ).toHaveLength(1);
    expect(await db.select().from(schema.termRegistryRevision)).toHaveLength(1);
    expect(await db.select().from(schema.authoredTermProjection)).toHaveLength(
      2,
    );
    expect(
      await db
        .select({ rawText: schema.authoredTerm.rawText })
        .from(schema.authoredTerm)
        .where(eq(schema.authoredTerm.normalizedText, "scallion")),
    ).toEqual(expect.arrayContaining([{ rawText: "SCALLION" }, { rawText: "scallion" }]));

    const reviewedOccurrence = await observeIngredient({
      rawText: "Scallion",
      locale: "en-US",
      resourceId: "recipe-after-review",
    });
    expect(reviewedOccurrence).toMatchObject({
      canonicalSlug: "test-existing-alias",
      key: "test-existing-alias",
    });
    expect(await db.select().from(schema.authoredTermProjection)).toHaveLength(
      3,
    );

    const replayedRun = await runTermReprojection(db, first.decision.id);
    expect(replayedRun).toEqual(first.reprojection);
    expect(await db.select().from(schema.authoredTermProjection)).toHaveLength(
      3,
    );

    const reversed = await resolveAuthoredTerm(db, reviewerId, target, {
      action: "reversal",
      idempotencyKey: "22222222-2222-4222-8222-222222222222",
      rationale: "The regional mapping needs more evidence.",
      evidence: [],
      reversesDecisionId: first.decision.id,
      localeReview: false,
      collisionReview: false,
    });
    expect(reversed.decision.registryVersion).toBe(2);
    expect(await db.select().from(schema.termRegistryEntry)).toEqual([]);
    expect(await db.select().from(schema.authoredTermProjection)).toEqual([]);
    const restoredTerms = await db
      .select({
        resolutionStatus: schema.authoredTerm.resolutionStatus,
        canonicalSlug: schema.authoredTerm.canonicalSlug,
      })
      .from(schema.authoredTerm)
      .where(eq(schema.authoredTerm.normalizedText, "scallion"));
    expect(restoredTerms).toEqual([
      { resolutionStatus: "unresolved", canonicalSlug: null },
      { resolutionStatus: "unresolved", canonicalSlug: null },
    ]);
  });

  it("rejects a stale registry version across different terms", async () => {
    await observeIngredient({ rawText: "First Herb", locale: "en-GB" });
    await observeIngredient({ rawText: "Second Herb", locale: "en-GB" });

    const result = await Promise.allSettled(
      ["first herb", "second herb"].map((normalizedText, index) =>
        resolveAuthoredTerm(
          db,
          reviewerId,
          { kind: "ingredient", normalizedText, locale: "en-GB" },
          {
            action: "alias",
            idempotencyKey: `44444444-4444-4444-8444-${String(index + 1).padStart(12, "0")}`,
            rationale: "Concurrent registry review.",
            evidence: [],
            targetSlug: `canonical-herb-${index + 1}`,
            expectedRegistryVersion: 0,
            localeReview: false,
            collisionReview: false,
          },
        ),
      ),
    );

    expect(result.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const rejected = result.find(({ status }) => status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: expect.any(TermResolutionConflictError),
    });
    expect(await db.select().from(schema.termRegistryRevision)).toHaveLength(1);
  });

  it("supports canonical creation, merge, defer, and reject decisions", async () => {
    for (const rawText of ["Tigernut Flour", "Spring Greens", "Mystery Dust", "Typo Dust"]) {
      await observeIngredient({ rawText, locale: "en-GB" });
    }

    const actions = [
      {
        normalizedText: "tigernut flour",
        command: {
          action: "new_canonical" as const,
          targetSlug: "test-tigernut-flour",
          canonicalName: "Tigernut flour",
        },
        expectedStatus: "resolved",
      },
      {
        normalizedText: "spring greens",
        command: { action: "merge" as const, targetSlug: "test-existing-merge" },
        expectedStatus: "resolved",
      },
      {
        normalizedText: "mystery dust",
        command: { action: "defer" as const },
        expectedStatus: "deferred",
      },
      {
        normalizedText: "typo dust",
        command: { action: "reject" as const },
        expectedStatus: "rejected",
      },
    ];

    for (const [index, item] of actions.entries()) {
      await resolveAuthoredTerm(
        db,
        reviewerId,
        { kind: "ingredient", normalizedText: item.normalizedText, locale: "en-GB" },
        {
          ...item.command,
          idempotencyKey: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
          rationale: `Review ${item.command.action}.`,
          evidence: [],
          localeReview: false,
          collisionReview: false,
        },
      );
      const [term] = await db
        .select({ status: schema.authoredTerm.resolutionStatus })
        .from(schema.authoredTerm)
        .where(eq(schema.authoredTerm.normalizedText, item.normalizedText));
      expect(term?.status).toBe(item.expectedStatus);
    }

    expect(
      await db
        .select({ slug: schema.ingredient.slug, name: schema.ingredient.name })
        .from(schema.ingredient)
      .where(eq(schema.ingredient.slug, "test-tigernut-flour")),
    ).toEqual([{ slug: "test-tigernut-flour", name: "Tigernut flour" }]);
    expect(await db.select().from(schema.termRegistryRevision)).toHaveLength(4);
    expect(await db.select().from(schema.termRegistryEntry)).toHaveLength(2);
  });

  it("requires explicit locale and collision review", async () => {
    await observeIngredient({
      rawText: "Green Onion",
      locale: "und",
      candidateMatches: [
        { slug: "green-onion", score: 0.9 },
        { slug: "spring-onion", score: 0.85 },
      ],
    });
    const target = {
      kind: "ingredient" as const,
      normalizedText: "green onion",
      locale: "und",
    };
    const command = {
      action: "alias" as const,
      idempotencyKey: "33333333-3333-4333-8333-333333333333",
      rationale: "Review ambiguous evidence.",
      evidence: [],
      targetSlug: "test-existing-alias",
      localeReview: false,
      collisionReview: false,
    };

    await expect(
      resolveAuthoredTerm(db, reviewerId, target, command),
    ).rejects.toThrow(TermResolutionConflictError);
    await expect(
      resolveAuthoredTerm(db, reviewerId, target, {
        ...command,
        localeReview: true,
      }),
    ).rejects.toThrow(/collision review/i);
    await expect(
      resolveAuthoredTerm(db, reviewerId, target, {
        ...command,
        localeReview: true,
        collisionReview: true,
      }),
    ).resolves.toMatchObject({
      decision: { action: "alias", targetSlug: "test-existing-alias" },
      reprojection: { status: "succeeded" },
    });
    expect(
      await db
        .select()
        .from(schema.termResolutionDecision)
        .where(
          and(
            eq(schema.termResolutionDecision.localeReview, true),
            eq(schema.termResolutionDecision.collisionReview, true),
          ),
        ),
    ).toHaveLength(1);
  });
});
