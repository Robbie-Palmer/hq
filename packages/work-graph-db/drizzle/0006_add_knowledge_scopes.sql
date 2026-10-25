CREATE TYPE "public"."knowledge_scope_kind" AS ENUM('initiative', 'project');--> statement-breakpoint
CREATE TABLE "knowledge_scopes" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" "knowledge_scope_kind" NOT NULL,
	"title" text NOT NULL,
	"canonical_url" text NOT NULL,
	"markdown_url" text NOT NULL,
	"source_revision" text,
	"rank" integer,
	"priority_weight" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_scopes_id_not_blank_check" CHECK (btrim("knowledge_scopes"."id") <> ''),
	CONSTRAINT "knowledge_scopes_title_not_blank_check" CHECK (btrim("knowledge_scopes"."title") <> ''),
	CONSTRAINT "knowledge_scopes_source_revision_not_blank_check" CHECK ("knowledge_scopes"."source_revision" is null or btrim("knowledge_scopes"."source_revision") <> ''),
	CONSTRAINT "knowledge_scopes_rank_positive_check" CHECK ("knowledge_scopes"."rank" is null or "knowledge_scopes"."rank" > 0)
);
--> statement-breakpoint
CREATE TABLE "knowledge_scope_relationships" (
	"parent_knowledge_scope_id" text NOT NULL,
	"child_knowledge_scope_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_scope_relationships_pk" PRIMARY KEY("parent_knowledge_scope_id","child_knowledge_scope_id"),
	CONSTRAINT "knowledge_scope_relationships_not_self_check" CHECK ("knowledge_scope_relationships"."parent_knowledge_scope_id" <> "knowledge_scope_relationships"."child_knowledge_scope_id")
);
--> statement-breakpoint
ALTER TABLE "knowledge_scope_relationships" ADD CONSTRAINT "knowledge_scope_relationships_parent_fk" FOREIGN KEY ("parent_knowledge_scope_id") REFERENCES "public"."knowledge_scopes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_scope_relationships" ADD CONSTRAINT "knowledge_scope_relationships_child_fk" FOREIGN KEY ("child_knowledge_scope_id") REFERENCES "public"."knowledge_scopes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_scope_relationships_child_id_idx" ON "knowledge_scope_relationships" USING btree ("child_knowledge_scope_id");
