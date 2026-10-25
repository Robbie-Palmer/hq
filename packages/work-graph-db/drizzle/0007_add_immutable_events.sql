CREATE TABLE "events" (
	"sequence" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "events_sequence_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"type" text NOT NULL,
	"work_item_id" text,
	"data" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_type_not_blank_check" CHECK (btrim("events"."type") <> '')
);
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_work_item_id_sequence_idx" ON "events" USING btree ("work_item_id","sequence");--> statement-breakpoint
INSERT INTO "graph_mutation_locks" ("id") VALUES ('event-sequence');--> statement-breakpoint
CREATE FUNCTION serialize_event_inserts() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	PERFORM "id"
	FROM "graph_mutation_locks"
	WHERE "id" = 'event-sequence'
	FOR UPDATE;
	IF NOT FOUND THEN
		RAISE EXCEPTION 'The event sequence lock row is missing.';
	END IF;
	RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER events_serialize_inserts
BEFORE INSERT ON "events"
FOR EACH STATEMENT EXECUTE FUNCTION serialize_event_inserts();--> statement-breakpoint
CREATE FUNCTION reject_event_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION USING
		ERRCODE = '55000',
		MESSAGE = 'events are immutable';
END;
$$;--> statement-breakpoint
CREATE TRIGGER events_immutable
BEFORE UPDATE OR DELETE ON "events"
FOR EACH ROW EXECUTE FUNCTION reject_event_mutation();--> statement-breakpoint
CREATE TRIGGER events_immutable_truncate
BEFORE TRUNCATE ON "events"
FOR EACH STATEMENT EXECUTE FUNCTION reject_event_mutation();
