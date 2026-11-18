DO $$ BEGIN
	CREATE TYPE "public"."term_reprojection_status" AS ENUM('pending', 'running', 'succeeded', 'failed');
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	CREATE TYPE "public"."term_resolution_action" AS ENUM('alias', 'new_canonical', 'merge', 'defer', 'reject', 'reversal');
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
ALTER TYPE "public"."authored_term_resolution_status" ADD VALUE IF NOT EXISTS 'deferred';--> statement-breakpoint
ALTER TYPE "public"."authored_term_resolution_status" ADD VALUE IF NOT EXISTS 'rejected';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "authored_term_observation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"term_id" uuid NOT NULL,
	"observation_key" text NOT NULL,
	"raw_text" text NOT NULL,
	"locale" text NOT NULL,
	"source_context" jsonb NOT NULL,
	"provenance" jsonb NOT NULL,
	"candidate_matches" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"submission_count" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "authored_term_observation_submission_count_check" CHECK ("authored_term_observation"."submission_count" > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "authored_term_projection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"term_id" uuid NOT NULL,
	"decision_id" uuid NOT NULL,
	"source_key" text NOT NULL,
	"source_context" jsonb NOT NULL,
	"canonical_slug" text NOT NULL,
	"registry_version" bigint NOT NULL,
	"projected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "term_registry_entry" (
	"kind" "authored_term_kind" NOT NULL,
	"normalized_text" text NOT NULL,
	"locale" text NOT NULL,
	"canonical_slug" text NOT NULL,
	"canonical_name" text,
	"registry_version" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "term_registry_entry_pk" PRIMARY KEY("kind","normalized_text","locale")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "term_registry_revision" (
	"version" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "term_registry_revision_version_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"decision_id" uuid NOT NULL,
	"kind" "authored_term_kind" NOT NULL,
	"normalized_text" text NOT NULL,
	"locale" text NOT NULL,
	"action" "term_resolution_action" NOT NULL,
	"canonical_slug" text,
	"canonical_name" text,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "term_reprojection_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"decision_id" uuid NOT NULL,
	"status" "term_reprojection_status" DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"projected_term_count" integer DEFAULT 0 NOT NULL,
	"projected_context_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "term_reprojection_run_attempt_count_check" CHECK ("term_reprojection_run"."attempt_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "term_resolution_decision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"kind" "authored_term_kind" NOT NULL,
	"normalized_text" text NOT NULL,
	"locale" text NOT NULL,
	"action" "term_resolution_action" NOT NULL,
	"target_slug" text,
	"canonical_name" text,
	"rationale" text NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"locale_review" boolean DEFAULT false NOT NULL,
	"collision_review" boolean DEFAULT false NOT NULL,
	"decided_by_user_id" text NOT NULL,
	"reverses_decision_id" uuid,
	"registry_version" bigint,
	"before_state" jsonb NOT NULL,
	"after_state" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "authored_term_observation" ADD CONSTRAINT "authored_term_observation_term_id_authored_term_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."authored_term"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "authored_term_projection" ADD CONSTRAINT "authored_term_projection_term_id_authored_term_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."authored_term"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "authored_term_projection" ADD CONSTRAINT "authored_term_projection_decision_id_term_resolution_decision_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."term_resolution_decision"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "term_registry_entry" ADD CONSTRAINT "term_registry_entry_registry_version_term_registry_revision_version_fk" FOREIGN KEY ("registry_version") REFERENCES "public"."term_registry_revision"("version") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "term_registry_revision" ADD CONSTRAINT "term_registry_revision_decision_id_term_resolution_decision_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."term_resolution_decision"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "term_registry_revision" ADD CONSTRAINT "term_registry_revision_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "term_reprojection_run" ADD CONSTRAINT "term_reprojection_run_decision_id_term_resolution_decision_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."term_resolution_decision"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "term_resolution_decision" ADD CONSTRAINT "term_resolution_decision_decided_by_user_id_user_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "term_resolution_decision" ADD CONSTRAINT "term_resolution_decision_reverses_decision_id_term_resolution_decision_id_fk" FOREIGN KEY ("reverses_decision_id") REFERENCES "public"."term_resolution_decision"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "authored_term_observation_term_key_uidx" ON "authored_term_observation" USING btree ("term_id","observation_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "authored_term_observation_term_time_idx" ON "authored_term_observation" USING btree ("term_id","last_seen_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "authored_term_projection_term_source_uidx" ON "authored_term_projection" USING btree ("term_id","source_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "authored_term_projection_source_idx" ON "authored_term_projection" USING btree ("source_key","canonical_slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "term_registry_entry_canonical_idx" ON "term_registry_entry" USING btree ("kind","canonical_slug");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "term_registry_revision_decision_uidx" ON "term_registry_revision" USING btree ("decision_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "term_registry_revision_term_idx" ON "term_registry_revision" USING btree ("kind","normalized_text","locale");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "term_reprojection_run_decision_uidx" ON "term_reprojection_run" USING btree ("decision_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "term_resolution_decision_idempotency_uidx" ON "term_resolution_decision" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "term_resolution_decision_term_time_idx" ON "term_resolution_decision" USING btree ("kind","normalized_text","locale","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "term_resolution_decision_reversal_idx" ON "term_resolution_decision" USING btree ("reverses_decision_id");--> statement-breakpoint
INSERT INTO "authored_term_observation" (
	"term_id",
	"observation_key",
	"raw_text",
	"locale",
	"source_context",
	"provenance",
	"candidate_matches",
	"submission_count",
	"first_seen_at",
	"last_seen_at"
)
SELECT
	"id",
	replace(replace("locale", '%', '%25'), '|', '%7C') || '|' ||
	replace(replace(coalesce("source_context"->>'flow', ''), '%', '%25'), '|', '%7C') || '|' ||
	replace(replace(coalesce("source_context"->>'resourceId', ''), '%', '%25'), '|', '%7C') || '|' ||
	replace(replace(coalesce("source_context"->>'field', ''), '%', '%25'), '|', '%7C') || '|' ||
	replace(replace(coalesce("provenance"->>'kind', ''), '%', '%25'), '|', '%7C') || '|' ||
	replace(replace(coalesce("provenance"->>'actorUserId', ''), '%', '%25'), '|', '%7C') || '|' ||
	replace(replace(coalesce("provenance"->>'importJobId', ''), '%', '%25'), '|', '%7C'),
	"raw_text",
	"locale",
	"source_context",
	"provenance",
	"candidate_matches",
	"frequency",
	"created_at",
	"last_seen_at"
FROM "authored_term"
ON CONFLICT ("term_id", "observation_key") DO NOTHING;
