ALTER TABLE "attention_requests" DROP CONSTRAINT "attention_requests_requesting_lease_id_leases_id_fk";
--> statement-breakpoint
ALTER TABLE "notes" DROP CONSTRAINT "notes_lease_id_leases_id_fk";
--> statement-breakpoint
CREATE UNIQUE INDEX "leases_id_work_item_id_uidx" ON "leases" USING btree ("id","work_item_id");--> statement-breakpoint
ALTER TABLE "attention_requests" ADD CONSTRAINT "attention_requests_lease_work_item_fk" FOREIGN KEY ("requesting_lease_id","work_item_id") REFERENCES "public"."leases"("id","work_item_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_lease_work_item_fk" FOREIGN KEY ("lease_id","work_item_id") REFERENCES "public"."leases"("id","work_item_id") ON DELETE restrict ON UPDATE no action;
