CREATE TYPE "public"."leftover_storage_location" AS ENUM('fridge', 'freezer');--> statement-breakpoint
CREATE TABLE "leftover_batch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cooking_session_id" uuid NOT NULL,
	"user_id" text,
	"organization_id" text,
	"recipe_slug" text NOT NULL,
	"recipe_title" text NOT NULL,
	"recipe_version" text NOT NULL,
	"portions_remaining" integer NOT NULL,
	"storage" "leftover_storage_location" NOT NULL,
	"use_by" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leftover_batch_cookingSessionId_unique" UNIQUE("cooking_session_id"),
	CONSTRAINT "leftover_batch_owner_check" CHECK (num_nonnulls("leftover_batch"."user_id", "leftover_batch"."organization_id") = 1),
	CONSTRAINT "leftover_batch_portions_check" CHECK ("leftover_batch"."portions_remaining" > 0)
);
--> statement-breakpoint
ALTER TABLE "cooking_session" ADD COLUMN "recipe_version" text;--> statement-breakpoint
ALTER TABLE "cooking_session" ADD COLUMN "repeat_of_session_id" uuid;--> statement-breakpoint
ALTER TABLE "leftover_batch" ADD CONSTRAINT "leftover_batch_cooking_session_id_cooking_session_id_fk" FOREIGN KEY ("cooking_session_id") REFERENCES "public"."cooking_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leftover_batch" ADD CONSTRAINT "leftover_batch_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leftover_batch" ADD CONSTRAINT "leftover_batch_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leftover_batch_user_use_by_idx" ON "leftover_batch" USING btree ("user_id","use_by");--> statement-breakpoint
CREATE INDEX "leftover_batch_household_use_by_idx" ON "leftover_batch" USING btree ("organization_id","use_by");--> statement-breakpoint
ALTER TABLE "cooking_session" ADD CONSTRAINT "cooking_session_repeat_of_session_id_cooking_session_id_fk" FOREIGN KEY ("repeat_of_session_id") REFERENCES "public"."cooking_session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cooking_session" DROP COLUMN "diners";
