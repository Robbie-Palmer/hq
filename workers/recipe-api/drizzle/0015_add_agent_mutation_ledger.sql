CREATE TYPE "public"."mutation_actor_type" AS ENUM('agent', 'user');--> statement-breakpoint
CREATE TABLE "agent_mutation_change_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"change_set_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"stable_item_id" uuid NOT NULL,
	"ingredient_slug" text NOT NULL,
	"before_value" jsonb,
	"after_value" jsonb,
	"before_version" bigint,
	"after_version" bigint NOT NULL,
	CONSTRAINT "agent_mutation_change_item_value_check" CHECK (num_nonnulls("agent_mutation_change_item"."before_value", "agent_mutation_change_item"."after_value") >= 1)
);
--> statement-breakpoint
CREATE TABLE "agent_mutation_change_set" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_type" "mutation_actor_type" NOT NULL,
	"actor_user_id" text NOT NULL,
	"actor_agent_id" text,
	"actor_agent_name" text,
	"actor_host_id" text,
	"actor_host_name" text,
	"capability" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"reason" text NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"command_fingerprint" text NOT NULL,
	"compensates_change_set_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_mutation_change_set_actor_check" CHECK (("agent_mutation_change_set"."actor_type" = 'agent' AND num_nonnulls("agent_mutation_change_set"."actor_agent_id", "agent_mutation_change_set"."actor_host_id") = 2) OR ("agent_mutation_change_set"."actor_type" = 'user' AND num_nonnulls("agent_mutation_change_set"."actor_agent_id", "agent_mutation_change_set"."actor_host_id") = 0))
);
--> statement-breakpoint
CREATE TABLE "pantry_item_absence" (
	"aggregate_id" uuid NOT NULL,
	"stable_item_id" uuid NOT NULL,
	"ingredient_slug" text NOT NULL,
	"version" bigint NOT NULL,
	"change_set_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pantry_item_absence_aggregate_id_ingredient_slug_pk" PRIMARY KEY("aggregate_id","ingredient_slug")
);
--> statement-breakpoint
ALTER TABLE "agent_mutation_change_item" ADD CONSTRAINT "agent_mutation_change_item_change_set_id_agent_mutation_change_set_id_fk" FOREIGN KEY ("change_set_id") REFERENCES "public"."agent_mutation_change_set"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_mutation_change_set" ADD CONSTRAINT "agent_mutation_change_set_compensates_change_set_id_agent_mutation_change_set_id_fk" FOREIGN KEY ("compensates_change_set_id") REFERENCES "public"."agent_mutation_change_set"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pantry_item_absence" ADD CONSTRAINT "pantry_item_absence_aggregate_id_pantry_aggregate_id_fk" FOREIGN KEY ("aggregate_id") REFERENCES "public"."pantry_aggregate"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pantry_item_absence" ADD CONSTRAINT "pantry_item_absence_change_set_id_agent_mutation_change_set_id_fk" FOREIGN KEY ("change_set_id") REFERENCES "public"."agent_mutation_change_set"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_mutation_change_item_ordinal_uidx" ON "agent_mutation_change_item" USING btree ("change_set_id","ordinal");--> statement-breakpoint
CREATE INDEX "agent_mutation_change_item_stable_id_idx" ON "agent_mutation_change_item" USING btree ("stable_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_mutation_change_set_idempotency_uidx" ON "agent_mutation_change_set" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "agent_mutation_change_set_user_time_idx" ON "agent_mutation_change_set" USING btree ("actor_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "agent_mutation_change_set_target_time_idx" ON "agent_mutation_change_set" USING btree ("target_type","target_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "agent_mutation_change_set_compensates_idx" ON "agent_mutation_change_set" USING btree ("compensates_change_set_id");--> statement-breakpoint
CREATE INDEX "pantry_item_absence_stable_id_idx" ON "pantry_item_absence" USING btree ("stable_item_id");
