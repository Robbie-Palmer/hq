CREATE TABLE "attention_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_item_id" text NOT NULL,
	"requesting_lease_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"question" text NOT NULL,
	"note" text,
	"blocking" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attention_requests_kind_not_blank_check" CHECK (btrim("attention_requests"."kind") <> ''),
	CONSTRAINT "attention_requests_question_not_blank_check" CHECK (btrim("attention_requests"."question") <> ''),
	CONSTRAINT "attention_requests_note_not_blank_check" CHECK ("attention_requests"."note" is null or btrim("attention_requests"."note") <> '')
);
--> statement-breakpoint
CREATE TABLE "attention_resolutions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"attention_request_id" uuid NOT NULL,
	"resolution" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attention_resolutions_resolution_not_blank_check" CHECK (btrim("attention_resolutions"."resolution") <> '')
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_item_id" text NOT NULL,
	"lease_id" uuid NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notes_content_not_blank_check" CHECK (btrim("notes"."content") <> '')
);
--> statement-breakpoint
ALTER TABLE "attention_requests" ADD CONSTRAINT "attention_requests_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attention_requests" ADD CONSTRAINT "attention_requests_requesting_lease_id_leases_id_fk" FOREIGN KEY ("requesting_lease_id") REFERENCES "public"."leases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attention_resolutions" ADD CONSTRAINT "attention_resolutions_request_id_fk" FOREIGN KEY ("attention_request_id") REFERENCES "public"."attention_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_lease_id_leases_id_fk" FOREIGN KEY ("lease_id") REFERENCES "public"."leases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attention_requests_work_item_id_created_at_idx" ON "attention_requests" USING btree ("work_item_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "attention_resolutions_attention_request_id_uidx" ON "attention_resolutions" USING btree ("attention_request_id");--> statement-breakpoint
CREATE INDEX "notes_work_item_id_created_at_idx" ON "notes" USING btree ("work_item_id","created_at");
