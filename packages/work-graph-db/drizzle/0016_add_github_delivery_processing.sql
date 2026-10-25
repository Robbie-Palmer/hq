CREATE TABLE "github_delivery_processing" (
	"delivery_id" text PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'github' NOT NULL,
	"repository" text NOT NULL,
	"commit_sha" text,
	"disposition" text NOT NULL,
	"observation" jsonb,
	"failure_code" text,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "github_delivery_processing_disposition_check" CHECK ("github_delivery_processing"."disposition" in ('processed', 'ignored', 'unmatched', 'failed')),
	CONSTRAINT "github_delivery_processing_provider_check" CHECK ("github_delivery_processing"."provider" = 'github')
);
--> statement-breakpoint
ALTER TABLE "current_delivery_evidence" ADD COLUMN "provider_sequence" bigint;--> statement-breakpoint
ALTER TABLE "github_delivery_processing" ADD CONSTRAINT "github_delivery_processing_delivery_fk" FOREIGN KEY ("provider","delivery_id") REFERENCES "public"."external_deliveries"("provider","external_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "github_delivery_processing_unmatched_idx" ON "github_delivery_processing" USING btree ("repository","disposition","commit_sha");