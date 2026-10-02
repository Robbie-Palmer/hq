import { describe, expect, it } from "vitest";
import {
  createAgentAuthSecondaryStorage,
  createBetterAuthRateLimitStorage,
  type AgentAuthSecondaryStorageAdapter,
  type SecondaryStorageEntry,
} from "../src/storage";

describe("Better Auth rate-limit storage", () => {
  it("namespaces keys and translates Better Auth rules", async () => {
    const calls: Array<{ key: string; max: number; windowSeconds: number }> = [];
    const storage = createBetterAuthRateLimitStorage({
      namespace: "auth",
      adapter: {
        consume: async (key, rule) => {
          calls.push({ key, ...rule });
          return { allowed: false, retryAfter: 15 };
        },
        get: async () => ({ count: 2, lastRequest: 100 }),
        set: async () => {},
      },
    });

    await expect(
      storage.consume("sign-in", { max: 5, window: 60 }),
    ).resolves.toEqual({ allowed: false, retryAfter: 15 });
    await expect(storage.get("sign-in")).resolves.toEqual({
      key: "sign-in",
      count: 2,
      lastRequest: 100,
    });
    expect(calls).toEqual([
      { key: "auth:sign-in", max: 5, windowSeconds: 60 },
    ]);
  });
});

function secondaryAdapter() {
  const entries = new Map<string, SecondaryStorageEntry>();
  const adapter: AgentAuthSecondaryStorageAdapter = {
    read: async (key) => entries.get(key) ?? null,
    reserve: async (key, value, expiresAt, now) => {
      for (const [storedKey, entry] of entries) {
        if (entry.expiresAt && entry.expiresAt <= now) entries.delete(storedKey);
      }
      if (entries.has(key)) return false;
      entries.set(key, { value, expiresAt });
      return true;
    },
    takeLive: async (key, now) => {
      const entry = entries.get(key);
      if (!entry || (entry.expiresAt && entry.expiresAt <= now)) return null;
      entries.delete(key);
      return entry.value;
    },
    increment: async (key, expiresAt) => {
      const entry = entries.get(key);
      const value = Number(entry?.value ?? 0) + 1;
      entries.set(key, { value: String(value), expiresAt });
      return value;
    },
    write: async (key, value, expiresAt) => {
      entries.set(key, { value, expiresAt });
    },
    delete: async (key) => {
      entries.delete(key);
    },
  };
  return { adapter, entries };
}

describe("Agent Auth secondary storage", () => {
  it("reserves replay keys and handles expiring values", async () => {
    const { adapter, entries } = secondaryAdapter();
    const storage = createAgentAuthSecondaryStorage({ adapter });

    await expect(storage.get("agent-auth:jti:one")).resolves.toBeNull();
    await expect(storage.get("agent-auth:jti:one")).resolves.toBe("1");

    await storage.set("cache:key", "value", 60);
    await expect(storage.get("cache:key")).resolves.toBe("value");
    entries.set("cache:expired", {
      value: "old",
      expiresAt: new Date(Date.now() - 1),
    });
    await expect(storage.get("cache:expired")).resolves.toBeNull();
    expect(entries.has("cache:expired")).toBe(false);
  });

  it("supports atomic take, increment, bounded writes, and delete", async () => {
    const { adapter, entries } = secondaryAdapter();
    const storage = createAgentAuthSecondaryStorage({
      adapter,
      defaultTtlSeconds: 30,
      maxTtlSeconds: 60,
    });

    await storage.set("take:key", "value");
    await expect(storage.getAndDelete("take:key")).resolves.toBe("value");
    await expect(storage.getAndDelete("take:key")).resolves.toBeNull();
    await expect(storage.increment("counter", 60)).resolves.toBe(1);
    await expect(storage.increment("counter", 60)).resolves.toBe(2);
    await storage.set("bounded", "value", 600);
    const ttl = (entries.get("bounded")?.expiresAt?.getTime() ?? 0) - Date.now();
    expect(ttl).toBeGreaterThan(59_000);
    expect(ttl).toBeLessThanOrEqual(60_000);
    await storage.delete("bounded");
    expect(entries.has("bounded")).toBe(false);
  });
});
