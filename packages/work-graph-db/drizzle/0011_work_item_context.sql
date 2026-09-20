CREATE TYPE "public"."architecture_decision_role" AS ENUM('governing', 'background');--> statement-breakpoint
CREATE TYPE "public"."work_item_context_kind" AS ENUM('brief', 'acceptance_criteria');--> statement-breakpoint
CREATE TABLE "work_item_architecture_decisions" (
	"work_item_id" text NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"role" "architecture_decision_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_item_architecture_decisions_pk" PRIMARY KEY("work_item_id","url"),
	CONSTRAINT "work_item_architecture_decisions_url_not_blank_check" CHECK (btrim("work_item_architecture_decisions"."url") <> ''),
	CONSTRAINT "work_item_architecture_decisions_title_not_blank_check" CHECK (btrim("work_item_architecture_decisions"."title") <> '')
);
--> statement-breakpoint
CREATE TABLE "work_item_contexts" (
	"work_item_id" text NOT NULL,
	"kind" "work_item_context_kind" NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_item_contexts_pk" PRIMARY KEY("work_item_id","kind"),
	CONSTRAINT "work_item_contexts_content_not_blank_check" CHECK (btrim("work_item_contexts"."content") <> '')
);
--> statement-breakpoint
CREATE TABLE "work_item_references" (
	"work_item_id" text NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_item_references_pk" PRIMARY KEY("work_item_id","url"),
	CONSTRAINT "work_item_references_url_not_blank_check" CHECK (btrim("work_item_references"."url") <> ''),
	CONSTRAINT "work_item_references_title_not_blank_check" CHECK (btrim("work_item_references"."title") <> '')
);
--> statement-breakpoint
ALTER TABLE "work_item_architecture_decisions" ADD CONSTRAINT "work_item_architecture_decisions_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_contexts" ADD CONSTRAINT "work_item_contexts_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_references" ADD CONSTRAINT "work_item_references_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE restrict ON UPDATE no action;
