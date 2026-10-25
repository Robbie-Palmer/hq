CREATE TYPE "public"."lease_outcome" AS ENUM('released', 'cancelled', 'decomposed', 'attention_requested', 'expired');--> statement-breakpoint
CREATE TABLE "leases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_item_id" text NOT NULL,
	"worker_id" text NOT NULL,
	"epoch" integer NOT NULL,
	"acquired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"outcome" "lease_outcome",
	CONSTRAINT "leases_worker_id_not_blank_check" CHECK (btrim("leases"."worker_id") <> ''),
	CONSTRAINT "leases_epoch_positive_check" CHECK ("leases"."epoch" > 0),
	CONSTRAINT "leases_expiry_after_acquisition_check" CHECK ("leases"."expires_at" > "leases"."acquired_at"),
	CONSTRAINT "leases_end_and_outcome_check" CHECK (("leases"."ended_at" is null) = ("leases"."outcome" is null)),
	CONSTRAINT "leases_end_after_acquisition_check" CHECK ("leases"."ended_at" is null or "leases"."ended_at" >= "leases"."acquired_at")
);
--> statement-breakpoint
ALTER TABLE "leases" ADD CONSTRAINT "leases_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "leases_work_item_id_epoch_uidx" ON "leases" USING btree ("work_item_id","epoch");--> statement-breakpoint
CREATE UNIQUE INDEX "leases_one_current_per_work_item_uidx" ON "leases" USING btree ("work_item_id") WHERE "leases"."ended_at" is null;
