import { z } from "zod";

import {
  AGENT_COORDINATOR_CONTRACT_VERSION,
  IdentifierSchema,
} from "./vocabulary";

export const AuthenticationApprovalBasisSchema = z
  .object({
    kind: z.enum(["provider-documentation", "written-provider-approval"]),
    referenceUrl: z.url(),
    reviewedAt: z.iso.datetime(),
  })
  .strict();

export const AuthenticationAllowlistEntrySchema = z
  .object({
    schemaVersion: z.literal(AGENT_COORDINATOR_CONTRACT_VERSION),
    recordType: z.literal("authentication-allowlist-entry"),
    authenticationPathId: IdentifierSchema,
    providerId: IdentifierSchema,
    routeKind: z.enum(["native-client", "direct-api", "api-gateway"]),
    accountClass: IdentifierSchema,
    approvalBasis: AuthenticationApprovalBasisSchema,
    enabled: z.boolean(),
    disabledAt: z.iso.datetime().optional(),
    disabledReason: z.string().trim().min(1).max(500).optional(),
  })
  .strict()
  .superRefine((entry, context) => {
    if (entry.enabled && (entry.disabledAt || entry.disabledReason)) {
      context.addIssue({
        code: "custom",
        message: "an enabled authentication path cannot have disable metadata",
        path: ["enabled"],
      });
    }
    if (!entry.enabled && (!entry.disabledAt || !entry.disabledReason)) {
      context.addIssue({
        code: "custom",
        message: "a disabled authentication path needs a date and reason",
        path: ["disabledAt"],
      });
    }
  });
export type AuthenticationAllowlistEntry = z.infer<
  typeof AuthenticationAllowlistEntrySchema
>;

export class AuthenticationNotAllowedError extends Error {
  readonly code = "authentication-not-allowed";

  constructor(readonly authenticationPathId: string) {
    super(`Authentication path ${authenticationPathId} is not enabled`);
    this.name = "AuthenticationNotAllowedError";
  }
}

export class AuthenticationAllowlist {
  readonly #entries = new Map<string, AuthenticationAllowlistEntry>();

  constructor(entries: readonly AuthenticationAllowlistEntry[]) {
    for (const candidate of entries) {
      const entry = AuthenticationAllowlistEntrySchema.parse(candidate);
      if (this.#entries.has(entry.authenticationPathId)) {
        throw new Error(
          `Duplicate authentication path ${entry.authenticationPathId}`,
        );
      }
      this.#entries.set(entry.authenticationPathId, freezeEntry(entry));
    }
  }

  get(authenticationPathId: string): AuthenticationAllowlistEntry | undefined {
    return this.#entries.get(authenticationPathId);
  }

  requireEnabled(authenticationPathId: string): AuthenticationAllowlistEntry {
    const entry = this.#entries.get(authenticationPathId);
    if (!entry?.enabled) {
      throw new AuthenticationNotAllowedError(authenticationPathId);
    }
    return entry;
  }

  disable(
    authenticationPathId: string,
    disabledAt: string,
    disabledReason: string,
  ): AuthenticationAllowlistEntry {
    const current = this.#entries.get(authenticationPathId);
    if (!current) {
      throw new AuthenticationNotAllowedError(authenticationPathId);
    }
    const disabled = AuthenticationAllowlistEntrySchema.parse({
      ...current,
      enabled: false,
      disabledAt,
      disabledReason,
    });
    const frozen = freezeEntry(disabled);
    this.#entries.set(authenticationPathId, frozen);
    return frozen;
  }
}

function freezeEntry(
  entry: AuthenticationAllowlistEntry,
): AuthenticationAllowlistEntry {
  Object.freeze(entry.approvalBasis);
  return Object.freeze(entry);
}
