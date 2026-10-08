import { z } from "zod";

export const SUPPORTED_CURRENCIES = ["GBP", "USD", "EUR"] as const;
export const CurrencySchema = z.enum(SUPPORTED_CURRENCIES);
export type Currency = z.infer<typeof CurrencySchema>;

export const DEFAULT_BASE_CURRENCY: Currency = "GBP";
