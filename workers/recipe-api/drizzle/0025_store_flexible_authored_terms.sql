CREATE TYPE "public"."authored_term_kind" AS ENUM('ingredient', 'equipment');--> statement-breakpoint
CREATE TYPE "public"."authored_term_resolution_status" AS ENUM('unresolved', 'resolved');--> statement-breakpoint
CREATE TABLE "authored_term" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"organization_id" text,
	"kind" "authored_term_kind" NOT NULL,
	"raw_text" text NOT NULL,
	"normalized_text" text NOT NULL,
	"locale" text DEFAULT 'und' NOT NULL,
	"source_context" jsonb NOT NULL,
	"provenance" jsonb NOT NULL,
	"candidate_matches" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"frequency" integer DEFAULT 1 NOT NULL,
	"resolution_status" "authored_term_resolution_status" DEFAULT 'unresolved' NOT NULL,
	"canonical_slug" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "authored_term_owner_check" CHECK (num_nonnulls("authored_term"."user_id", "authored_term"."organization_id") = 1),
	CONSTRAINT "authored_term_raw_text_check" CHECK (length("authored_term"."raw_text") > 0),
	CONSTRAINT "authored_term_normalized_text_check" CHECK (length("authored_term"."normalized_text") > 0),
	CONSTRAINT "authored_term_frequency_check" CHECK ("authored_term"."frequency" > 0),
	CONSTRAINT "authored_term_resolution_check" CHECK (("authored_term"."resolution_status" = 'resolved') = ("authored_term"."canonical_slug" is not null))
);
--> statement-breakpoint
ALTER TABLE "pantry_item" DROP CONSTRAINT "pantry_item_ingredient_slug_ingredient_slug_fk";
--> statement-breakpoint
ALTER TABLE "user_diet_excluded_ingredient" DROP CONSTRAINT "user_diet_excluded_ingredient_ingredient_slug_ingredient_slug_fk";
--> statement-breakpoint
ALTER TABLE "authored_term" ADD CONSTRAINT "authored_term_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authored_term" ADD CONSTRAINT "authored_term_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "authored_term_user_kind_normalized_uidx" ON "authored_term" USING btree ("user_id","kind","normalized_text") WHERE "authored_term"."user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "authored_term_household_kind_normalized_uidx" ON "authored_term" USING btree ("organization_id","kind","normalized_text") WHERE "authored_term"."organization_id" is not null;--> statement-breakpoint
CREATE INDEX "authored_term_canonical_slug_idx" ON "authored_term" USING btree ("kind","canonical_slug");
