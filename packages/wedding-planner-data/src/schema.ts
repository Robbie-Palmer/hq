import { sql } from "drizzle-orm";
import {
  check,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { WeddingPlan } from "wedding-planner-domain";

export const weddingPlan = pgTable(
  "wedding_plan",
  {
    id: uuid().primaryKey().defaultRandom(),
    ownerId: text().notNull(),
    plan: jsonb().$type<WeddingPlan>().notNull(),
    revision: integer().notNull().default(1),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("wedding_plan_owner_uidx").on(table.ownerId),
    check(
      "wedding_plan_owner_not_blank_check",
      sql`btrim(${table.ownerId}) <> ''`,
    ),
    check("wedding_plan_revision_positive_check", sql`${table.revision} > 0`),
  ],
);
