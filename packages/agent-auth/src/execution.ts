import {
  AGENT_AUTH_ERROR_CODES,
  agentError,
  type AgentAuthOptions,
  type AgentSession,
} from "@better-auth/agent-auth";

const DEFAULT_RATE_LIMIT_KEY_PREFIX = "agent-execution";
const DEFAULT_SOURCE_IP_HEADER = "cf-connecting-ip";
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,100}$/;
const RATE_LIMIT_DIMENSIONS = [
  "capability",
  "agent",
  "user",
  "host",
  "ip",
] as const;

export type AgentExecutionContext = Parameters<
  NonNullable<AgentAuthOptions["onExecute"]>
>[0];

export type AgentExecutionRateLimitDimension =
  (typeof RATE_LIMIT_DIMENSIONS)[number];

export type AgentExecutionRateLimitRule = {
  max: number;
  windowSeconds: number;
};

export type AgentExecutionRateLimits = Record<
  AgentExecutionRateLimitDimension,
  AgentExecutionRateLimitRule
>;

export type AgentExecutionRateLimitResult = {
  allowed: boolean;
  retryAfter: number;
};

export type AgentExecutionRateLimit = {
  dimension: AgentExecutionRateLimitDimension;
  retryAfter: number;
};

export type AgentExecutionAuditEvent = {
  eventType: "capability.executed";
  actorType: "agent";
  actorId: string;
  userId: string;
  agentId: string;
  hostId: string;
  capability: string;
  outcome:
    | "success"
    | "error"
    | `rate_limited:${AgentExecutionRateLimitDimension}`;
  durationMs: number;
  correlationId: string;
};

export type AgentExecutionGuardOptions<Result> = {
  limits: AgentExecutionRateLimits;
  consumeRateLimit: (
    key: string,
    rule: AgentExecutionRateLimitRule,
  ) => Promise<AgentExecutionRateLimitResult>;
  audit: (event: AgentExecutionAuditEvent) => void | Promise<void>;
  execute: (context: AgentExecutionContext) => Result | Promise<Result>;
  onAuditError?: (
    error: unknown,
    event: AgentExecutionAuditEvent,
  ) => void | Promise<void>;
  rateLimitKeyPrefix?: string;
  sourceIpHeader?: string;
};

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function rateLimitKey(
  prefix: string,
  dimension: AgentExecutionRateLimitDimension,
  subject: string,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${dimension}\0${subject}`),
  );
  return `${prefix}:${dimension}:${bytesToHex(digest)}`;
}

function rateLimitSubjects(
  capability: string,
  agentSession: AgentSession,
  headers: Headers | undefined,
  sourceIpHeader: string,
): Partial<Record<AgentExecutionRateLimitDimension, string>> {
  const sourceIp = headers?.get(sourceIpHeader)?.trim();
  return {
    capability: `${agentSession.agent.id}\0${capability}`,
    agent: agentSession.agent.id,
    user: agentSession.userId ?? agentSession.user.id,
    host: agentSession.agent.hostId,
    ...(sourceIp ? { ip: sourceIp } : {}),
  };
}

export async function enforceAgentExecutionRateLimits(
  input: Pick<
    AgentExecutionGuardOptions<unknown>,
    "consumeRateLimit" | "limits" | "rateLimitKeyPrefix" | "sourceIpHeader"
  > & {
    capability: string;
    agentSession: AgentSession;
    headers?: Headers;
  },
): Promise<AgentExecutionRateLimit | null> {
  const prefix = input.rateLimitKeyPrefix ?? DEFAULT_RATE_LIMIT_KEY_PREFIX;
  const subjects = rateLimitSubjects(
    input.capability,
    input.agentSession,
    input.headers,
    input.sourceIpHeader ?? DEFAULT_SOURCE_IP_HEADER,
  );
  const results = await Promise.all(
    RATE_LIMIT_DIMENSIONS.flatMap((dimension) => {
      const subject = subjects[dimension];
      if (!subject) return [];
      return [
        (async () => ({
          dimension,
          result: await input.consumeRateLimit(
            await rateLimitKey(prefix, dimension, subject),
            input.limits[dimension],
          ),
        }))(),
      ];
    }),
  );
  const limited = results.find(({ result }) => !result.allowed);
  return limited
    ? { dimension: limited.dimension, retryAfter: limited.result.retryAfter }
    : null;
}

function correlationId(ctx: AgentExecutionContext["ctx"]): string {
  const supplied = ctx.headers?.get("x-request-id")?.trim();
  const existing = ctx.responseHeaders?.get("x-request-id")?.trim();
  const value =
    (supplied && REQUEST_ID_PATTERN.test(supplied) ? supplied : undefined) ??
    (existing && REQUEST_ID_PATTERN.test(existing) ? existing : undefined) ??
    crypto.randomUUID();
  ctx.setHeader?.("X-Request-ID", value);
  return value;
}

function auditEvent(
  context: AgentExecutionContext,
  correlationId: string,
  outcome: AgentExecutionAuditEvent["outcome"],
  durationMs: number,
): AgentExecutionAuditEvent {
  return {
    eventType: "capability.executed",
    actorType: "agent",
    actorId: context.agentSession.agent.id,
    userId: context.agentSession.userId ?? context.agentSession.user.id,
    agentId: context.agentSession.agent.id,
    hostId: context.agentSession.agent.hostId,
    capability: context.capability,
    outcome,
    durationMs,
    correlationId,
  };
}

async function recordAudit<Result>(
  options: AgentExecutionGuardOptions<Result>,
  event: AgentExecutionAuditEvent,
): Promise<void> {
  try {
    await options.audit(event);
  } catch (error) {
    if (options.onAuditError) {
      await options.onAuditError(error, event);
      return;
    }
    throw error;
  }
}

export function createAgentExecutionHandler<Result>(
  options: AgentExecutionGuardOptions<Result>,
): NonNullable<AgentAuthOptions["onExecute"]> {
  return async (context) => {
    const startedAt = Date.now();
    const requestId = correlationId(context.ctx);
    const limited = await enforceAgentExecutionRateLimits({
      limits: options.limits,
      consumeRateLimit: options.consumeRateLimit,
      rateLimitKeyPrefix: options.rateLimitKeyPrefix,
      sourceIpHeader: options.sourceIpHeader,
      capability: context.capability,
      agentSession: context.agentSession,
      headers: context.ctx.headers,
    });

    if (limited) {
      await recordAudit(
        options,
        auditEvent(
          context,
          requestId,
          `rate_limited:${limited.dimension}`,
          Date.now() - startedAt,
        ),
      );
      throw agentError(
        "TOO_MANY_REQUESTS",
        AGENT_AUTH_ERROR_CODES.RATE_LIMITED,
        `Agent execution ${limited.dimension} limit exceeded. Retry after ${limited.retryAfter} seconds.`,
        {
          "Retry-After": String(limited.retryAfter),
          "X-Request-ID": requestId,
        },
        {
          correlation_id: requestId,
          limit: limited.dimension,
          retry_after: limited.retryAfter,
        },
      );
    }

    let result: Awaited<Result>;
    try {
      result = await options.execute(context);
    } catch (error) {
      await recordAudit(
        options,
        auditEvent(context, requestId, "error", Date.now() - startedAt),
      );
      throw error;
    }
    await recordAudit(
      options,
      auditEvent(context, requestId, "success", Date.now() - startedAt),
    );
    return result;
  };
}
