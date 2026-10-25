CREATE TABLE "agent" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"user_id" text,
	"host_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"mode" text DEFAULT 'delegated' NOT NULL,
	"public_key" text NOT NULL,
	"kid" text,
	"jwks_url" text,
	"last_used_at" timestamp with time zone,
	"activated_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"metadata" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_auth_audit_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" text NOT NULL,
	"actor_type" text,
	"actor_id" text,
	"user_id" text,
	"agent_id" text,
	"host_id" text,
	"target_type" text,
	"target_id" text,
	"capability" text,
	"outcome" text,
	"duration_ms" integer,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_capability_grant" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"capability" text NOT NULL,
	"denied_by" text,
	"granted_by" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"reason" text,
	"constraints" text
);
--> statement-breakpoint
CREATE TABLE "agent_host" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"user_id" text,
	"default_capabilities" text,
	"public_key" text,
	"kid" text,
	"jwks_url" text,
	"enrollment_token_hash" text,
	"enrollment_token_expires_at" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"activated_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_request" (
	"id" text PRIMARY KEY NOT NULL,
	"method" text NOT NULL,
	"agent_id" text,
	"host_id" text,
	"user_id" text,
	"capabilities" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"user_code_hash" text,
	"login_hint" text,
	"binding_message" text,
	"client_notification_token" text,
	"client_notification_endpoint" text,
	"delivery_mode" text,
	"interval" integer NOT NULL,
	"last_polled_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_secondary_storage" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent" ADD CONSTRAINT "agent_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent" ADD CONSTRAINT "agent_host_id_agent_host_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."agent_host"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_capability_grant" ADD CONSTRAINT "agent_capability_grant_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_capability_grant" ADD CONSTRAINT "agent_capability_grant_denied_by_user_id_fk" FOREIGN KEY ("denied_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_capability_grant" ADD CONSTRAINT "agent_capability_grant_granted_by_user_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_host" ADD CONSTRAINT "agent_host_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_host_id_agent_host_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."agent_host"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_user_id_idx" ON "agent" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "agent_host_id_idx" ON "agent" USING btree ("host_id");--> statement-breakpoint
CREATE INDEX "agent_status_idx" ON "agent" USING btree ("status");--> statement-breakpoint
CREATE INDEX "agent_kid_idx" ON "agent" USING btree ("kid");--> statement-breakpoint
CREATE INDEX "agent_auth_audit_event_user_time_idx" ON "agent_auth_audit_event" USING btree ("user_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "agent_auth_audit_event_agent_time_idx" ON "agent_auth_audit_event" USING btree ("agent_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "agent_auth_audit_event_host_time_idx" ON "agent_auth_audit_event" USING btree ("host_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "agent_capability_grant_agent_id_idx" ON "agent_capability_grant" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "agent_capability_grant_capability_idx" ON "agent_capability_grant" USING btree ("capability");--> statement-breakpoint
CREATE INDEX "agent_capability_grant_granted_by_idx" ON "agent_capability_grant" USING btree ("granted_by");--> statement-breakpoint
CREATE INDEX "agent_capability_grant_status_idx" ON "agent_capability_grant" USING btree ("status");--> statement-breakpoint
CREATE INDEX "agent_host_user_id_idx" ON "agent_host" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "agent_host_kid_idx" ON "agent_host" USING btree ("kid");--> statement-breakpoint
CREATE INDEX "agent_host_enrollment_token_hash_idx" ON "agent_host" USING btree ("enrollment_token_hash");--> statement-breakpoint
CREATE INDEX "agent_host_status_idx" ON "agent_host" USING btree ("status");--> statement-breakpoint
CREATE INDEX "approval_request_agent_id_idx" ON "approval_request" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "approval_request_host_id_idx" ON "approval_request" USING btree ("host_id");--> statement-breakpoint
CREATE INDEX "approval_request_user_id_idx" ON "approval_request" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "approval_request_status_idx" ON "approval_request" USING btree ("status");--> statement-breakpoint
CREATE INDEX "auth_secondary_storage_expires_at_idx" ON "auth_secondary_storage" USING btree ("expires_at");--> statement-breakpoint
CREATE TABLE "notification_agent_approval_event" (
	"event_id" text PRIMARY KEY NOT NULL,
	"approval_request_id" text,
	"agent_id_snapshot" text NOT NULL,
	"agent_name_snapshot" text NOT NULL,
	"capabilities_snapshot" text NOT NULL,
	"expires_at_snapshot" timestamp with time zone NOT NULL,
	"approval_code_ciphertext" text
);
--> statement-breakpoint
ALTER TABLE "notification_agent_approval_event" ADD CONSTRAINT "notification_agent_approval_event_event_id_notification_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."notification_event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_agent_approval_event" ADD CONSTRAINT "notification_agent_approval_event_approval_request_id_approval_request_id_fk" FOREIGN KEY ("approval_request_id") REFERENCES "public"."approval_request"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_agent_approval_request_uidx" ON "notification_agent_approval_event" USING btree ("approval_request_id");
