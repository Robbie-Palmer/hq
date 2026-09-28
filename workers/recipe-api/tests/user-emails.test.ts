import { describe, expect, it, vi } from "vitest";
import type { Db } from "recipe-db";
import {
  syncCanonicalUserEmail,
  verifiedEmailsFromLinkedAccount,
} from "../src/user-emails";

function googleIdToken(payload: Record<string, unknown>): string {
  const encoded = btoa(JSON.stringify(payload))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  return `header.${encoded}.signature`;
}

function canonicalEmailDb(registeredUserId?: string) {
  const returning = vi
    .fn()
    .mockResolvedValue(registeredUserId ? [{ userId: registeredUserId }] : []);
  const onConflictDoUpdate = vi.fn(() => ({ returning }));
  const values = vi.fn(() => ({ onConflictDoUpdate }));
  const insert = vi.fn(() => ({ values }));
  const where = vi.fn().mockResolvedValue([]);
  const set = vi.fn(() => ({ where }));
  const update = vi.fn(() => ({ set }));
  const transaction = vi.fn(async (operation: (tx: unknown) => unknown) =>
    operation({ insert, update }),
  );
  return {
    db: { transaction } as unknown as Db,
    insert,
    onConflictDoUpdate,
    returning,
    transaction,
    update,
    values,
  };
}

describe("canonical user email", () => {
  it("upserts the canonical address before clearing the old primary", async () => {
    const fake = canonicalEmailDb("user-1");

    await syncCanonicalUserEmail(fake.db, {
      id: "user-1",
      email: "New@Example.test",
      emailVerified: true,
    });

    expect(fake.transaction).toHaveBeenCalledTimes(1);
    expect(fake.values).toHaveBeenCalledWith({
      email: "new@example.test",
      userId: "user-1",
      verified: true,
      isPrimary: true,
    });
    expect(fake.onConflictDoUpdate).toHaveBeenCalledOnce();
    expect(fake.update).toHaveBeenCalledOnce();
    expect(fake.returning.mock.invocationCallOrder[0]).toBeLessThan(
      fake.update.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it("does not clear the old primary when another user owns the address", async () => {
    const fake = canonicalEmailDb();

    await expect(
      syncCanonicalUserEmail(fake.db, {
        id: "user-1",
        email: "claimed@example.test",
        emailVerified: true,
      }),
    ).rejects.toThrow("Canonical email is already owned by another account");

    expect(fake.update).not.toHaveBeenCalled();
  });
});

describe("linked account emails", () => {
  it("reads a verified email from a Google ID token", async () => {
    const emails = await verifiedEmailsFromLinkedAccount({
      providerId: "google",
      userId: "user-1",
      idToken: googleIdToken({
        email: "Alias@Example.test",
        email_verified: true,
      }),
    });

    expect(emails).toEqual(["alias@example.test"]);
  });

  it("ignores an unverified email from a Google ID token", async () => {
    const emails = await verifiedEmailsFromLinkedAccount({
      providerId: "google",
      userId: "user-1",
      idToken: googleIdToken({
        email: "alias@example.test",
        email_verified: false,
      }),
    });

    expect(emails).toEqual([]);
  });

  it("keeps only verified GitHub account emails", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify([
            { email: "First@Example.test", verified: true },
            { email: "unverified@example.test", verified: false },
            { email: "second@example.test", verified: true },
          ]),
          { status: 200 },
        ),
      ),
    );

    const emails = await verifiedEmailsFromLinkedAccount(
      {
        providerId: "github",
        userId: "user-1",
        accessToken: "token",
      },
      fetchImpl,
    );

    expect(emails).toEqual(["first@example.test", "second@example.test"]);
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("https://api.github.com/user/emails"),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer token" }),
      }),
    );
  });
});
