CREATE TYPE "public"."action_outcome_state" AS ENUM('succeeded', 'failed', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."approval_decision" AS ENUM('approved', 'rejected', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."archive_state" AS ENUM('retained', 'pending_archive_deletion', 'archive_purged');--> statement-breakpoint
CREATE TYPE "public"."encrypted_content_class" AS ENUM('raw_mime', 'attachment', 'retained_document', 'evaluation_sample', 'export_bundle', 'temporary_work');--> statement-breakpoint
CREATE TYPE "public"."mailbox_provider" AS ENUM('microsoft_graph', 'gmail');--> statement-breakpoint
CREATE TYPE "public"."proposal_state" AS ENUM('pending', 'approved', 'rejected', 'expired', 'executed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."provider_mailbox_state" AS ENUM('active', 'pending_mailbox_deletion', 'mailbox_purged');--> statement-breakpoint
CREATE TABLE "action_manifest" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"digest" text NOT NULL,
	"operations" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "action_manifest_version_positive_check" CHECK ("action_manifest"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "action_outcome" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"manifest_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"state" "action_outcome_state" NOT NULL,
	"provider_action_id" text,
	"details" jsonb NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "action_outcome_attempt_positive_check" CHECK ("action_outcome"."attempt" > 0),
	CONSTRAINT "action_outcome_finished_after_started_check" CHECK ("action_outcome"."finished_at" >= "action_outcome"."started_at")
);
--> statement-breakpoint
CREATE TABLE "action_proposal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"proposal_type" text NOT NULL,
	"state" "proposal_state" DEFAULT 'pending' NOT NULL,
	"idempotency_key" text NOT NULL,
	"summary" text NOT NULL,
	"rationale" text NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "action_proposal_type_not_blank_check" CHECK (btrim("action_proposal"."proposal_type") <> ''),
	CONSTRAINT "action_proposal_idempotency_not_blank_check" CHECK (btrim("action_proposal"."idempotency_key") <> '')
);
--> statement-breakpoint
CREATE TABLE "approval" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"manifest_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"decision" "approval_decision" NOT NULL,
	"decided_by" text NOT NULL,
	"reason" text,
	"decided_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_sequence_positive_check" CHECK ("approval"."sequence" > 0),
	CONSTRAINT "approval_decided_by_not_blank_check" CHECK (btrim("approval"."decided_by") <> '')
);
--> statement-breakpoint
CREATE TABLE "audit_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"previous_event_hash" text,
	"event_hash" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_event_type_not_blank_check" CHECK (btrim("audit_event"."event_type") <> ''),
	CONSTRAINT "audit_event_subject_not_blank_check" CHECK (btrim("audit_event"."subject_type") <> '' and btrim("audit_event"."subject_id") <> '')
);
--> statement-breakpoint
CREATE TABLE "content_hash" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"algorithm" text DEFAULT 'sha256' NOT NULL,
	"digest" text NOT NULL,
	"byte_length" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_hash_sha256_check" CHECK ("content_hash"."algorithm" <> 'sha256' or "content_hash"."digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "content_hash_byte_length_check" CHECK ("content_hash"."byte_length" >= 0)
);
--> statement-breakpoint
CREATE TABLE "content_object" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"content_hash_id" uuid NOT NULL,
	"content_class" "encrypted_content_class" NOT NULL,
	"object_key" text NOT NULL,
	"object_version" integer DEFAULT 1 NOT NULL,
	"ciphertext_algorithm" text DEFAULT 'AES-256-GCM' NOT NULL,
	"key_wrap_algorithm" text DEFAULT 'AES-256-KW' NOT NULL,
	"envelope_version" integer DEFAULT 1 NOT NULL,
	"key_version" text NOT NULL,
	"nonce_base64" text NOT NULL,
	"wrapped_data_key_base64" text NOT NULL,
	"archive_state" "archive_state" DEFAULT 'retained' NOT NULL,
	"deletion_requested_at" timestamp with time zone,
	"recovery_until" timestamp with time zone,
	"purged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_object_version_positive_check" CHECK ("content_object"."object_version" > 0 and "content_object"."envelope_version" > 0),
	CONSTRAINT "content_object_algorithms_check" CHECK ("content_object"."ciphertext_algorithm" = 'AES-256-GCM' and "content_object"."key_wrap_algorithm" = 'AES-256-KW'),
	CONSTRAINT "content_object_recovery_check" CHECK ("content_object"."deletion_requested_at" is null or "content_object"."recovery_until" >= "content_object"."deletion_requested_at")
);
--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"message_id" uuid,
	"attachment_id" uuid,
	"content_object_id" uuid,
	"kind" text NOT NULL,
	"locator" jsonb NOT NULL,
	"content_digest" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_kind_not_blank_check" CHECK (btrim("evidence"."kind") <> '')
);
--> statement-breakpoint
CREATE TABLE "idempotency_key" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"request_digest" text NOT NULL,
	"result" jsonb,
	"expires_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_key_scope_not_blank_check" CHECK (btrim("idempotency_key"."scope") <> ''),
	CONSTRAINT "idempotency_key_key_not_blank_check" CHECK (btrim("idempotency_key"."key") <> '')
);
--> statement-breakpoint
CREATE TABLE "mail_attachment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"provider_attachment_id" text NOT NULL,
	"content_object_id" uuid NOT NULL,
	"filename" text,
	"media_type" text,
	"inline_content_id" text,
	"byte_length" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_attachment_provider_id_not_blank_check" CHECK (btrim("mail_attachment"."provider_attachment_id") <> ''),
	CONSTRAINT "mail_attachment_byte_length_check" CHECK ("mail_attachment"."byte_length" >= 0)
);
--> statement-breakpoint
CREATE TABLE "mail_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"provider_message_id" text NOT NULL,
	"provider_thread_id" text,
	"internet_message_id" text,
	"raw_object_id" uuid NOT NULL,
	"subject" text,
	"sender" jsonb,
	"recipients" jsonb,
	"received_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"provider_updated_at" timestamp with time zone,
	"observed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_message_provider_id_not_blank_check" CHECK (btrim("mail_message"."provider_message_id") <> '')
);
--> statement-breakpoint
CREATE TABLE "mailbox_account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "mailbox_provider" NOT NULL,
	"provider_account_id" text NOT NULL,
	"primary_address" text,
	"display_name" text,
	"provider_state" "provider_mailbox_state" DEFAULT 'active' NOT NULL,
	"archive_state" "archive_state" DEFAULT 'retained' NOT NULL,
	"mailbox_deletion_requested_at" timestamp with time zone,
	"mailbox_purged_at" timestamp with time zone,
	"archive_deletion_requested_at" timestamp with time zone,
	"archive_recovery_until" timestamp with time zone,
	"archive_purged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mailbox_account_provider_id_not_blank_check" CHECK (btrim("mailbox_account"."provider_account_id") <> ''),
	CONSTRAINT "mailbox_account_archive_recovery_check" CHECK ("mailbox_account"."archive_deletion_requested_at" is null or "mailbox_account"."archive_recovery_until" >= "mailbox_account"."archive_deletion_requested_at")
);
--> statement-breakpoint
CREATE TABLE "provider_sync_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"resource_kind" text NOT NULL,
	"cursor" text,
	"last_attempt_at" timestamp with time zone,
	"last_successful_at" timestamp with time zone,
	"last_error_code" text,
	"last_error_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_sync_state_resource_not_blank_check" CHECK (btrim("provider_sync_state"."resource_kind") <> '')
);
--> statement-breakpoint
ALTER TABLE "action_manifest" ADD CONSTRAINT "action_manifest_proposal_id_action_proposal_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."action_proposal"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_outcome" ADD CONSTRAINT "action_outcome_proposal_id_action_proposal_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."action_proposal"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_outcome" ADD CONSTRAINT "action_outcome_manifest_id_action_manifest_id_fk" FOREIGN KEY ("manifest_id") REFERENCES "public"."action_manifest"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_proposal" ADD CONSTRAINT "action_proposal_account_id_mailbox_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."mailbox_account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval" ADD CONSTRAINT "approval_proposal_id_action_proposal_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."action_proposal"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval" ADD CONSTRAINT "approval_manifest_id_action_manifest_id_fk" FOREIGN KEY ("manifest_id") REFERENCES "public"."action_manifest"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_account_id_mailbox_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."mailbox_account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_hash" ADD CONSTRAINT "content_hash_account_id_mailbox_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."mailbox_account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_object" ADD CONSTRAINT "content_object_account_id_mailbox_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."mailbox_account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_object" ADD CONSTRAINT "content_object_content_hash_id_content_hash_id_fk" FOREIGN KEY ("content_hash_id") REFERENCES "public"."content_hash"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_account_id_mailbox_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."mailbox_account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_message_id_mail_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."mail_message"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_attachment_id_mail_attachment_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."mail_attachment"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_content_object_id_content_object_id_fk" FOREIGN KEY ("content_object_id") REFERENCES "public"."content_object"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_key" ADD CONSTRAINT "idempotency_key_account_id_mailbox_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."mailbox_account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_attachment" ADD CONSTRAINT "mail_attachment_account_id_mailbox_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."mailbox_account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_attachment" ADD CONSTRAINT "mail_attachment_message_id_mail_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."mail_message"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_attachment" ADD CONSTRAINT "mail_attachment_content_object_id_content_object_id_fk" FOREIGN KEY ("content_object_id") REFERENCES "public"."content_object"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_message" ADD CONSTRAINT "mail_message_account_id_mailbox_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."mailbox_account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_message" ADD CONSTRAINT "mail_message_raw_object_id_content_object_id_fk" FOREIGN KEY ("raw_object_id") REFERENCES "public"."content_object"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_sync_state" ADD CONSTRAINT "provider_sync_state_account_id_mailbox_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."mailbox_account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "action_manifest_proposal_version_uidx" ON "action_manifest" USING btree ("proposal_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "action_manifest_proposal_digest_uidx" ON "action_manifest" USING btree ("proposal_id","digest");--> statement-breakpoint
CREATE UNIQUE INDEX "action_outcome_proposal_attempt_uidx" ON "action_outcome" USING btree ("proposal_id","attempt");--> statement-breakpoint
CREATE UNIQUE INDEX "action_outcome_provider_action_uidx" ON "action_outcome" USING btree ("provider_action_id") WHERE "action_outcome"."provider_action_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "action_proposal_account_idempotency_uidx" ON "action_proposal" USING btree ("account_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "action_proposal_account_state_idx" ON "action_proposal" USING btree ("account_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_proposal_sequence_uidx" ON "approval" USING btree ("proposal_id","sequence");--> statement-breakpoint
CREATE INDEX "approval_manifest_idx" ON "approval" USING btree ("manifest_id");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_event_account_hash_uidx" ON "audit_event" USING btree ("account_id","event_hash");--> statement-breakpoint
CREATE INDEX "audit_event_account_occurred_idx" ON "audit_event" USING btree ("account_id","occurred_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "content_hash_account_algorithm_digest_uidx" ON "content_hash" USING btree ("account_id","algorithm","digest");--> statement-breakpoint
CREATE UNIQUE INDEX "content_object_key_uidx" ON "content_object" USING btree ("object_key");--> statement-breakpoint
CREATE UNIQUE INDEX "content_object_account_id_version_uidx" ON "content_object" USING btree ("account_id","id","object_version");--> statement-breakpoint
CREATE INDEX "content_object_hash_idx" ON "content_object" USING btree ("content_hash_id");--> statement-breakpoint
CREATE INDEX "content_object_account_class_idx" ON "content_object" USING btree ("account_id","content_class");--> statement-breakpoint
CREATE INDEX "evidence_account_captured_idx" ON "evidence" USING btree ("account_id","captured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_key_account_scope_key_uidx" ON "idempotency_key" USING btree ("account_id","scope","key");--> statement-breakpoint
CREATE INDEX "idempotency_key_expires_idx" ON "idempotency_key" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_attachment_account_provider_id_uidx" ON "mail_attachment" USING btree ("account_id","provider_attachment_id");--> statement-breakpoint
CREATE INDEX "mail_attachment_message_idx" ON "mail_attachment" USING btree ("message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_message_account_provider_id_uidx" ON "mail_message" USING btree ("account_id","provider_message_id");--> statement-breakpoint
CREATE INDEX "mail_message_account_received_idx" ON "mail_message" USING btree ("account_id","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mailbox_account_provider_id_uidx" ON "mailbox_account" USING btree ("provider","provider_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_sync_state_account_resource_uidx" ON "provider_sync_state" USING btree ("account_id","resource_kind");
--> statement-breakpoint
CREATE FUNCTION reject_audit_event_mutation() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'audit_event is append-only';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_event_reject_update
	BEFORE UPDATE ON "audit_event"
	FOR EACH ROW EXECUTE FUNCTION reject_audit_event_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_event_reject_delete
	BEFORE DELETE ON "audit_event"
	FOR EACH ROW EXECUTE FUNCTION reject_audit_event_mutation();
