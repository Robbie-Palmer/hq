CREATE TYPE "public"."equipment_recipe_match_mode" AS ENUM('hide', 'warn', 'disabled');--> statement-breakpoint
ALTER TABLE "organization" ALTER COLUMN "equipment_recipe_match_mode" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "organization" ALTER COLUMN "equipment_recipe_match_mode" SET DATA TYPE "public"."equipment_recipe_match_mode" USING "equipment_recipe_match_mode"::text::"public"."equipment_recipe_match_mode";--> statement-breakpoint
ALTER TABLE "organization" ALTER COLUMN "equipment_recipe_match_mode" SET DEFAULT 'warn';