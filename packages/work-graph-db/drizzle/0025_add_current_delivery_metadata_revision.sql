CREATE TABLE "repository_current_delivery_metadata_revisions" (
	"repository" text PRIMARY KEY NOT NULL,
	"source_revision" text NOT NULL,
	"selected_at" timestamp with time zone NOT NULL,
	CONSTRAINT "repository_current_delivery_metadata_repository_check" CHECK ("repository_current_delivery_metadata_revisions"."repository" = lower("repository_current_delivery_metadata_revisions"."repository") and "repository_current_delivery_metadata_revisions"."repository" ~ '^[a-z0-9_.-]+/[a-z0-9_.-]+$')
);
--> statement-breakpoint
ALTER TABLE "repository_current_delivery_metadata_revisions" ADD CONSTRAINT "repository_current_delivery_metadata_revision_fk" FOREIGN KEY ("repository","source_revision") REFERENCES "public"."delivery_metadata_revisions"("repository","source_revision") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
INSERT INTO "repository_current_delivery_metadata_revisions" (
	"repository",
	"source_revision",
	"selected_at"
)
SELECT DISTINCT ON ("repository")
	"repository",
	"source_revision",
	"created_at"
FROM "delivery_metadata_revisions"
ORDER BY "repository", "created_at" DESC, "source_revision" DESC;
