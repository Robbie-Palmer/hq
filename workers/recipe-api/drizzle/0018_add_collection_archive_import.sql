CREATE TABLE "recipe_import_archive_entry" (
	"job_id" uuid PRIMARY KEY NOT NULL,
	"archive_name" text NOT NULL,
	"archive_checksum" text NOT NULL,
	"entry_path" text NOT NULL,
	"content_checksum" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recipe" ADD COLUMN "parent_recipe_id" uuid;--> statement-breakpoint
ALTER TABLE "recipe_import_batch" ADD COLUMN "duplicate_policy" text DEFAULT 'skip' NOT NULL;--> statement-breakpoint
ALTER TABLE "recipe_import_batch" ADD COLUMN "undo_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "recipe_import_batch" ADD COLUMN "undo_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "recipe_import_job" ADD COLUMN "accepted_recipe_snapshot_id" uuid;--> statement-breakpoint
ALTER TABLE "recipe_import_job" ADD COLUMN "accepted_recipe_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "recipe_import_job" ADD COLUMN "undo_outcome" text;--> statement-breakpoint
ALTER TABLE "recipe_import_job" ADD COLUMN "undo_message" text;--> statement-breakpoint
ALTER TABLE "recipe_import_archive_entry" ADD CONSTRAINT "recipe_import_archive_entry_job_id_recipe_import_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."recipe_import_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recipe_import_archive_entry_content_idx" ON "recipe_import_archive_entry" USING btree ("content_checksum");--> statement-breakpoint
ALTER TABLE "recipe" ADD CONSTRAINT "recipe_parent_recipe_id_recipe_id_fk" FOREIGN KEY ("parent_recipe_id") REFERENCES "public"."recipe"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recipe_parent_recipe_idx" ON "recipe" USING btree ("parent_recipe_id");