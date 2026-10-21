import { z } from "zod";
import { AccountIdSchema } from "./account";

export const CapitalFlowKindSchema = z.enum([
  "personalSaving",
  "debtPrincipal",
  "external",
]);
export type CapitalFlowKind = z.infer<typeof CapitalFlowKindSchema>;

/** Old saved data predates classifications and represents personal saving. */
export function capitalFlowKind(
  flow: Pick<CapitalFlow, "kind">,
): CapitalFlowKind {
  return flow.kind ?? "personalSaving";
}

/**
 * A signed change in the capital contributed to an account since the previous
 * observation. Deposits are positive and withdrawals are negative. Keeping
 * this separate from market value lets the tracker distinguish investment
 * performance from money the user moved in or out.
 */
export const CapitalFlowSchema = z.object({
  accountId: AccountIdSchema,
  date: z.iso.date(),
  amount: z.number(),
  /** How this capital should affect income and spending reconciliation. */
  kind: CapitalFlowKindSchema.optional(),
});

export type CapitalFlow = z.infer<typeof CapitalFlowSchema>;
