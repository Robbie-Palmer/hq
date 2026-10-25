CREATE TABLE "pantry_aggregate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"organization_id" text,
	"revision" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pantry_aggregate_owner_check" CHECK (num_nonnulls("pantry_aggregate"."user_id", "pantry_aggregate"."organization_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "pantry_operation" (
	"aggregate_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"command_fingerprint" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pantry_operation_aggregate_id_operation_id_pk" PRIMARY KEY("aggregate_id","operation_id")
);
--> statement-breakpoint
ALTER TABLE "pantry_item" ADD COLUMN "version" bigint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "pantry_aggregate" ADD CONSTRAINT "pantry_aggregate_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pantry_aggregate" ADD CONSTRAINT "pantry_aggregate_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pantry_operation" ADD CONSTRAINT "pantry_operation_aggregate_id_pantry_aggregate_id_fk" FOREIGN KEY ("aggregate_id") REFERENCES "public"."pantry_aggregate"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pantry_aggregate_user_uidx" ON "pantry_aggregate" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pantry_aggregate_household_uidx" ON "pantry_aggregate" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "pantry_operation_created_at_idx" ON "pantry_operation" USING btree ("created_at");
