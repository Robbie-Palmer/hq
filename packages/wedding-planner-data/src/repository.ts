import { and, eq, sql } from "drizzle-orm";
import {
  parseWeddingPlan,
  type WeddingPlan,
} from "wedding-planner-domain";
import type { WeddingPlannerDb } from "./connection";
import { weddingPlan } from "./schema";

export interface StoredWeddingPlan {
  readonly id: string;
  readonly plan: WeddingPlan;
  readonly revision: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export class WeddingPlanAlreadyExistsError extends Error {
  readonly ownerId: string;

  constructor(ownerId: string) {
    super("A wedding plan already exists for this owner");
    this.name = "WeddingPlanAlreadyExistsError";
    this.ownerId = ownerId;
  }
}

export class WeddingPlanNotFoundError extends Error {
  readonly ownerId: string;

  constructor(ownerId: string) {
    super("The wedding plan does not exist");
    this.name = "WeddingPlanNotFoundError";
    this.ownerId = ownerId;
  }
}

export class WeddingPlanConflictError extends Error {
  readonly actualRevision: number;
  readonly expectedRevision: number;
  readonly ownerId: string;

  constructor(ownerId: string, expectedRevision: number, actualRevision: number) {
    super("The wedding plan changed since it was loaded");
    this.name = "WeddingPlanConflictError";
    this.ownerId = ownerId;
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

function assertOwnerId(ownerId: string): void {
  if (ownerId.trim().length === 0) throw new Error("Owner ID is required");
}

function assertRevision(revision: number): void {
  if (!Number.isSafeInteger(revision) || revision < 1)
    throw new Error("Expected revision must be a positive integer");
}

function storedPlan(row: typeof weddingPlan.$inferSelect): StoredWeddingPlan {
  return {
    id: row.id,
    plan: parseWeddingPlan(row.plan),
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createWeddingPlanRepository(db: WeddingPlannerDb) {
  return {
    async load(ownerId: string): Promise<StoredWeddingPlan | null> {
      assertOwnerId(ownerId);
      const [row] = await db
        .select()
        .from(weddingPlan)
        .where(eq(weddingPlan.ownerId, ownerId))
        .limit(1);
      return row ? storedPlan(row) : null;
    },

    async create(ownerId: string, plan: WeddingPlan): Promise<StoredWeddingPlan> {
      assertOwnerId(ownerId);
      const validated = parseWeddingPlan(plan);
      const [created] = await db
        .insert(weddingPlan)
        .values({ ownerId, plan: validated })
        .onConflictDoNothing({ target: weddingPlan.ownerId })
        .returning();
      if (!created) throw new WeddingPlanAlreadyExistsError(ownerId);
      return storedPlan(created);
    },

    async update(
      ownerId: string,
      expectedRevision: number,
      plan: WeddingPlan,
    ): Promise<StoredWeddingPlan> {
      assertOwnerId(ownerId);
      assertRevision(expectedRevision);
      const validated = parseWeddingPlan(plan);
      const [updated] = await db
        .update(weddingPlan)
        .set({
          plan: validated,
          revision: sql`${weddingPlan.revision} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(weddingPlan.ownerId, ownerId),
            eq(weddingPlan.revision, expectedRevision),
          ),
        )
        .returning();
      if (updated) return storedPlan(updated);

      const [current] = await db
        .select({ revision: weddingPlan.revision })
        .from(weddingPlan)
        .where(eq(weddingPlan.ownerId, ownerId))
        .limit(1);
      if (!current) throw new WeddingPlanNotFoundError(ownerId);
      throw new WeddingPlanConflictError(
        ownerId,
        expectedRevision,
        current.revision,
      );
    },
  };
}

export type WeddingPlanStore = ReturnType<typeof createWeddingPlanRepository>;
