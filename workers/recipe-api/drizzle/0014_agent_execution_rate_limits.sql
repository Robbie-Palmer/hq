ALTER TABLE "agent_auth_audit_event" ADD COLUMN "correlation_id" text;--> statement-breakpoint
CREATE INDEX "agent_auth_audit_event_correlation_idx" ON "agent_auth_audit_event" USING btree ("correlation_id");
