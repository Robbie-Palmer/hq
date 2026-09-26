CREATE TYPE "public"."delivery_evidence_kind" AS ENUM('pull_request', 'ci', 'deployment');--> statement-breakpoint
CREATE TYPE "public"."delivery_evidence_state" AS ENUM('pending', 'success', 'failure', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."evidence_correlation_kind" AS ENUM('unmatched', 'pull_request_head', 'pull_request_merge');--> statement-breakpoint
CREATE TABLE "completion_candidate_evaluations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_item_id" text NOT NULL,
	"policy_id" text NOT NULL,
	"policy_revision" integer NOT NULL,
	"candidate" boolean NOT NULL,
	"reasons" jsonb NOT NULL,
	"evidence_observation_ids" uuid[] NOT NULL,
	"evaluated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "completion_policy_revisions" (
	"policy_id" text NOT NULL,
	"revision" integer NOT NULL,
	"required_ci_names" text[] NOT NULL,
	"production_environments" text[] NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "completion_policy_revisions_pk" PRIMARY KEY("policy_id","revision"),
	CONSTRAINT "completion_policy_revisions_revision_positive_check" CHECK ("completion_policy_revisions"."revision" > 0),
	CONSTRAINT "completion_policy_revisions_ci_not_empty_check" CHECK (cardinality("completion_policy_revisions"."required_ci_names") > 0),
	CONSTRAINT "completion_policy_revisions_environments_not_empty_check" CHECK (cardinality("completion_policy_revisions"."production_environments") > 0)
);
--> statement-breakpoint
CREATE TABLE "current_delivery_evidence" (
	"provider" text NOT NULL,
	"kind" "delivery_evidence_kind" NOT NULL,
	"external_id" text NOT NULL,
	"observation_id" uuid NOT NULL,
	"provider_observed_at" timestamp with time zone NOT NULL,
	"projected_at" timestamp with time zone NOT NULL,
	CONSTRAINT "current_delivery_evidence_pk" PRIMARY KEY("provider","kind","external_id")
);
--> statement-breakpoint
CREATE TABLE "delivery_evidence_observations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"delivery_provider" text NOT NULL,
	"delivery_external_id" text NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"repository" text NOT NULL,
	"commit_sha" text NOT NULL,
	"kind" "delivery_evidence_kind" NOT NULL,
	"state" "delivery_evidence_state" NOT NULL,
	"name" text,
	"environment" text,
	"source_url" text NOT NULL,
	"provider_observed_at" timestamp with time zone NOT NULL,
	"ingested_at" timestamp with time zone NOT NULL,
	"correlation_kind" "evidence_correlation_kind" NOT NULL,
	"pull_request_repository" text,
	"pull_request_number" integer,
	CONSTRAINT "delivery_evidence_observations_correlation_check" CHECK (("delivery_evidence_observations"."correlation_kind" = 'unmatched' and "delivery_evidence_observations"."pull_request_repository" is null and "delivery_evidence_observations"."pull_request_number" is null) or ("delivery_evidence_observations"."correlation_kind" <> 'unmatched' and "delivery_evidence_observations"."pull_request_repository" is not null and "delivery_evidence_observations"."pull_request_number" is not null and "delivery_evidence_observations"."pull_request_number" > 0))
);
--> statement-breakpoint
CREATE TABLE "external_deliveries" (
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"payload_digest" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"ingested_at" timestamp with time zone NOT NULL,
	CONSTRAINT "external_deliveries_pk" PRIMARY KEY("provider","external_id"),
	CONSTRAINT "external_deliveries_provider_not_blank_check" CHECK (btrim("external_deliveries"."provider") <> ''),
	CONSTRAINT "external_deliveries_external_id_not_blank_check" CHECK (btrim("external_deliveries"."external_id") <> ''),
	CONSTRAINT "external_deliveries_payload_digest_check" CHECK ("external_deliveries"."payload_digest" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "work_item_completion_candidates" (
	"work_item_id" text PRIMARY KEY NOT NULL,
	"evaluation_id" uuid NOT NULL,
	"projected_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_item_completion_policies" (
	"work_item_id" text PRIMARY KEY NOT NULL,
	"policy_id" text NOT NULL,
	"policy_revision" integer NOT NULL,
	"assigned_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN "accepted_head_sha" text;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN "merge_commit_sha" text;--> statement-breakpoint
ALTER TABLE "completion_candidate_evaluations" ADD CONSTRAINT "completion_candidate_evaluations_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "completion_candidate_evaluations" ADD CONSTRAINT "completion_candidate_evaluations_policy_revision_fk" FOREIGN KEY ("policy_id","policy_revision") REFERENCES "public"."completion_policy_revisions"("policy_id","revision") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "current_delivery_evidence" ADD CONSTRAINT "current_delivery_evidence_observation_id_delivery_evidence_observations_id_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."delivery_evidence_observations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_evidence_observations" ADD CONSTRAINT "delivery_evidence_observations_delivery_fk" FOREIGN KEY ("delivery_provider","delivery_external_id") REFERENCES "public"."external_deliveries"("provider","external_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_completion_candidates" ADD CONSTRAINT "work_item_completion_candidates_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "completion_candidate_evaluations_id_work_item_uidx" ON "completion_candidate_evaluations" USING btree ("id","work_item_id");--> statement-breakpoint
ALTER TABLE "work_item_completion_candidates" ADD CONSTRAINT "work_item_completion_candidates_evaluation_fk" FOREIGN KEY ("evaluation_id","work_item_id") REFERENCES "public"."completion_candidate_evaluations"("id","work_item_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_completion_policies" ADD CONSTRAINT "work_item_completion_policies_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_completion_policies" ADD CONSTRAINT "work_item_completion_policies_revision_fk" FOREIGN KEY ("policy_id","policy_revision") REFERENCES "public"."completion_policy_revisions"("policy_id","revision") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "completion_candidate_evaluations_work_item_idx" ON "completion_candidate_evaluations" USING btree ("work_item_id","evaluated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "current_delivery_evidence_observation_id_uidx" ON "current_delivery_evidence" USING btree ("observation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_evidence_observations_external_identity_uidx" ON "delivery_evidence_observations" USING btree ("provider","kind","external_id","provider_observed_at","state");--> statement-breakpoint
CREATE INDEX "delivery_evidence_observations_commit_idx" ON "delivery_evidence_observations" USING btree ("repository","commit_sha");--> statement-breakpoint
CREATE UNIQUE INDEX "work_item_completion_candidates_evaluation_id_uidx" ON "work_item_completion_candidates" USING btree ("evaluation_id");--> statement-breakpoint
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_accepted_head_sha_not_blank_check" CHECK ("pull_requests"."accepted_head_sha" is null or btrim("pull_requests"."accepted_head_sha") <> '');--> statement-breakpoint
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_merge_commit_sha_not_blank_check" CHECK ("pull_requests"."merge_commit_sha" is null or btrim("pull_requests"."merge_commit_sha") <> '');--> statement-breakpoint
CREATE FUNCTION reject_delivery_evidence_history_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION USING
		ERRCODE = '55000',
		MESSAGE = TG_TABLE_NAME || ' is immutable';
END;
$$;--> statement-breakpoint
CREATE TRIGGER external_deliveries_immutable
BEFORE UPDATE OR DELETE ON "external_deliveries"
FOR EACH ROW EXECUTE FUNCTION reject_delivery_evidence_history_mutation();--> statement-breakpoint
CREATE TRIGGER external_deliveries_immutable_truncate
BEFORE TRUNCATE ON "external_deliveries"
FOR EACH STATEMENT EXECUTE FUNCTION reject_delivery_evidence_history_mutation();--> statement-breakpoint
CREATE TRIGGER delivery_evidence_observations_immutable
BEFORE UPDATE OR DELETE ON "delivery_evidence_observations"
FOR EACH ROW EXECUTE FUNCTION reject_delivery_evidence_history_mutation();--> statement-breakpoint
CREATE TRIGGER delivery_evidence_observations_immutable_truncate
BEFORE TRUNCATE ON "delivery_evidence_observations"
FOR EACH STATEMENT EXECUTE FUNCTION reject_delivery_evidence_history_mutation();--> statement-breakpoint
CREATE TRIGGER completion_policy_revisions_immutable
BEFORE UPDATE OR DELETE ON "completion_policy_revisions"
FOR EACH ROW EXECUTE FUNCTION reject_delivery_evidence_history_mutation();--> statement-breakpoint
CREATE TRIGGER completion_policy_revisions_immutable_truncate
BEFORE TRUNCATE ON "completion_policy_revisions"
FOR EACH STATEMENT EXECUTE FUNCTION reject_delivery_evidence_history_mutation();--> statement-breakpoint
CREATE TRIGGER completion_candidate_evaluations_immutable
BEFORE UPDATE OR DELETE ON "completion_candidate_evaluations"
FOR EACH ROW EXECUTE FUNCTION reject_delivery_evidence_history_mutation();--> statement-breakpoint
CREATE TRIGGER completion_candidate_evaluations_immutable_truncate
BEFORE TRUNCATE ON "completion_candidate_evaluations"
FOR EACH STATEMENT EXECUTE FUNCTION reject_delivery_evidence_history_mutation();
