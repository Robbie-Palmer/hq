ALTER TABLE "notes" ALTER COLUMN "lease_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "author" text;--> statement-breakpoint
UPDATE "notes"
SET "author" = "leases"."worker_id"
FROM "leases"
WHERE "notes"."lease_id" = "leases"."id";--> statement-breakpoint
ALTER TABLE "notes" ALTER COLUMN "author" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_author_not_blank_check" CHECK (btrim("notes"."author") <> '');--> statement-breakpoint
CREATE FUNCTION reject_note_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION USING
		ERRCODE = '55000',
		MESSAGE = 'notes are append-only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER notes_immutable
BEFORE UPDATE OR DELETE ON "notes"
FOR EACH ROW EXECUTE FUNCTION reject_note_mutation();--> statement-breakpoint
CREATE TRIGGER notes_immutable_truncate
BEFORE TRUNCATE ON "notes"
FOR EACH STATEMENT EXECUTE FUNCTION reject_note_mutation();
