export type BetterAuthRateLimitRule = { window: number; max: number };
export type BetterAuthRateLimitValue = {
  key: string;
  count: number;
  lastRequest: number;
};

export type RateLimitStorageAdapter = {
  consume: (
    key: string,
    rule: { max: number; windowSeconds: number },
  ) => Promise<{ allowed: boolean; retryAfter: number }>;
  get: (
    key: string,
  ) => Promise<{ count: number; lastRequest: number } | undefined>;
  set: (
    key: string,
    value: { count: number; lastRequest: number },
  ) => Promise<void>;
};

export function createBetterAuthRateLimitStorage(options: {
  namespace: string;
  adapter: RateLimitStorageAdapter;
}) {
  const namespaced = (key: string) => `${options.namespace}:${key}`;
  return {
    consume: async (key: string, rule: BetterAuthRateLimitRule) => {
      const result = await options.adapter.consume(namespaced(key), {
        max: rule.max,
        windowSeconds: rule.window,
      });
      return {
        allowed: result.allowed,
        retryAfter: result.allowed ? null : result.retryAfter,
      };
    },
    get: async (key: string) => {
      const value = await options.adapter.get(namespaced(key));
      return value ? { key, ...value } : undefined;
    },
    set: async (key: string, value: BetterAuthRateLimitValue) =>
      options.adapter.set(namespaced(key), value),
  };
}

export type SecondaryStorageEntry = {
  value: string;
  expiresAt: Date | null;
};

export type AgentAuthSecondaryStorageAdapter = {
  read: (key: string) => Promise<SecondaryStorageEntry | null>;
  reserve: (
    key: string,
    value: string,
    expiresAt: Date,
    now: Date,
  ) => Promise<boolean>;
  takeLive: (key: string, now: Date) => Promise<string | null>;
  increment: (key: string, expiresAt: Date) => Promise<number>;
  write: (key: string, value: string, expiresAt: Date) => Promise<void>;
  delete: (key: string) => Promise<void>;
};

export type AgentAuthSecondaryStorageOptions = {
  adapter: AgentAuthSecondaryStorageAdapter;
  jtiPrefix?: string;
  jtiReservationTtlSeconds?: number;
  defaultTtlSeconds?: number;
  maxTtlSeconds?: number;
};

export function createAgentAuthSecondaryStorage(
  options: AgentAuthSecondaryStorageOptions,
) {
  const jtiPrefix = options.jtiPrefix ?? "agent-auth:jti:";
  const jtiReservationTtlSeconds = options.jtiReservationTtlSeconds ?? 120;
  const defaultTtlSeconds = options.defaultTtlSeconds ?? 30 * 24 * 60 * 60;
  const maxTtlSeconds = options.maxTtlSeconds ?? 90 * 24 * 60 * 60;

  return {
    get: async (key: string) => {
      if (key.startsWith(jtiPrefix)) {
        const now = new Date();
        const expiresAt = new Date(
          now.getTime() + jtiReservationTtlSeconds * 1_000,
        );
        const reserved = await options.adapter.reserve(
          key,
          "1",
          expiresAt,
          now,
        );
        return reserved ? null : "1";
      }
      const entry = await options.adapter.read(key);
      if (!entry) return null;
      if (entry.expiresAt && entry.expiresAt.getTime() <= Date.now()) {
        await options.adapter.delete(key);
        return null;
      }
      return entry.value;
    },
    getAndDelete: (key: string) =>
      options.adapter.takeLive(key, new Date()),
    increment: (key: string, ttlSeconds: number) =>
      options.adapter.increment(
        key,
        new Date(Date.now() + ttlSeconds * 1_000),
      ),
    set: async (key: string, value: string, ttlSeconds?: number) => {
      const boundedTtlSeconds =
        typeof ttlSeconds === "number" &&
        Number.isFinite(ttlSeconds) &&
        ttlSeconds > 0
          ? Math.min(ttlSeconds, maxTtlSeconds)
          : defaultTtlSeconds;
      await options.adapter.write(
        key,
        value,
        new Date(Date.now() + boundedTtlSeconds * 1_000),
      );
    },
    delete: (key: string) => options.adapter.delete(key),
  };
}
