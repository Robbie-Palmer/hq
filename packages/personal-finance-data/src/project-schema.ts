import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// This synthetic-only table proves the generated household authorization seam.
// Product financial records belong to the runtime provisioning ticket.
export const householdCanaryRecord = pgTable(
  "household_canary_record",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id").notNull(),
    classification: text("classification").notNull().default("synthetic-only"),
    label: text("label").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("household_canary_record_owner_user_id_idx").on(table.ownerUserId),
  ],
);
