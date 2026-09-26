import { z } from "zod";

export const AGENT_COORDINATOR_CONTRACT_VERSION = 1 as const;

export const IdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9][a-z0-9._:/-]*$/);

export const CurrencySchema = z.string().regex(/^[A-Z]{3}$/);

export const MoneySchema = z
  .object({
    currency: CurrencySchema,
    amount: z.number().nonnegative(),
  })
  .strict();
export type Money = z.infer<typeof MoneySchema>;

export const CapabilityLevelSchema = z.number().int().min(1).max(5);

export const ResourceQuantitySchema = z
  .object({
    resource: IdentifierSchema,
    amount: z.number().nonnegative(),
    unit: IdentifierSchema,
  })
  .strict();
export type ResourceQuantity = z.infer<typeof ResourceQuantitySchema>;

export const EvidenceStageSchema = z.enum([
  "claim",
  "checkpoint",
  "completion",
]);

export function findDuplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort((left, right) => left.localeCompare(right, "en"));
}

export function compareIdentifiers(left: string, right: string): number {
  return left.localeCompare(right, "en");
}
