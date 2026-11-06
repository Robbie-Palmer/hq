CREATE TABLE "work_item_pull_request_current_delivery_resolutions" (
	"work_item_id" text NOT NULL,
	"repository" text NOT NULL,
	"number" integer NOT NULL,
	"resolution_id" uuid NOT NULL,
	"selected_at" timestamp with time zone NOT NULL,
	CONSTRAINT "work_item_pr_current_delivery_resolutions_pk" PRIMARY KEY("work_item_id","repository","number")
);
--> statement-breakpoint
ALTER TABLE "work_item_pull_request_current_delivery_resolutions" ADD CONSTRAINT "work_item_pull_request_current_delivery_resolutions_resolution_id_work_item_pull_request_delivery_resolutions_id_fk" FOREIGN KEY ("resolution_id") REFERENCES "public"."work_item_pull_request_delivery_resolutions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_pull_request_current_delivery_resolutions" ADD CONSTRAINT "work_item_pr_current_delivery_resolutions_link_fk" FOREIGN KEY ("work_item_id","repository","number") REFERENCES "public"."work_item_pull_requests"("work_item_id","repository","number") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "work_item_pr_current_delivery_resolution_id_uidx" ON "work_item_pull_request_current_delivery_resolutions" USING btree ("resolution_id");--> statement-breakpoint
INSERT INTO "work_item_pull_request_current_delivery_resolutions" (
	"work_item_id",
	"repository",
	"number",
	"resolution_id",
	"selected_at"
)
SELECT DISTINCT ON ("work_item_id", "repository", "number")
	"work_item_id",
	"repository",
	"number",
	"id",
	"resolved_at"
FROM "work_item_pull_request_delivery_resolutions"
ORDER BY "work_item_id", "repository", "number", "resolved_at" DESC, "id" DESC;
