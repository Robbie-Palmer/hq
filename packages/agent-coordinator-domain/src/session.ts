import { z } from "zod";

import {
  AGENT_COORDINATOR_CONTRACT_VERSION,
  findDuplicates,
  IdentifierSchema,
} from "./vocabulary";

export const WorkerAdapterIdentitySchema = z
  .object({
    schemaVersion: z.literal(AGENT_COORDINATOR_CONTRACT_VERSION),
    recordType: z.literal("worker-adapter"),
    adapterId: IdentifierSchema,
    adapterVersion: z.string().trim().min(1).max(80),
    actorId: IdentifierSchema,
    adapterKind: z.enum(["human", "native-client", "api-runner"]),
    authenticationPathId: IdentifierSchema,
    tools: z.array(IdentifierSchema),
    evidenceKinds: z.array(IdentifierSchema),
    supportsCheckpointing: z.boolean(),
  })
  .strict()
  .superRefine((adapter, context) => {
    for (const [field, values] of [
      ["tools", adapter.tools],
      ["evidenceKinds", adapter.evidenceKinds],
    ] as const) {
      const duplicates = findDuplicates(values);
      if (duplicates.length === 0) continue;
      context.addIssue({
        code: "custom",
        message: `${field} contains duplicate values: ${duplicates.join(", ")}`,
        path: [field],
      });
    }
  });
export type WorkerAdapterIdentity = z.infer<
  typeof WorkerAdapterIdentitySchema
>;

export const ExecutionSessionIdentitySchema = z
  .object({
    schemaVersion: z.literal(AGENT_COORDINATOR_CONTRACT_VERSION),
    recordType: z.literal("execution-session"),
    sessionId: IdentifierSchema,
    taskId: IdentifierSchema,
    actorId: IdentifierSchema,
    adapterId: IdentifierSchema,
    adapterVersion: z.string().trim().min(1).max(80),
    authenticationPathId: IdentifierSchema,
    startedAt: z.iso.datetime(),
    workGraphLeaseId: z.uuid().optional(),
    predecessorSessionId: IdentifierSchema.optional(),
  })
  .strict()
  .refine(
    ({ predecessorSessionId, sessionId }) =>
      predecessorSessionId !== sessionId,
    {
      message: "a session cannot name itself as its predecessor",
      path: ["predecessorSessionId"],
    },
  );
export type ExecutionSessionIdentity = z.infer<
  typeof ExecutionSessionIdentitySchema
>;

export const RoutingStateSchema = z
  .object({
    activeSessions: z.number().int().nonnegative(),
    activeSessionsForActor: z.number().int().nonnegative(),
    activeSessionsForWorkClass: z.number().int().nonnegative(),
  })
  .strict();
export type RoutingState = z.infer<typeof RoutingStateSchema>;
