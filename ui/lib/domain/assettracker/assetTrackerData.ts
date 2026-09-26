import { z } from "zod";
import { AccountContentSchema } from "./account";
import { BalanceSnapshotSchema } from "./balanceSnapshot";
import { CapitalFlowSchema } from "./capitalFlow";
import { CurrencySchema, DEFAULT_BASE_CURRENCY } from "./currency";
import { IncomeRecordSchema } from "./incomeRecord";
import { PositiveMoneySchema } from "./money";
import { PlannedExpenditureSchema } from "./plannedExpenditure";
import { RecurringFlowSchema } from "./recurringFlow";
import { TransferSchema } from "./transfer";
import {
  ExchangeRateObservationSchema,
  HoldingObservationSchema,
  InstrumentSchema,
  PriceObservationSchema,
} from "./valuation";

/**
 * The full serializable state of a user's tracker. This is the unit of
 * persistence: today it round-trips through browser storage and JSON
 * export/import; a future backend maps the same domain concepts to PostgreSQL.
 *
 * New collections default to empty so data saved by earlier versions still
 * parses as the model evolves.
 */
export const DEFAULT_EXPECTED_INFLATION = 0.025;
export const DEFAULT_WITHDRAWAL_RATE = 0.04;
export const DEFAULT_VALUATION_MAX_AGE_DAYS = 7;

/** A safe, user-facing failure caused by invalid persisted or imported data. */
export class AssetTrackerDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssetTrackerDataError";
  }
}

export const AssetTrackerSettingsSchema = z.object({
  /** Used to express projected values and rates in today's money */
  expectedAnnualInflation: z.number().gt(-1),
  /** The net worth the user is aiming for, e.g. an FI number */
  targetNetWorth: z
    .union([
      PositiveMoneySchema,
      z
        .number()
        .positive()
        .transform((amount) => ({
          amount,
          currency: DEFAULT_BASE_CURRENCY,
        })),
    ])
    .optional(),
  /** When true the target is in today's money, so inflation must be beaten */
  targetNetWorthIsReal: z.boolean().optional(),
  /** Sustainable annual portfolio withdrawal used to derive the FI target */
  withdrawalRate: z.number().positive().max(1).default(DEFAULT_WITHDRAWAL_RATE),
  /** Currency used by every household-level total and projection. */
  baseCurrency: CurrencySchema.default(DEFAULT_BASE_CURRENCY),
  /** Old observations stop portfolio totals rather than silently carrying on. */
  valuationMaxAgeDays: z
    .number()
    .int()
    .nonnegative()
    .default(DEFAULT_VALUATION_MAX_AGE_DAYS),
});
export type AssetTrackerSettings = z.infer<typeof AssetTrackerSettingsSchema>;

export const AssetTrackerDataSchema = z
  .object({
    accounts: z.array(AccountContentSchema),
    snapshots: z.array(BalanceSnapshotSchema),
    capitalFlows: z.array(CapitalFlowSchema).default([]),
    incomeHistory: z.array(IncomeRecordSchema).default([]),
    transfers: z.array(TransferSchema).default([]),
    recurringFlows: z.array(RecurringFlowSchema).default([]),
    plannedExpenditures: z.array(PlannedExpenditureSchema).default([]),
    instruments: z.array(InstrumentSchema).optional(),
    holdingObservations: z.array(HoldingObservationSchema).optional(),
    priceObservations: z.array(PriceObservationSchema).optional(),
    exchangeRateObservations: z.array(ExchangeRateObservationSchema).optional(),
    settings: AssetTrackerSettingsSchema.default({
      expectedAnnualInflation: DEFAULT_EXPECTED_INFLATION,
      withdrawalRate: DEFAULT_WITHDRAWAL_RATE,
      baseCurrency: DEFAULT_BASE_CURRENCY,
      valuationMaxAgeDays: DEFAULT_VALUATION_MAX_AGE_DAYS,
    }),
  })
  .transform((data) => {
    const accountCurrencies = new Map(
      data.accounts.map((account) => [account.id, account.currency]),
    );
    const recurringFlows = data.recurringFlows.map((flow) => {
      const sourceCurrency =
        flow.fromAccountId == null
          ? undefined
          : accountCurrencies.get(flow.fromAccountId);
      const destinationCurrency =
        flow.toAccountId == null
          ? undefined
          : accountCurrencies.get(flow.toAccountId);
      const currency =
        sourceCurrency ??
        (flow.conversion == null ? destinationCurrency : undefined) ??
        flow.currency;
      return currency === flow.currency ? flow : { ...flow, currency };
    });
    return { ...data, recurringFlows };
  });

export type AssetTrackerData = z.infer<typeof AssetTrackerDataSchema>;
