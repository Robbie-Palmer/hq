CREATE TYPE "public"."recipe_import_draft_kind" AS ENUM('generated', 'editable');--> statement-breakpoint
CREATE TABLE "recipe_import_batch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"started_at" timestamp with time zone,
	"visibility" "visibility" DEFAULT 'private' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipe_import_draft" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"kind" "recipe_import_draft_kind" NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"servings" integer NOT NULL,
	"prep_time" integer,
	"cook_time" integer,
	"source" text NOT NULL,
	"source_url" text,
	"visibility" "visibility",
	CONSTRAINT "recipe_import_draft_servings_positive" CHECK ("recipe_import_draft"."servings" > 0),
	CONSTRAINT "recipe_import_draft_prep_time_nonnegative" CHECK ("recipe_import_draft"."prep_time" >= 0),
	CONSTRAINT "recipe_import_draft_cook_time_nonnegative" CHECK ("recipe_import_draft"."cook_time" >= 0)
);
--> statement-breakpoint
CREATE TABLE "recipe_import_draft_cuisine" (
	"draft_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"label" text NOT NULL,
	CONSTRAINT "recipe_import_draft_cuisine_draft_id_position_pk" PRIMARY KEY("draft_id","position"),
	CONSTRAINT "recipe_import_draft_cuisine_position_nonnegative" CHECK ("recipe_import_draft_cuisine"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "recipe_import_review_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"action" text NOT NULL,
	"draft_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recipe_import_job" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
ALTER TABLE "recipe_import_job" ADD COLUMN "position" integer;--> statement-breakpoint
ALTER TABLE "recipe_import_job" ADD COLUMN "source_type" text DEFAULT 'photo' NOT NULL;--> statement-breakpoint
ALTER TABLE "recipe_import_job" ADD COLUMN "source_label" text;--> statement-breakpoint
ALTER TABLE "recipe_import_job" ADD COLUMN "source_checksum" text;--> statement-breakpoint
ALTER TABLE "recipe_import_job" ADD COLUMN "review_state" text DEFAULT 'waiting' NOT NULL;--> statement-breakpoint
ALTER TABLE "recipe_import_job" ADD COLUMN "draft_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "recipe_import_job" ADD COLUMN "execution_attempt" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "recipe_import_job" ADD COLUMN "accepted_recipe_id" uuid;--> statement-breakpoint
ALTER TABLE "recipe_import_job" ADD COLUMN "accept_key" uuid;--> statement-breakpoint
ALTER TABLE "recipe_import_job" ADD COLUMN "accept_fingerprint" text;--> statement-breakpoint
ALTER TABLE "recipe_import_job" ADD COLUMN "accepted_version" integer;--> statement-breakpoint
ALTER TABLE "recipe_import_batch" ADD CONSTRAINT "recipe_import_batch_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_import_draft" ADD CONSTRAINT "recipe_import_draft_job_id_recipe_import_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."recipe_import_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_import_draft_cuisine" ADD CONSTRAINT "recipe_import_draft_cuisine_draft_id_recipe_import_draft_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."recipe_import_draft"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_import_review_event" ADD CONSTRAINT "recipe_import_review_event_job_id_recipe_import_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."recipe_import_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "recipe_import_batch_owner_key_unique" ON "recipe_import_batch" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "recipe_import_draft_job_kind_unique" ON "recipe_import_draft" USING btree ("job_id","kind");--> statement-breakpoint
CREATE INDEX "recipe_import_review_event_job_idx" ON "recipe_import_review_event" USING btree ("job_id");--> statement-breakpoint
ALTER TABLE "recipe_import_job" ADD CONSTRAINT "recipe_import_job_batch_id_recipe_import_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."recipe_import_batch"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_import_job" ADD CONSTRAINT "recipe_import_job_accepted_recipe_id_recipe_id_fk" FOREIGN KEY ("accepted_recipe_id") REFERENCES "public"."recipe"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "recipe_import_job_batch_position_unique" ON "recipe_import_job" USING btree ("batch_id","position");