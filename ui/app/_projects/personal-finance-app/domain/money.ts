import { z } from "zod";
import { type Currency, CurrencySchema } from "./currency";

export const MoneySchema = z.object({
  amount: z.number(),
  currency: CurrencySchema,
});
export type Money = z.infer<typeof MoneySchema>;

export const PositiveMoneySchema = MoneySchema.extend({
  amount: z.number().positive(),
});

export const NonNegativeMoneySchema = MoneySchema.extend({
  amount: z.number().nonnegative(),
});

export function money(amount: number, currency: Currency): Money {
  return MoneySchema.parse({ amount, currency });
}
