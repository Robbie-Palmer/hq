CREATE TABLE "work_item_priority_contexts" (
	"work_item_id" text PRIMARY KEY NOT NULL,
	"scheduling_initiative_id" text,
	"scheduling_project_id" text,
	"rank" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_item_priority_contexts_rank_positive_check" CHECK ("work_item_priority_contexts"."rank" is null or "work_item_priority_contexts"."rank" > 0)
);
--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN "expedited" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN "expedite_reason" text;--> statement-breakpoint
ALTER TABLE "work_item_priority_contexts" ADD CONSTRAINT "work_item_priority_contexts_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_priority_contexts" ADD CONSTRAINT "work_item_priority_contexts_scheduling_initiative_id_knowledge_scopes_id_fk" FOREIGN KEY ("scheduling_initiative_id") REFERENCES "public"."knowledge_scopes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_priority_contexts" ADD CONSTRAINT "work_item_priority_contexts_scheduling_project_id_knowledge_scopes_id_fk" FOREIGN KEY ("scheduling_project_id") REFERENCES "public"."knowledge_scopes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
INSERT INTO "work_item_priority_contexts" ("work_item_id", "rank")
SELECT "work_items"."id", row_number() OVER (ORDER BY "work_items"."created_at", "work_items"."id") * 1024
FROM "work_items"
LEFT JOIN "work_item_hierarchy" ON "work_item_hierarchy"."child_work_item_id" = "work_items"."id"
WHERE "work_item_hierarchy"."child_work_item_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "work_item_priority_contexts_project_rank_uidx" ON "work_item_priority_contexts" USING btree ("scheduling_project_id","rank") WHERE "work_item_priority_contexts"."scheduling_project_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "work_item_priority_contexts_unscoped_rank_uidx" ON "work_item_priority_contexts" USING btree ("rank") WHERE "work_item_priority_contexts"."scheduling_project_id" is null;--> statement-breakpoint
CREATE INDEX "work_item_priority_contexts_initiative_id_idx" ON "work_item_priority_contexts" USING btree ("scheduling_initiative_id");--> statement-breakpoint
WITH "ranked_scopes" AS (
	SELECT "id", row_number() OVER (PARTITION BY "kind" ORDER BY "rank" NULLS LAST, "id") * 1024 AS "new_rank"
	FROM "knowledge_scopes"
)
UPDATE "knowledge_scopes"
SET "rank" = "ranked_scopes"."new_rank"
FROM "ranked_scopes"
WHERE "knowledge_scopes"."id" = "ranked_scopes"."id";--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_scopes_kind_rank_uidx" ON "knowledge_scopes" USING btree ("kind","rank") WHERE "knowledge_scopes"."rank" is not null;--> statement-breakpoint
ALTER TABLE "knowledge_scopes" DROP COLUMN "priority_weight";--> statement-breakpoint
ALTER TABLE "work_items" DROP COLUMN "priority_weight";--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_expedite_reason_check" CHECK ("work_items"."expedited" = ("work_items"."expedite_reason" is not null and btrim("work_items"."expedite_reason") <> ''));
