import { z } from "zod";

import {
  AGENT_COORDINATOR_CONTRACT_VERSION,
  findDuplicates,
  IdentifierSchema,
  MoneySchema,
} from "./vocabulary";

export const WorkClassConcurrencyLimitSchema = z
  .object({
    workClass: IdentifierSchema,
    maximumActiveSessions: z.number().int().nonnegative(),
  })
  .strict();

export const BudgetLimitSchema = z
  .object({
    workClass: IdentifierSchema,
    maximumPerSession: MoneySchema,
    remaining: MoneySchema,
  })
  .strict()
  .refine(
    ({ maximumPerSession, remaining }) =>
      maximumPerSession.currency === remaining.currency,
    {
      message: "maximumPerSession and remaining must use the same currency",
      path: ["remaining", "currency"],
    },
  );

export const OwnerPolicySchema = z
  .object({
    schemaVersion: z.literal(AGENT_COORDINATOR_CONTRACT_VERSION),
    recordType: z.literal("owner-policy"),
    policyId: IdentifierSchema,
    ownerId: IdentifierSchema,
    revision: z.number().int().positive(),
    allowedAuthenticationPaths: z.array(IdentifierSchema).min(1),
    allowedAuthority: z.array(IdentifierSchema),
    allowedWorkClasses: z.array(IdentifierSchema).min(1),
    budgets: z.array(BudgetLimitSchema),
    concurrency: z
      .object({
        maximumActiveSessions: z.number().int().nonnegative(),
        maximumActiveSessionsPerActor: z.number().int().nonnegative(),
        workClasses: z.array(WorkClassConcurrencyLimitSchema),
      })
      .strict(),
  })
  .strict()
  .superRefine((policy, context) => {
    const duplicateGroups: Array<[string, string[]]> = [
      [
        "allowedAuthenticationPaths",
        findDuplicates(policy.allowedAuthenticationPaths),
      ],
      ["allowedAuthority", findDuplicates(policy.allowedAuthority)],
      ["allowedWorkClasses", findDuplicates(policy.allowedWorkClasses)],
      [
        "budgets",
        findDuplicates(policy.budgets.map(({ workClass }) => workClass)),
      ],
      [
        "concurrency.workClasses",
        findDuplicates(
          policy.concurrency.workClasses.map(({ workClass }) => workClass),
        ),
      ],
    ];
    for (const [field, duplicates] of duplicateGroups) {
      if (duplicates.length === 0) continue;
      context.addIssue({
        code: "custom",
        message: `${field} contains duplicate values: ${duplicates.join(", ")}`,
        path: field.split("."),
      });
    }

    const allowedWorkClasses = new Set(policy.allowedWorkClasses);
    const unknownBudgetClasses = policy.budgets
      .map(({ workClass }) => workClass)
      .filter((workClass) => !allowedWorkClasses.has(workClass));
    const unknownConcurrencyClasses = policy.concurrency.workClasses
      .map(({ workClass }) => workClass)
      .filter((workClass) => !allowedWorkClasses.has(workClass));

    for (const [field, values] of [
      ["budgets", unknownBudgetClasses],
      ["concurrency", unknownConcurrencyClasses],
    ] as const) {
      if (values.length === 0) continue;
      context.addIssue({
        code: "custom",
        message: `${field} references disallowed work classes: ${values.join(", ")}`,
        path: [field],
      });
    }
  });
export type OwnerPolicy = z.infer<typeof OwnerPolicySchema>;
