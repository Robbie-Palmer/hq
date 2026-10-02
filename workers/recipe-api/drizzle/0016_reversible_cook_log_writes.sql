CREATE TABLE "agent_cook_log_change_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"change_set_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"session_id" uuid NOT NULL,
	"before_value" jsonb,
	"after_value" jsonb,
	"before_version" bigint,
	"after_version" bigint NOT NULL,
	CONSTRAINT "agent_cook_log_change_item_value_check" CHECK (num_nonnulls("agent_cook_log_change_item"."before_value", "agent_cook_log_change_item"."after_value") >= 1)
);
--> statement-breakpoint
ALTER TABLE "cooking_session" ADD COLUMN "diners" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "cooking_session" ADD COLUMN "version" bigint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "cooking_session" ADD COLUMN "created_by_change_set_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_cook_log_change_item" ADD CONSTRAINT "agent_cook_log_change_item_change_set_id_agent_mutation_change_set_id_fk" FOREIGN KEY ("change_set_id") REFERENCES "public"."agent_mutation_change_set"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_cook_log_change_item_ordinal_uidx" ON "agent_cook_log_change_item" USING btree ("change_set_id","ordinal");--> statement-breakpoint
CREATE INDEX "agent_cook_log_change_item_session_idx" ON "agent_cook_log_change_item" USING btree ("session_id");--> statement-breakpoint
ALTER TABLE "cooking_session" ADD CONSTRAINT "cooking_session_created_by_change_set_id_agent_mutation_change_set_id_fk" FOREIGN KEY ("created_by_change_set_id") REFERENCES "public"."agent_mutation_change_set"("id") ON DELETE restrict ON UPDATE no action;
