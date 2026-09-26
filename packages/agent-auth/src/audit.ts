import type { AgentAuthEvent } from "@better-auth/agent-auth";

export type AgentAuthAuditRecord = {
  eventType: string;
  actorType?: "user" | "agent" | "system";
  actorId?: string;
  userId?: string;
  agentId?: string;
  hostId?: string;
  targetType?: string;
  targetId?: string;
  capability?: string;
  outcome?: string;
  durationMs?: number;
};

export type AgentAuthAuditHandlerOptions = {
  write: (record: AgentAuthAuditRecord) => void | Promise<void>;
  includeCapabilityExecutions?: boolean;
  onError?: (error: unknown, record: AgentAuthAuditRecord) => void;
};

export function toAgentAuthAuditRecord(
  event: AgentAuthEvent,
): AgentAuthAuditRecord {
  let userId: string | undefined;
  if (event.type === "capability.executed") {
    userId = event.userId;
  } else if (event.actorType === "user") {
    userId = event.actorId;
  }
  return {
    eventType: event.type,
    actorType: event.actorType,
    actorId: event.actorId,
    userId,
    agentId: event.agentId,
    hostId: event.hostId,
    targetType: event.targetType,
    targetId: event.targetId,
    capability:
      event.type === "capability.executed" ? event.capability : undefined,
    outcome: event.type === "capability.executed" ? event.status : undefined,
    durationMs:
      event.type === "capability.executed" ? event.durationMs : undefined,
  };
}

export function createAgentAuthAuditHandler({
  write,
  includeCapabilityExecutions = true,
  onError,
}: AgentAuthAuditHandlerOptions) {
  return async (event: AgentAuthEvent): Promise<void> => {
    if (!includeCapabilityExecutions && event.type === "capability.executed") {
      return;
    }
    const record = toAgentAuthAuditRecord(event);
    try {
      await write(record);
    } catch (error) {
      if (onError) {
        onError(error, record);
        return;
      }
      console.error("Agent Auth audit write failed", error);
    }
  };
}
