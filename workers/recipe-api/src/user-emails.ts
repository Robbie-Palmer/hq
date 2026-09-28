import { and, eq, ne } from "drizzle-orm";
import { GithubClient } from "github-client";
import type { Db } from "recipe-db";
import * as schema from "recipe-db/schema";
type UserEmailIdentity = {
  id: string;
  email: string;
  emailVerified: boolean;
};
type LinkedAccountIdentity = {
  providerId: string;
  userId: string;
  accessToken?: string | null;
  idToken?: string | null;
};
type Fetch = typeof fetch;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function canonicalEmailIsAvailable(
  db: Db,
  email: string,
): Promise<boolean> {
  const [existing] = await db
    .select({ userId: schema.userEmail.userId })
    .from(schema.userEmail)
    .where(eq(schema.userEmail.email, normalizeEmail(email)))
    .limit(1);
  return !existing;
}

export async function verifiedEmailOwnerId(
  db: Db,
  email: string,
): Promise<string | undefined> {
  const [owner] = await db
    .select({ userId: schema.userEmail.userId })
    .from(schema.userEmail)
    .where(
      and(
        eq(schema.userEmail.email, normalizeEmail(email)),
        eq(schema.userEmail.verified, true),
      ),
    )
    .limit(1);
  return owner?.userId;
}

// Better Auth verifies Google's issuer, audience, signature, expiry, and nonce
// before persisting the token and invoking the account database hook.
function googleEmailFromVerifiedIdToken(
  idToken: string | null | undefined,
): string[] {
  if (!idToken) return [];
  try {
    const encodedPayload = idToken.split(".")[1];
    if (!encodedPayload) return [];
    const unpadded = encodedPayload.replaceAll("-", "+").replaceAll("_", "/");
    const base64 = unpadded.padEnd(
      unpadded.length + ((4 - (unpadded.length % 4)) % 4),
      "=",
    );
    const payload = JSON.parse(atob(base64)) as {
      email?: unknown;
      email_verified?: unknown;
    };
    return payload.email_verified === true && typeof payload.email === "string"
      ? [normalizeEmail(payload.email)]
      : [];
  } catch {
    return [];
  }
}

async function githubEmails(
  accessToken: string | null | undefined,
  fetchImpl: Fetch,
): Promise<string[]> {
  if (!accessToken) return [];
  let body: unknown;
  try {
    body = await new GithubClient(accessToken, {
      userAgent: "personal-site-recipe-api",
      fetch: fetchImpl,
      retries: 1,
    }).request("GET", "/user/emails");
  } catch {
    return [];
  }
  if (!Array.isArray(body)) return [];
  return body.flatMap((candidate) => {
    if (
      typeof candidate === "object" &&
      candidate !== null &&
      "email" in candidate &&
      "verified" in candidate &&
      typeof candidate.email === "string" &&
      candidate.verified === true
    ) {
      return [normalizeEmail(candidate.email)];
    }
    return [];
  });
}

export async function verifiedEmailsFromLinkedAccount(
  account: LinkedAccountIdentity,
  fetchImpl: Fetch = fetch,
): Promise<string[]> {
  if (account.providerId === "google") {
    return googleEmailFromVerifiedIdToken(account.idToken);
  }
  if (account.providerId === "github") {
    return githubEmails(account.accessToken, fetchImpl);
  }
  return [];
}

export async function syncLinkedAccountEmails(
  db: Db,
  account: LinkedAccountIdentity,
) {
  try {
    const emails = await verifiedEmailsFromLinkedAccount(account);
    await Promise.all(
      [...new Set(emails)].map(async (email) => {
        const [existing] = await db
          .select({ userId: schema.userEmail.userId })
          .from(schema.userEmail)
          .where(eq(schema.userEmail.email, email))
          .limit(1);
        if (existing && existing.userId !== account.userId) return;
        if (existing) {
          await db
            .update(schema.userEmail)
            .set({ verified: true })
            .where(
              and(
                eq(schema.userEmail.email, email),
                eq(schema.userEmail.userId, account.userId),
              ),
            );
          return;
        }
        await db
          .insert(schema.userEmail)
          .values({
            email,
            userId: account.userId,
            verified: true,
            isPrimary: false,
          })
          .onConflictDoNothing({ target: schema.userEmail.email });
      }),
    );
  } catch (error) {
    // Provider lookup failure must not break sign-in. Account update hooks retry
    // the lookup on later sign-ins when Better Auth refreshes OAuth tokens.
    console.error("Unable to sync linked account emails", error);
  }
}

export async function syncCanonicalUserEmail(
  db: Db,
  user: UserEmailIdentity,
) {
  const email = normalizeEmail(user.email);
  await db.transaction(async (tx) => {
    const [registered] = await tx
      .insert(schema.userEmail)
      .values({
        email,
        userId: user.id,
        verified: user.emailVerified,
        isPrimary: true,
      })
      .onConflictDoUpdate({
        target: schema.userEmail.email,
        set: { verified: user.emailVerified, isPrimary: true },
        setWhere: eq(schema.userEmail.userId, user.id),
      })
      .returning({ userId: schema.userEmail.userId });
    if (registered?.userId !== user.id) {
      throw new Error("Canonical email is already owned by another account");
    }

    await tx
      .update(schema.userEmail)
      .set({ isPrimary: false })
      .where(
        and(
          eq(schema.userEmail.userId, user.id),
          ne(schema.userEmail.email, email),
        ),
      );
  });
}

export async function verifiedEmailsForUser(
  db: Db,
  user: UserEmailIdentity,
): Promise<string[]> {
  const emails = await db
    .select({ email: schema.userEmail.email })
    .from(schema.userEmail)
    .where(
      and(
        eq(schema.userEmail.userId, user.id),
        eq(schema.userEmail.verified, true),
      ),
    );
  return emails.map(({ email }) => email);
}

export async function userOwnsVerifiedEmail(
  db: Db,
  user: UserEmailIdentity,
  email: string,
): Promise<boolean> {
  const verifiedEmails = await verifiedEmailsForUser(db, user);
  return verifiedEmails.includes(normalizeEmail(email));
}
