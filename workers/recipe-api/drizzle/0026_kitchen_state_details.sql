CREATE TYPE "public"."pantry_freshness" AS ENUM('fresh', 'use_soon', 'past_best_before', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."pantry_source_kind" AS ENUM('user', 'inferred');--> statement-breakpoint
ALTER TYPE "public"."pantry_location" ADD VALUE 'freezer' BEFORE 'cupboards';--> statement-breakpoint
ALTER TABLE "pantry_item" ADD COLUMN "quantity" numeric(12, 3);--> statement-breakpoint
ALTER TABLE "pantry_item" ADD COLUMN "quantity_unit" text;--> statement-breakpoint
ALTER TABLE "pantry_item" ADD COLUMN "freshness" "pantry_freshness" DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "pantry_item" ADD COLUMN "source_kind" "pantry_source_kind" DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "pantry_item" ADD COLUMN "confidence" numeric(4, 3) DEFAULT '1' NOT NULL;--> statement-breakpoint
ALTER TABLE "pantry_item" ADD COLUMN "provenance" text DEFAULT 'Manual kitchen update' NOT NULL;--> statement-breakpoint
ALTER TABLE "pantry_item" ADD CONSTRAINT "pantry_item_quantity_check" CHECK (("pantry_item"."quantity" IS NULL AND "pantry_item"."quantity_unit" IS NULL) OR ("pantry_item"."quantity" > 0 AND length("pantry_item"."quantity_unit") BETWEEN 1 AND 32));--> statement-breakpoint
ALTER TABLE "pantry_item" ADD CONSTRAINT "pantry_item_confidence_check" CHECK ("pantry_item"."confidence" >= 0 AND "pantry_item"."confidence" <= 1);