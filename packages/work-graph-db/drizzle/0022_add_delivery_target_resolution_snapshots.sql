CREATE TABLE "delivery_metadata_revisions" (
	"repository" text NOT NULL,
	"source_revision" text NOT NULL,
	"targets" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "delivery_metadata_revisions_pk" PRIMARY KEY("repository","source_revision"),
	CONSTRAINT "delivery_metadata_revisions_repository_check" CHECK ("delivery_metadata_revisions"."repository" = lower("delivery_metadata_revisions"."repository") and "delivery_metadata_revisions"."repository" ~ '^[a-z0-9_.-]+/[a-z0-9_.-]+$'),
	CONSTRAINT "delivery_metadata_revisions_source_revision_not_blank_check" CHECK (btrim("delivery_metadata_revisions"."source_revision") <> ''),
	CONSTRAINT "delivery_metadata_revisions_targets_not_empty_check" CHECK (jsonb_array_length("delivery_metadata_revisions"."targets") > 0)
);
--> statement-breakpoint
CREATE TABLE "work_item_delivery_target_overrides" (
	"work_item_id" text PRIMARY KEY NOT NULL,
	"target_ids" text[] NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "work_item_delivery_target_overrides_targets_not_empty_check" CHECK (cardinality("work_item_delivery_target_overrides"."target_ids") > 0)
);
--> statement-breakpoint
CREATE TABLE "work_item_pull_request_delivery_resolutions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_item_id" text NOT NULL,
	"repository" text NOT NULL,
	"number" integer NOT NULL,
	"head_sha" text NOT NULL,
	"metadata_source_revision" text NOT NULL,
	"changed_paths" text[] NOT NULL,
	"targets" jsonb NOT NULL,
	"subjects" text[] NOT NULL,
	"override_target_ids" text[] NOT NULL,
	"failure_code" text,
	"resolved_at" timestamp with time zone NOT NULL,
	CONSTRAINT "work_item_pull_request_delivery_resolutions_failure_check" CHECK (("work_item_pull_request_delivery_resolutions"."failure_code" is null and jsonb_array_length("work_item_pull_request_delivery_resolutions"."targets") > 0) or ("work_item_pull_request_delivery_resolutions"."failure_code" is not null and jsonb_array_length("work_item_pull_request_delivery_resolutions"."targets") = 0))
);
--> statement-breakpoint
ALTER TABLE "attention_requests" DROP CONSTRAINT "attention_requests_source_check";--> statement-breakpoint
ALTER TABLE "attention_requests" ADD COLUMN "delivery_resolution_id" uuid;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN "changed_paths" text[];--> statement-breakpoint
ALTER TABLE "work_item_delivery_target_overrides" ADD CONSTRAINT "work_item_delivery_target_overrides_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_pull_request_delivery_resolutions" ADD CONSTRAINT "work_item_pull_request_delivery_resolutions_link_fk" FOREIGN KEY ("work_item_id","repository","number") REFERENCES "public"."work_item_pull_requests"("work_item_id","repository","number") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "delivery_metadata_revisions_current_idx" ON "delivery_metadata_revisions" USING btree ("repository","created_at");--> statement-breakpoint
CREATE INDEX "work_item_pull_request_delivery_resolutions_current_idx" ON "work_item_pull_request_delivery_resolutions" USING btree ("work_item_id","repository","number","resolved_at");--> statement-breakpoint
ALTER TABLE "attention_requests" ADD CONSTRAINT "attention_requests_delivery_resolution_id_work_item_pull_request_delivery_resolutions_id_fk" FOREIGN KEY ("delivery_resolution_id") REFERENCES "public"."work_item_pull_request_delivery_resolutions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attention_requests_delivery_resolution_id_uidx" ON "attention_requests" USING btree ("delivery_resolution_id") WHERE "attention_requests"."delivery_resolution_id" is not null;--> statement-breakpoint
ALTER TABLE "attention_requests" ADD CONSTRAINT "attention_requests_source_check" CHECK (num_nonnulls("attention_requests"."requesting_lease_id", "attention_requests"."delivery_recovery_id", "attention_requests"."delivery_resolution_id") = 1);
--> statement-breakpoint
CREATE TRIGGER delivery_metadata_revisions_immutable
BEFORE UPDATE OR DELETE ON "delivery_metadata_revisions"
FOR EACH ROW EXECUTE FUNCTION reject_delivery_evidence_history_mutation();
--> statement-breakpoint
CREATE TRIGGER delivery_metadata_revisions_immutable_truncate
BEFORE TRUNCATE ON "delivery_metadata_revisions"
FOR EACH STATEMENT EXECUTE FUNCTION reject_delivery_evidence_history_mutation();
--> statement-breakpoint
CREATE TRIGGER work_item_pull_request_delivery_resolutions_immutable
BEFORE UPDATE OR DELETE ON "work_item_pull_request_delivery_resolutions"
FOR EACH ROW EXECUTE FUNCTION reject_delivery_evidence_history_mutation();
--> statement-breakpoint
CREATE TRIGGER work_item_pull_request_delivery_resolutions_immutable_truncate
BEFORE TRUNCATE ON "work_item_pull_request_delivery_resolutions"
FOR EACH STATEMENT EXECUTE FUNCTION reject_delivery_evidence_history_mutation();
