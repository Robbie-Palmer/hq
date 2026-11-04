CREATE TABLE "wedding_plan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"plan" jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wedding_plan_owner_not_blank_check" CHECK (btrim("wedding_plan"."owner_id") <> ''),
	CONSTRAINT "wedding_plan_revision_positive_check" CHECK ("wedding_plan"."revision" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "wedding_plan_owner_uidx" ON "wedding_plan" USING btree ("owner_id");