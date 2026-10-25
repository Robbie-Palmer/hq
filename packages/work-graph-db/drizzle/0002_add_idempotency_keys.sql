CREATE TABLE "idempotency_keys" (
	"id" uuid PRIMARY KEY NOT NULL,
	"operation" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_operation_not_blank_check" CHECK (btrim("idempotency_keys"."operation") <> ''),
	CONSTRAINT "idempotency_keys_request_fingerprint_not_blank_check" CHECK (btrim("idempotency_keys"."request_fingerprint") <> '')
);
