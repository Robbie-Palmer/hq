CREATE TABLE "household_equipment" (
	"organization_id" text NOT NULL,
	"equipment_slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "household_equipment_pk" PRIMARY KEY("organization_id","equipment_slug")
);
--> statement-breakpoint
ALTER TABLE "household_equipment" ADD CONSTRAINT "household_equipment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "household_equipment_slug_idx" ON "household_equipment" USING btree ("equipment_slug");