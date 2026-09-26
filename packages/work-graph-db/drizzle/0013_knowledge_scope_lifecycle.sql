CREATE TYPE "public"."knowledge_scope_lifecycle" AS ENUM('active', 'archived');--> statement-breakpoint
ALTER TABLE "knowledge_scopes" ADD COLUMN "lifecycle" "knowledge_scope_lifecycle" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_scopes" ADD COLUMN "archive_reason" text;--> statement-breakpoint
CREATE INDEX "knowledge_scopes_lifecycle_kind_idx" ON "knowledge_scopes" USING btree ("lifecycle","kind");--> statement-breakpoint
ALTER TABLE "knowledge_scopes" ADD CONSTRAINT "knowledge_scopes_archive_reason_check" CHECK (("knowledge_scopes"."lifecycle" = 'active' and "knowledge_scopes"."archive_reason" is null) or ("knowledge_scopes"."lifecycle" = 'archived' and "knowledge_scopes"."archive_reason" is not null and btrim("knowledge_scopes"."archive_reason") <> ''));--> statement-breakpoint
ALTER TABLE "knowledge_scopes" ADD CONSTRAINT "knowledge_scopes_archived_rank_check" CHECK ("knowledge_scopes"."lifecycle" = 'active' or "knowledge_scopes"."rank" is null);
