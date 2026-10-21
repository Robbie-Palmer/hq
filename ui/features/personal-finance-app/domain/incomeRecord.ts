import { z } from "zod";
import { CurrencySchema, DEFAULT_BASE_CURRENCY } from "./currency";
import { MoneySchema } from "./money";

/**
 * Income received across the portfolio during the period ending on `date`.
 * This is deliberately portfolio-level: allocating salary to an account would
 * make internal transfers part of income and break the balance-sheet
 * reconciliation.
 */
export const IncomeRecordSchema = MoneySchema.extend({
  date: z.iso.date(),
  amount: z.number().nonnegative("Income cannot be negative"),
  currency: CurrencySchema.default(DEFAULT_BASE_CURRENCY),
});

export type IncomeRecord = z.infer<typeof IncomeRecordSchema>;
