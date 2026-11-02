CREATE TABLE "repository_completion_policy_default_revisions" (
	"repository" text NOT NULL,
	"revision" integer NOT NULL,
	"policy_id" text NOT NULL,
	"policy_revision" integer NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "repository_completion_policy_default_revisions_pk" PRIMARY KEY("repository","revision"),
	CONSTRAINT "repository_completion_policy_default_revisions_repository_check" CHECK ("repository_completion_policy_default_revisions"."repository" = lower("repository_completion_policy_default_revisions"."repository") and "repository_completion_policy_default_revisions"."repository" ~ '^[a-z0-9_.-]+/[a-z0-9_.-]+$'),
	CONSTRAINT "repository_completion_policy_default_revisions_revision_positive_check" CHECK ("repository_completion_policy_default_revisions"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "repository_completion_policy_default_revisions" ADD CONSTRAINT "repository_completion_policy_default_revisions_policy_fk" FOREIGN KEY ("policy_id","policy_revision") REFERENCES "public"."completion_policy_revisions"("policy_id","revision") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE TRIGGER repository_completion_policy_default_revisions_immutable
BEFORE UPDATE OR DELETE ON "repository_completion_policy_default_revisions"
FOR EACH ROW EXECUTE FUNCTION reject_delivery_evidence_history_mutation();--> statement-breakpoint
CREATE TRIGGER repository_completion_policy_default_revisions_immutable_truncate
BEFORE TRUNCATE ON "repository_completion_policy_default_revisions"
FOR EACH STATEMENT EXECUTE FUNCTION reject_delivery_evidence_history_mutation();
