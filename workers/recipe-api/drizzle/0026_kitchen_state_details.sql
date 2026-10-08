CREATE TYPE "public"."pantry_source_kind" AS ENUM('user', 'inferred');--> statement-breakpoint
ALTER TYPE "public"."pantry_location" ADD VALUE 'freezer' BEFORE 'cupboards';--> statement-breakpoint
ALTER TABLE "pantry_item" ADD COLUMN "quantity" numeric(12, 3);--> statement-breakpoint
ALTER TABLE "pantry_item" ADD COLUMN "quantity_unit" text;--> statement-breakpoint
ALTER TABLE "pantry_item" ADD COLUMN "use_by" date;--> statement-breakpoint
ALTER TABLE "pantry_item" ADD COLUMN "best_before" date;--> statement-breakpoint
ALTER TABLE "pantry_item" ADD COLUMN "stocked_at" date;--> statement-breakpoint
ALTER TABLE "pantry_item" ADD COLUMN "opened_at" date;--> statement-breakpoint
ALTER TABLE "pantry_item" ADD COLUMN "frozen_at" date;--> statement-breakpoint
ALTER TABLE "pantry_item" ADD COLUMN "freshness_estimate" jsonb;--> statement-breakpoint
ALTER TABLE "pantry_item" ADD COLUMN "source_kind" "pantry_source_kind" DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "pantry_item" ADD COLUMN "provenance" text DEFAULT 'Manual kitchen update' NOT NULL;--> statement-breakpoint
ALTER TABLE "pantry_item" ADD CONSTRAINT "pantry_item_quantity_check" CHECK (("pantry_item"."quantity" IS NULL AND "pantry_item"."quantity_unit" IS NULL) OR ("pantry_item"."quantity" > 0 AND "pantry_item"."quantity_unit" IS NOT NULL));
