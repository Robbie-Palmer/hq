import {
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { SourceChange } from "finance-tax-rules/gov-uk-monitor";

type EffectivePeriod = { from: string; to: string };

export const taxGuidanceSource = pgTable("tax_guidance_source", {
  id: text().primaryKey(),
  title: text().notNull(),
  pageUrl: text().notNull(),
  contentApiUrl: text().notNull(),
  ruleIds: jsonb().$type<string[]>().notNull(),
  effectivePeriods: jsonb().$type<EffectivePeriod[]>().notNull(),
  checkIntervalHours: integer().notNull(),
  lastSuccessfulCheckAt: timestamp({ withTimezone: true }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const taxGuidanceRevision = pgTable(
  "tax_guidance_revision",
  {
    id: text().primaryKey(),
    sourceId: text()
      .notNull()
      .references(() => taxGuidanceSource.id, { onDelete: "restrict" }),
    rawChecksum: text().notNull(),
    normalizedFingerprint: text().notNull(),
    rawObjectKey: text().notNull(),
    normalizedObjectKey: text().notNull(),
    rawByteLength: integer().notNull(),
    responseEtag: text(),
    responseLastModified: text(),
    publicationAt: timestamp({ withTimezone: true }).notNull(),
    detectedAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("tax_guidance_revision_source_raw_unique").on(
      table.sourceId,
      table.rawChecksum,
    ),
    index("tax_guidance_revision_source_detected_idx").on(
      table.sourceId,
      table.detectedAt,
    ),
    index("tax_guidance_revision_fingerprint_idx").on(
      table.normalizedFingerprint,
    ),
  ],
);

export const taxRuleUpdateReview = pgTable(
  "tax_rule_update_review",
  {
    id: text().primaryKey(),
    sourceId: text()
      .notNull()
      .references(() => taxGuidanceSource.id, { onDelete: "restrict" }),
    baseRevisionId: text().references(() => taxGuidanceRevision.id, {
      onDelete: "restrict",
    }),
    candidateRevisionId: text()
      .notNull()
      .references(() => taxGuidanceRevision.id, { onDelete: "restrict" }),
    kind: text().notNull(),
    status: text().notNull().default("pending"),
    timing: text().notNull(),
    affectedRuleIds: jsonb().$type<string[]>().notNull(),
    changes: jsonb().$type<SourceChange[]>().notNull(),
    potentialEffectivePeriods: jsonb().$type<EffectivePeriod[]>().notNull(),
    publicationDate: date().notNull(),
    detectedDate: date().notNull(),
    reviewedEffectiveDate: date(),
    activationDate: date(),
    activeDatasetVersion: text().notNull(),
    validationCommand: text().notNull(),
    previousArtifactMustRemain: text().notNull(),
    reviewerNotes: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("tax_rule_update_review_candidate_unique").on(
      table.candidateRevisionId,
    ),
    index("tax_rule_update_review_status_idx").on(table.status, table.createdAt),
  ],
);
