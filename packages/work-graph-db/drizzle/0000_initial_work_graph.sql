CREATE TYPE "public"."work_item_lifecycle" AS ENUM('open', 'released', 'cancelled');--> statement-breakpoint
CREATE TABLE "graph_mutation_locks" (
	"id" text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_items" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"lifecycle" "work_item_lifecycle" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_items_id_not_blank_check" CHECK (btrim("work_items"."id") <> ''),
	CONSTRAINT "work_items_title_not_blank_check" CHECK (btrim("work_items"."title") <> '')
);
--> statement-breakpoint
CREATE TABLE "work_item_dependencies" (
	"dependent_work_item_id" text NOT NULL,
	"blocker_work_item_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_item_dependencies_pk" PRIMARY KEY("dependent_work_item_id","blocker_work_item_id"),
	CONSTRAINT "work_item_dependencies_not_self_check" CHECK ("work_item_dependencies"."dependent_work_item_id" <> "work_item_dependencies"."blocker_work_item_id")
);
--> statement-breakpoint
CREATE TABLE "work_item_hierarchy" (
	"child_work_item_id" text PRIMARY KEY NOT NULL,
	"parent_work_item_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_item_hierarchy_not_self_check" CHECK ("work_item_hierarchy"."child_work_item_id" <> "work_item_hierarchy"."parent_work_item_id")
);
--> statement-breakpoint
ALTER TABLE "work_item_dependencies" ADD CONSTRAINT "work_item_dependencies_dependent_work_item_id_work_items_id_fk" FOREIGN KEY ("dependent_work_item_id") REFERENCES "public"."work_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_dependencies" ADD CONSTRAINT "work_item_dependencies_blocker_work_item_id_work_items_id_fk" FOREIGN KEY ("blocker_work_item_id") REFERENCES "public"."work_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_hierarchy" ADD CONSTRAINT "work_item_hierarchy_child_work_item_id_work_items_id_fk" FOREIGN KEY ("child_work_item_id") REFERENCES "public"."work_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_hierarchy" ADD CONSTRAINT "work_item_hierarchy_parent_work_item_id_work_items_id_fk" FOREIGN KEY ("parent_work_item_id") REFERENCES "public"."work_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_item_dependencies_blocker_work_item_id_idx" ON "work_item_dependencies" USING btree ("blocker_work_item_id");--> statement-breakpoint
CREATE INDEX "work_item_hierarchy_parent_work_item_id_idx" ON "work_item_hierarchy" USING btree ("parent_work_item_id");--> statement-breakpoint
INSERT INTO "graph_mutation_locks" ("id") VALUES ('global');
