CREATE TYPE "public"."pull_request_check_summary" AS ENUM('success', 'failure', 'pending', 'neutral', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."pull_request_mergeability" AS ENUM('mergeable', 'conflicting', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."pull_request_review_decision" AS ENUM('approved', 'changes_requested', 'review_required');--> statement-breakpoint
CREATE TYPE "public"."pull_request_role" AS ENUM('implementation', 'evidence', 'related');--> statement-breakpoint
CREATE TYPE "public"."pull_request_state" AS ENUM('open', 'closed', 'merged');--> statement-breakpoint
CREATE TABLE "pull_requests" (
	"repository" text NOT NULL,
	"number" integer NOT NULL,
	"url" text NOT NULL,
	"head_sha" text NOT NULL,
	"state" "pull_request_state" NOT NULL,
	"draft" boolean NOT NULL,
	"mergeability" "pull_request_mergeability" NOT NULL,
	"review_decision" "pull_request_review_decision",
	"check_summary" "pull_request_check_summary" NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pull_requests_pk" PRIMARY KEY("repository","number"),
	CONSTRAINT "pull_requests_repository_not_blank_check" CHECK (btrim("pull_requests"."repository") <> ''),
	CONSTRAINT "pull_requests_number_positive_check" CHECK ("pull_requests"."number" > 0),
	CONSTRAINT "pull_requests_url_not_blank_check" CHECK (btrim("pull_requests"."url") <> ''),
	CONSTRAINT "pull_requests_head_sha_not_blank_check" CHECK (btrim("pull_requests"."head_sha") <> '')
);
--> statement-breakpoint
CREATE TABLE "work_item_pull_requests" (
	"work_item_id" text NOT NULL,
	"repository" text NOT NULL,
	"number" integer NOT NULL,
	"role" "pull_request_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_item_pull_requests_pk" PRIMARY KEY("work_item_id","repository","number")
);
--> statement-breakpoint
ALTER TABLE "work_item_pull_requests" ADD CONSTRAINT "work_item_pull_requests_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_pull_requests" ADD CONSTRAINT "work_item_pull_requests_pull_request_fk" FOREIGN KEY ("repository","number") REFERENCES "public"."pull_requests"("repository","number") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_item_pull_requests_pull_request_idx" ON "work_item_pull_requests" USING btree ("repository","number");