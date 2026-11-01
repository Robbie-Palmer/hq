import { z } from "zod";
import {
  IdentifierSchema,
  SideIncomeCaseSchema,
  TimestampSchema,
  type SideIncomeCase,
} from "./sideIncome";

export const SideIncomeScopeSchema = z.enum([
  "side-income:read",
  "side-income:write",
  "side-income:import",
  "side-income:export",
  "side-income:correct",
]);
export type SideIncomeScope = z.infer<typeof SideIncomeScopeSchema>;

export const SideIncomeAuthorizationSchema = z
  .object({
    actorId: IdentifierSchema,
    householdId: IdentifierSchema,
    grantedScopes: z.array(SideIncomeScopeSchema),
    authorizedAt: TimestampSchema,
    expiresAt: TimestampSchema,
  })
  .strict()
  .refine((authorization) => authorization.authorizedAt < authorization.expiresAt, {
    message: "Authorization must expire after it is granted",
    path: ["expiresAt"],
  });
export type SideIncomeAuthorization = z.infer<
  typeof SideIncomeAuthorizationSchema
>;

export function requireSideIncomeScope(
  value: SideIncomeAuthorization,
  requiredScope: SideIncomeScope,
  householdId: string,
  at: string,
): SideIncomeAuthorization {
  const authorization = SideIncomeAuthorizationSchema.parse(value);
  const timestamp = TimestampSchema.parse(at);
  if (authorization.householdId !== householdId) {
    throw new Error("Authorization does not cover this household");
  }
  if (!authorization.grantedScopes.includes(requiredScope)) {
    throw new Error(`Authorization does not grant ${requiredScope}`);
  }
  if (timestamp < authorization.authorizedAt || timestamp >= authorization.expiresAt) {
    throw new Error("Authorization is not active");
  }
  return authorization;
}

export const SideIncomeCaseRevisionSchema = z
  .object({
    case: SideIncomeCaseSchema,
    revision: z.number().int().positive(),
    persistedAt: TimestampSchema,
    supersedesRevision: z.number().int().positive().nullable(),
    correctionReason: z.string().trim().min(1).nullable(),
  })
  .strict()
  .superRefine((revision, context) => {
    const isCorrection = revision.supersedesRevision !== null;
    if (isCorrection !== (revision.correctionReason !== null)) {
      context.addIssue({
        code: "custom",
        message: "A correction needs both a superseded revision and a reason",
        path: ["correctionReason"],
      });
    }
    if (
      revision.supersedesRevision !== null &&
      revision.supersedesRevision >= revision.revision
    ) {
      context.addIssue({
        code: "custom",
        message: "A correction must supersede an earlier revision",
        path: ["supersedesRevision"],
      });
    }
  });
export type SideIncomeCaseRevision = z.infer<
  typeof SideIncomeCaseRevisionSchema
>;

export const SideIncomeImportRequestSchema = z
  .object({
    authorization: SideIncomeAuthorizationSchema,
    mode: z.enum(["validate-only", "append"]),
    conflictPolicy: z.literal("reject"),
    importedAt: TimestampSchema,
    cases: z.array(SideIncomeCaseSchema).min(1),
  })
  .strict()
  .superRefine((request, context) => {
    if (!request.authorization.grantedScopes.includes("side-income:import")) {
      context.addIssue({
        code: "custom",
        message: "Import scope is required",
        path: ["authorization", "grantedScopes"],
      });
    }
    request.cases.forEach((sideIncomeCase, index) => {
      if (sideIncomeCase.householdId !== request.authorization.householdId) {
        context.addIssue({
          code: "custom",
          message: "Imported cases must belong to the authorized household",
          path: ["cases", index, "householdId"],
        });
      }
    });
    if (
      request.importedAt < request.authorization.authorizedAt ||
      request.importedAt >= request.authorization.expiresAt
    ) {
      context.addIssue({
        code: "custom",
        message: "Import authorization is not active",
        path: ["importedAt"],
      });
    }
  });
export type SideIncomeImportRequest = z.infer<
  typeof SideIncomeImportRequestSchema
>;

export const SideIncomeImportResultSchema = z
  .object({
    acceptedCaseIds: z.array(IdentifierSchema),
    rejected: z.array(
      z
        .object({
          caseId: IdentifierSchema,
          code: z.enum([
            "unauthorized",
            "household-mismatch",
            "duplicate-case",
            "invalid-contract",
          ]),
          detail: z.string().trim().min(1),
        })
        .strict(),
    ),
  })
  .strict();
export type SideIncomeImportResult = z.infer<
  typeof SideIncomeImportResultSchema
>;

export const SideIncomeCorrectionCommandSchema = z
  .object({
    authorization: SideIncomeAuthorizationSchema,
    caseId: IdentifierSchema,
    expectedRevision: z.number().int().positive(),
    replacement: SideIncomeCaseSchema,
    reason: z.string().trim().min(1).max(1_000),
    correctedAt: TimestampSchema,
  })
  .strict()
  .superRefine((command, context) => {
    if (command.replacement.id !== command.caseId) {
      context.addIssue({
        code: "custom",
        message: "A correction cannot change the case identity",
        path: ["replacement", "id"],
      });
    }
    if (command.replacement.householdId !== command.authorization.householdId) {
      context.addIssue({
        code: "custom",
        message: "The replacement must belong to the authorized household",
        path: ["replacement", "householdId"],
      });
    }
    if (!command.authorization.grantedScopes.includes("side-income:correct")) {
      context.addIssue({
        code: "custom",
        message: "Correction scope is required",
        path: ["authorization", "grantedScopes"],
      });
    }
    if (
      command.correctedAt < command.authorization.authorizedAt ||
      command.correctedAt >= command.authorization.expiresAt
    ) {
      context.addIssue({
        code: "custom",
        message: "Correction authorization is not active",
        path: ["correctedAt"],
      });
    }
  });
export type SideIncomeCorrectionCommand = z.infer<
  typeof SideIncomeCorrectionCommandSchema
>;

export const SideIncomeExportRequestSchema = z
  .object({
    authorization: SideIncomeAuthorizationSchema,
    requestedAt: TimestampSchema,
    caseIds: z.array(IdentifierSchema),
    includeRevisionHistory: z.boolean(),
  })
  .strict()
  .superRefine((request, context) => {
    if (!request.authorization.grantedScopes.includes("side-income:export")) {
      context.addIssue({
        code: "custom",
        message: "Export scope is required",
        path: ["authorization", "grantedScopes"],
      });
    }
    if (
      request.requestedAt < request.authorization.authorizedAt ||
      request.requestedAt >= request.authorization.expiresAt
    ) {
      context.addIssue({
        code: "custom",
        message: "Export authorization is not active",
        path: ["requestedAt"],
      });
    }
  });
export type SideIncomeExportRequest = z.infer<
  typeof SideIncomeExportRequestSchema
>;

export const SideIncomeExportEnvelopeSchema = z
  .object({
    format: z.literal("personal-finance-side-income"),
    formatVersion: z.literal(1),
    householdId: IdentifierSchema,
    exportedAt: TimestampSchema,
    revisions: z.array(SideIncomeCaseRevisionSchema),
  })
  .strict();
export type SideIncomeExportEnvelope = z.infer<
  typeof SideIncomeExportEnvelopeSchema
>;

export interface SideIncomeRepository {
  append(
    authorization: SideIncomeAuthorization,
    value: SideIncomeCase,
  ): Promise<SideIncomeCaseRevision>;
  readLatest(
    authorization: SideIncomeAuthorization,
    caseId: string,
  ): Promise<SideIncomeCaseRevision | null>;
  correct(command: SideIncomeCorrectionCommand): Promise<SideIncomeCaseRevision>;
  import(request: SideIncomeImportRequest): Promise<SideIncomeImportResult>;
  export(request: SideIncomeExportRequest): Promise<SideIncomeExportEnvelope>;
}
