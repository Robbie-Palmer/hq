import { z } from "zod";
import { AccountIdSchema } from "./account";

export const PlannedExpenditureSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  amount: z.number().positive(),
  date: z.iso.date(),
  fromAccountId: AccountIdSchema,
});

export type PlannedExpenditure = z.infer<typeof PlannedExpenditureSchema>;
