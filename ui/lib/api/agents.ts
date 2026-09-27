import { isRecord } from "ts-base/records";
import { z } from "zod";
import { apiRequest } from "@/lib/api/http";

export type AgentStatus =
  | "active"
  | "pending"
  | "expired"
  | "revoked"
  | "rejected"
  | "claimed";

export type AgentCapabilityGrantStatus =
  | "active"
  | "pending"
  | "denied"
  | "revoked"
  | "consumed";

export type AgentCapabilityGrant = {
  capability: string;
  description?: string;
  expiresAt?: string;
  status: AgentCapabilityGrantStatus;
};

export type AgentSummary = {
  id: string;
  name: string;
  status: AgentStatus;
  mode: "delegated" | "autonomous";
  hostId: string;
  hostName: string;
  capabilityGrants: AgentCapabilityGrant[];
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
};

export type AgentDetail = Omit<AgentSummary, "hostName"> & {
  activatedAt: string | null;
};

export type AgentHost = {
  id: string;
  name: string;
  status: string;
};

const agentDateTime = z.iso.datetime({ offset: true });

function nullableDateTime(value: unknown): string | null | undefined {
  if (value === null) return null;
  const parsed = agentDateTime.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

const AGENT_CAPABILITY_GRANT_STATUSES = new Set<AgentCapabilityGrantStatus>([
  "active",
  "pending",
  "denied",
  "revoked",
  "consumed",
]);

function capabilityGrant(value: unknown): AgentCapabilityGrant | undefined {
  if (
    !isRecord(value) ||
    typeof value.capability !== "string" ||
    typeof value.status !== "string" ||
    !AGENT_CAPABILITY_GRANT_STATUSES.has(
      value.status as AgentCapabilityGrantStatus,
    )
  ) {
    return undefined;
  }
  const expiresAt =
    value.expires_at === undefined
      ? undefined
      : nullableDateTime(value.expires_at);
  if (value.expires_at !== undefined && expiresAt === undefined) {
    return undefined;
  }
  if (
    value.description !== undefined &&
    typeof value.description !== "string"
  ) {
    return undefined;
  }
  return {
    capability: value.capability,
    status: value.status as AgentCapabilityGrantStatus,
    ...(typeof value.description === "string"
      ? { description: value.description }
      : {}),
    ...(typeof expiresAt === "string" ? { expiresAt } : {}),
  };
}

function capabilityGrants(value: unknown): AgentCapabilityGrant[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const grants = value.map(capabilityGrant);
  return grants.every((grant) => grant !== undefined) ? grants : undefined;
}

const AGENT_STATUSES = new Set<AgentStatus>([
  "active",
  "pending",
  "expired",
  "revoked",
  "rejected",
  "claimed",
]);

type AgentBase = Omit<AgentSummary, "hostName">;

function agentBase(value: unknown): AgentBase | undefined {
  if (!isRecord(value)) return undefined;
  const status = value.status;
  const mode = value.mode;
  const grants = capabilityGrants(value.agent_capability_grants);
  const createdAt = agentDateTime.safeParse(value.created_at);
  const lastUsedAt = nullableDateTime(value.last_used_at);
  const expiresAt = nullableDateTime(value.expires_at);
  if (
    typeof value.agent_id !== "string" ||
    typeof value.name !== "string" ||
    typeof status !== "string" ||
    !AGENT_STATUSES.has(status as AgentStatus) ||
    (mode !== "delegated" && mode !== "autonomous") ||
    typeof value.host_id !== "string" ||
    !grants ||
    !createdAt.success ||
    lastUsedAt === undefined ||
    expiresAt === undefined
  ) {
    return undefined;
  }
  return {
    id: value.agent_id,
    name: value.name,
    status: status as AgentStatus,
    mode,
    hostId: value.host_id,
    capabilityGrants: grants,
    createdAt: createdAt.data,
    lastUsedAt,
    expiresAt,
  };
}

function parseAgentSummary(value: unknown): AgentSummary | undefined {
  const base = agentBase(value);
  if (!base || !isRecord(value) || typeof value.host_name !== "string") {
    return undefined;
  }
  return { ...base, hostName: value.host_name };
}

function parseAgentDetail(value: unknown): AgentDetail | undefined {
  const base = agentBase(value);
  if (!base || !isRecord(value)) return undefined;
  const activatedAt = nullableDateTime(value.activated_at);
  if (activatedAt === undefined) return undefined;
  return { ...base, activatedAt };
}

export async function listAgents(
  signal?: AbortSignal,
): Promise<AgentSummary[]> {
  const body = await apiRequest<unknown>("/api/auth/agent/list?limit=200", {
    signal,
    fallbackMessage: "Agents could not be loaded.",
  });
  if (!isRecord(body) || !Array.isArray(body.agents)) {
    throw new Error("The agent list response was invalid.");
  }
  const agents = body.agents.map(parseAgentSummary);
  if (!agents.every((agent): agent is AgentSummary => agent !== undefined)) {
    throw new Error("The agent list response was invalid.");
  }
  return agents;
}

export async function getAgent(
  agentId: string,
  signal?: AbortSignal,
): Promise<AgentDetail> {
  const body = await apiRequest<unknown>(
    `/api/auth/agent/get?agent_id=${encodeURIComponent(agentId)}`,
    { signal, fallbackMessage: "The agent request could not be loaded." },
  );
  const agent = parseAgentDetail(body);
  if (!agent) throw new Error("The agent request response was invalid.");
  return agent;
}

export async function getAgentHost(
  hostId: string,
  signal?: AbortSignal,
): Promise<AgentHost> {
  const body = await apiRequest<unknown>(
    `/api/auth/host/get?host_id=${encodeURIComponent(hostId)}`,
    { signal, fallbackMessage: "The agent host could not be loaded." },
  );
  if (
    !isRecord(body) ||
    typeof body.id !== "string" ||
    typeof body.name !== "string" ||
    typeof body.status !== "string"
  ) {
    throw new Error("The agent host response was invalid.");
  }
  return { id: body.id, name: body.name, status: body.status };
}

export async function revokeAgent(agentId: string): Promise<void> {
  const body = await apiRequest<unknown>("/api/auth/agent/revoke", {
    method: "POST",
    json: { agent_id: agentId },
    fallbackMessage: "Agent access could not be revoked.",
  });
  if (
    !isRecord(body) ||
    body.agent_id !== agentId ||
    body.status !== "revoked"
  ) {
    throw new Error("The agent revocation response was invalid.");
  }
}

export async function decideAgentApproval(input: {
  agentId: string;
  code: string;
  action: "approve" | "deny";
}): Promise<void> {
  const body = await apiRequest<unknown>("/api/auth/agent/approve-capability", {
    method: "POST",
    json: {
      agent_id: input.agentId,
      user_code: input.code,
      action: input.action,
    },
    fallbackMessage: "The approval decision could not be saved.",
  });
  const expectedStatus = input.action === "approve" ? "approved" : "denied";
  if (
    !isRecord(body) ||
    body.status !== expectedStatus ||
    (body.agentId !== undefined && body.agentId !== input.agentId)
  ) {
    throw new Error("The approval decision response was invalid.");
  }
}
