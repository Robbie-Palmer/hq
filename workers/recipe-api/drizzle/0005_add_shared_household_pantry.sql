CREATE TYPE "public"."pantry_location" AS ENUM('fridge', 'cupboards', 'fresh');--> statement-breakpoint
CREATE TABLE "pantry_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"organization_id" text,
	"ingredient_slug" text NOT NULL,
	"location" "pantry_location" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pantry_item_owner_check" CHECK (num_nonnulls("pantry_item"."user_id", "pantry_item"."organization_id") = 1)
);
--> statement-breakpoint
ALTER TABLE "pantry_item" ADD CONSTRAINT "pantry_item_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pantry_item" ADD CONSTRAINT "pantry_item_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pantry_item" ADD CONSTRAINT "pantry_item_ingredient_slug_ingredient_slug_fk" FOREIGN KEY ("ingredient_slug") REFERENCES "public"."ingredient"("slug") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pantry_item_user_ingredient_uidx" ON "pantry_item" USING btree ("user_id","ingredient_slug");--> statement-breakpoint
CREATE UNIQUE INDEX "pantry_item_household_ingredient_uidx" ON "pantry_item" USING btree ("organization_id","ingredient_slug");--> statement-breakpoint
CREATE INDEX "pantry_item_ingredient_slug_idx" ON "pantry_item" USING btree ("ingredient_slug");
