import { z } from "zod";
import { CurrencySchema } from "./currency";

export const AccountIdSchema = z.string().min(1);
export type AccountId = z.infer<typeof AccountIdSchema>;

export const AssetTypeSchema = z.enum([
  "cash",
  "stocks",
  "bonds",
  "reits",
  "crypto",
  "property",
  "mortgage",
  "debt",
]);
export type AssetType = z.infer<typeof AssetTypeSchema>;

export const LiquidityTierSchema = z.enum(["cash", "liquid", "illiquid"]);
export type LiquidityTier = z.infer<typeof LiquidityTierSchema>;

export const LIQUIDITY_TIER_LABELS: Record<LiquidityTier, string> = {
  cash: "Cash",
  liquid: "Liquid investment",
  illiquid: "Illiquid asset",
};

/** Liabilities carry negative balances; their rate is the interest charged */
export function isLiability(assetType: AssetType): boolean {
  return assetType === "mortgage" || assetType === "debt";
}

/**
 * A change to the expected annual return from a given date, e.g. a savings
 * rate cut or a mortgage fix expiring. The account's base
 * expectedAnnualReturn applies before the first change.
 */
export const ExpectedReturnChangeSchema = z.object({
  date: z.iso.date(),
  rate: z.number().gt(-1, "Rate must be above -100%"),
});
export type ExpectedReturnChange = z.infer<typeof ExpectedReturnChangeSchema>;

export const AccountContentSchema = z.object({
  id: AccountIdSchema,
  name: z.string().min(1),
  provider: z.string().min(1),
  currency: CurrencySchema,
  assetType: AssetTypeSchema,
  /** How readily this account can fund spending without waiting or penalties. */
  liquidity: LiquidityTierSchema.optional(),
  // For debt accounts this is the interest rate, compounding the (negative)
  // balance further from zero. Constrained like ExpectedReturnChange.rate —
  // a return at or below -100% can't compound.
  expectedAnnualReturn: z.number().gt(-1, "Rate must be above -100%"),
  expectedReturnChanges: z.array(ExpectedReturnChangeSchema).optional(),
  /**
   * Inter-linked accounts, e.g. a mortgage secured on a property. Lets the
   * tracker derive figures like home equity (property value + mortgage
   * balance) without the user maintaining them.
   */
  linkedAccountId: AccountIdSchema.optional(),
  createdAt: z.iso.date(),
  closedAt: z.iso.date().optional(),
});

export type AccountContent = z.infer<typeof AccountContentSchema>;

export type Account = AccountContent;

type LiquidityAccount = Pick<
  Account,
  "assetType" | "liquidity" | "name" | "provider"
>;

/**
 * Resolve liquidity for new and previously stored accounts. Older data did
 * not have an explicit tier, so pension accounts need a small name-based
 * migration rule while ordinary investments remain liquid.
 */
export function accountLiquidity(account: LiquidityAccount): LiquidityTier {
  if (account.liquidity != null) return account.liquidity;
  if (account.assetType === "cash") return "cash";
  if (account.assetType === "property" || account.assetType === "mortgage") {
    return "illiquid";
  }
  const searchableName = `${account.name} ${account.provider}`.toLowerCase();
  if (/\b(pension|sipp)\b/.test(searchableName)) return "illiquid";
  return "liquid";
}

export function defaultLiquidityForAssetType(
  assetType: AssetType,
): LiquidityTier {
  if (assetType === "cash") return "cash";
  if (assetType === "property" || assetType === "mortgage") return "illiquid";
  return "liquid";
}

/** The expected annual return in force on a given date */
export function effectiveExpectedReturn(
  account: Pick<Account, "expectedAnnualReturn" | "expectedReturnChanges">,
  date: string,
): number {
  const applied = (account.expectedReturnChanges ?? [])
    .filter((change) => change.date <= date)
    .sort((a, b) => a.date.localeCompare(b.date));
  return applied[applied.length - 1]?.rate ?? account.expectedAnnualReturn;
}
