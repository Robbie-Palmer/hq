CREATE TABLE "household_canary_record" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"classification" text DEFAULT 'synthetic-only' NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "household_canary_record_owner_user_id_idx" ON "household_canary_record" USING btree ("owner_user_id");