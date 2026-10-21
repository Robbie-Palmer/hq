import { z } from "zod";
import { AccountIdSchema } from "./account";

export const BalanceSnapshotSchema = z.object({
  accountId: AccountIdSchema,
  date: z.iso.date(),
  balance: z.number(),
});

export type BalanceSnapshot = z.infer<typeof BalanceSnapshotSchema>;
