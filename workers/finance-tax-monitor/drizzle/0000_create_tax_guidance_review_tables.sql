CREATE TABLE "tax_guidance_revision" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"raw_checksum" text NOT NULL,
	"normalized_fingerprint" text NOT NULL,
	"raw_object_key" text NOT NULL,
	"normalized_object_key" text NOT NULL,
	"raw_byte_length" integer NOT NULL,
	"response_etag" text,
	"response_last_modified" text,
	"publication_at" timestamp with time zone NOT NULL,
	"detected_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_guidance_source" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"page_url" text NOT NULL,
	"content_api_url" text NOT NULL,
	"rule_ids" jsonb NOT NULL,
	"effective_periods" jsonb NOT NULL,
	"check_interval_hours" integer NOT NULL,
	"last_successful_check_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_rule_update_review" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"base_revision_id" text,
	"candidate_revision_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"timing" text NOT NULL,
	"affected_rule_ids" jsonb NOT NULL,
	"changes" jsonb NOT NULL,
	"potential_effective_periods" jsonb NOT NULL,
	"publication_date" date NOT NULL,
	"detected_date" date NOT NULL,
	"reviewed_effective_date" date,
	"activation_date" date,
	"active_dataset_version" text NOT NULL,
	"validation_command" text NOT NULL,
	"previous_artifact_must_remain" text NOT NULL,
	"reviewer_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tax_guidance_revision" ADD CONSTRAINT "tax_guidance_revision_source_id_tax_guidance_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."tax_guidance_source"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_rule_update_review" ADD CONSTRAINT "tax_rule_update_review_source_id_tax_guidance_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."tax_guidance_source"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_rule_update_review" ADD CONSTRAINT "tax_rule_update_review_base_revision_id_tax_guidance_revision_id_fk" FOREIGN KEY ("base_revision_id") REFERENCES "public"."tax_guidance_revision"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_rule_update_review" ADD CONSTRAINT "tax_rule_update_review_candidate_revision_id_tax_guidance_revision_id_fk" FOREIGN KEY ("candidate_revision_id") REFERENCES "public"."tax_guidance_revision"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tax_guidance_revision_source_raw_unique" ON "tax_guidance_revision" USING btree ("source_id","raw_checksum");--> statement-breakpoint
CREATE INDEX "tax_guidance_revision_source_detected_idx" ON "tax_guidance_revision" USING btree ("source_id","detected_at");--> statement-breakpoint
CREATE INDEX "tax_guidance_revision_fingerprint_idx" ON "tax_guidance_revision" USING btree ("normalized_fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_rule_update_review_candidate_unique" ON "tax_rule_update_review" USING btree ("candidate_revision_id");--> statement-breakpoint
CREATE INDEX "tax_rule_update_review_status_idx" ON "tax_rule_update_review" USING btree ("status","created_at");
