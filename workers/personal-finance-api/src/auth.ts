import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { betterAuth } from "better-auth";
import type { RuntimeDatabase } from "personal-finance-data";
import { schema } from "personal-finance-data/schema";

export type AuthEnv = {
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
};

export function createAuth(db: RuntimeDatabase, env: AuthEnv) {
  const baseURL = new URL(env.BETTER_AUTH_URL).origin;
  return betterAuth({
    baseURL,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [baseURL],
    database: drizzleAdapter(db, { provider: "pg", schema }),
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      },
    },
    advanced: {
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
        secure: baseURL.startsWith("https://"),
      },
    },
  });
}

export type RuntimeAuth = ReturnType<typeof createAuth>;
export type AuthenticatedSession = NonNullable<
  Awaited<ReturnType<RuntimeAuth["api"]["getSession"]>>
>;
