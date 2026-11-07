CREATE TYPE "public"."delivery_action_kind" AS ENUM('merge', 'deployment');--> statement-breakpoint
CREATE TYPE "public"."delivery_action_result_state" AS ENUM('success', 'failure', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."delivery_recovery_delivery_kind" AS ENUM('push', 'replacement_launch');--> statement-breakpoint
CREATE TYPE "public"."delivery_recovery_fallback" AS ENUM('request_owner_attention', 'launch_replacement');--> statement-breakpoint
CREATE TABLE "delivery_action_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_item_id" text NOT NULL,
	"kind" "delivery_action_kind" NOT NULL,
	"provider" text NOT NULL,
	"evidence_kind" "delivery_evidence_kind" NOT NULL,
	"evidence_external_id" text NOT NULL,
	"repository" text NOT NULL,
	"commit_sha" text NOT NULL,
	"policy_id" text NOT NULL,
	"policy_revision" integer NOT NULL,
	"initiating_session_id" text,
	"unavailable_session_fallback" "delivery_recovery_fallback" NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	CONSTRAINT "delivery_action_requests_provider_check" CHECK ("delivery_action_requests"."provider" = 'github'),
	CONSTRAINT "delivery_action_requests_kind_evidence_check" CHECK (("delivery_action_requests"."kind" = 'merge' and "delivery_action_requests"."evidence_kind" = 'pull_request') or ("delivery_action_requests"."kind" = 'deployment' and "delivery_action_requests"."evidence_kind" = 'deployment')),
	CONSTRAINT "delivery_action_requests_repository_check" CHECK ("delivery_action_requests"."repository" = lower("delivery_action_requests"."repository") and "delivery_action_requests"."repository" ~ '^[a-z0-9_.-]+/[a-z0-9_.-]+$'),
	CONSTRAINT "delivery_action_requests_commit_sha_check" CHECK ("delivery_action_requests"."commit_sha" ~ '^[0-9a-f]{40}$')
);
--> statement-breakpoint
CREATE TABLE "delivery_action_results" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_id" uuid NOT NULL,
	"evidence_observation_id" uuid NOT NULL,
	"state" "delivery_action_result_state" NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_recoveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_item_id" text NOT NULL,
	"action_request_id" uuid NOT NULL,
	"action_result_id" uuid NOT NULL,
	"initiating_session_id" text,
	"unavailable_session_fallback" "delivery_recovery_fallback" NOT NULL,
	"attention_request_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "delivery_recovery_deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"recovery_id" uuid NOT NULL,
	"kind" "delivery_recovery_delivery_kind" NOT NULL,
	"target_session_id" text,
	"reserved_at" timestamp with time zone NOT NULL,
	CONSTRAINT "delivery_recovery_deliveries_target_check" CHECK (("delivery_recovery_deliveries"."kind" = 'push' and "delivery_recovery_deliveries"."target_session_id" is not null and btrim("delivery_recovery_deliveries"."target_session_id") <> '') or ("delivery_recovery_deliveries"."kind" = 'replacement_launch' and "delivery_recovery_deliveries"."target_session_id" is null))
);
--> statement-breakpoint
ALTER TABLE "attention_requests" ALTER COLUMN "requesting_lease_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "attention_requests" ADD COLUMN "delivery_recovery_id" uuid;--> statement-breakpoint
ALTER TABLE "delivery_action_requests" ADD CONSTRAINT "delivery_action_requests_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_action_requests" ADD CONSTRAINT "delivery_action_requests_policy_revision_fk" FOREIGN KEY ("policy_id","policy_revision") REFERENCES "public"."completion_policy_revisions"("policy_id","revision") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_action_results" ADD CONSTRAINT "delivery_action_results_request_id_delivery_action_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."delivery_action_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_action_results" ADD CONSTRAINT "delivery_action_results_evidence_observation_id_delivery_evidence_observations_id_fk" FOREIGN KEY ("evidence_observation_id") REFERENCES "public"."delivery_evidence_observations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_recoveries" ADD CONSTRAINT "delivery_recoveries_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_recoveries" ADD CONSTRAINT "delivery_recoveries_action_request_id_delivery_action_requests_id_fk" FOREIGN KEY ("action_request_id") REFERENCES "public"."delivery_action_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_recoveries" ADD CONSTRAINT "delivery_recoveries_action_result_id_delivery_action_results_id_fk" FOREIGN KEY ("action_result_id") REFERENCES "public"."delivery_action_results"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_recovery_deliveries" ADD CONSTRAINT "delivery_recovery_deliveries_recovery_id_delivery_recoveries_id_fk" FOREIGN KEY ("recovery_id") REFERENCES "public"."delivery_recoveries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_action_requests_evidence_identity_uidx" ON "delivery_action_requests" USING btree ("provider","evidence_kind","evidence_external_id");--> statement-breakpoint
CREATE INDEX "delivery_action_requests_work_item_id_idx" ON "delivery_action_requests" USING btree ("work_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_action_results_request_observation_uidx" ON "delivery_action_results" USING btree ("request_id","evidence_observation_id");--> statement-breakpoint
CREATE INDEX "delivery_action_results_request_id_idx" ON "delivery_action_results" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_recoveries_action_result_id_uidx" ON "delivery_recoveries" USING btree ("action_result_id");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_recoveries_attention_request_id_uidx" ON "delivery_recoveries" USING btree ("attention_request_id");--> statement-breakpoint
CREATE INDEX "delivery_recoveries_session_unresolved_idx" ON "delivery_recoveries" USING btree ("initiating_session_id","created_at") WHERE "delivery_recoveries"."resolved_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_recovery_deliveries_route_uidx" ON "delivery_recovery_deliveries" USING btree ("recovery_id","kind");--> statement-breakpoint
ALTER TABLE "attention_requests" ADD CONSTRAINT "attention_requests_delivery_recovery_id_delivery_recoveries_id_fk" FOREIGN KEY ("delivery_recovery_id") REFERENCES "public"."delivery_recoveries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attention_requests_delivery_recovery_id_uidx" ON "attention_requests" USING btree ("delivery_recovery_id") WHERE "attention_requests"."delivery_recovery_id" is not null;--> statement-breakpoint
ALTER TABLE "attention_requests" ADD CONSTRAINT "attention_requests_source_check" CHECK (("attention_requests"."requesting_lease_id" is not null) <> ("attention_requests"."delivery_recovery_id" is not null));--> statement-breakpoint
CREATE TRIGGER delivery_action_requests_immutable
BEFORE UPDATE OR DELETE ON delivery_action_requests
FOR EACH ROW EXECUTE FUNCTION reject_delivery_evidence_history_mutation();--> statement-breakpoint
CREATE TRIGGER delivery_action_requests_immutable_truncate
BEFORE TRUNCATE ON delivery_action_requests
FOR EACH STATEMENT EXECUTE FUNCTION reject_delivery_evidence_history_mutation();--> statement-breakpoint
CREATE TRIGGER delivery_action_results_immutable
BEFORE UPDATE OR DELETE ON delivery_action_results
FOR EACH ROW EXECUTE FUNCTION reject_delivery_evidence_history_mutation();--> statement-breakpoint
CREATE TRIGGER delivery_action_results_immutable_truncate
BEFORE TRUNCATE ON delivery_action_results
FOR EACH STATEMENT EXECUTE FUNCTION reject_delivery_evidence_history_mutation();--> statement-breakpoint
CREATE TRIGGER delivery_recovery_deliveries_immutable
BEFORE UPDATE OR DELETE ON delivery_recovery_deliveries
FOR EACH ROW EXECUTE FUNCTION reject_delivery_evidence_history_mutation();--> statement-breakpoint
CREATE TRIGGER delivery_recovery_deliveries_immutable_truncate
BEFORE TRUNCATE ON delivery_recovery_deliveries
FOR EACH STATEMENT EXECUTE FUNCTION reject_delivery_evidence_history_mutation();
