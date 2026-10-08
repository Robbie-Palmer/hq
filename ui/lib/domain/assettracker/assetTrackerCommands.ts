import { z } from "zod";
import { normalizeSlug } from "../../generic/slugs";
import {
  type Account,
  AccountContentSchema,
  type AccountId,
  AccountIdSchema,
  AssetTypeSchema,
  accountLiquidity,
  isLiability,
  LiquidityTierSchema,
} from "./account";
import {
  type AssetTrackerData,
  AssetTrackerDataError,
} from "./assetTrackerData";
import type { BalanceSnapshot } from "./balanceSnapshot";
import {
  type CapitalFlow,
  CapitalFlowKindSchema,
  capitalFlowKind,
} from "./capitalFlow";
import { CurrencySchema } from "./currency";
import {
  type EmergencyFundPlanInput,
  EmergencyFundPlanInputSchema,
  EmergencyFundPlanSchema,
} from "./emergencyFund";
import {
  ForecastAssumptionBaseSchema,
  ForecastAssumptionSchema,
  ForecastAssumptionSetSchema,
} from "./forecastAssumption";
import {
  type ActualCashFlow,
  type CashFlowDecision,
  CashFlowDecisionSchema,
  type Commitment,
  CommitmentSchema,
  type FutureCashFlow,
  FutureCashFlowSchema,
  futureCashFlowAccountIds,
  PlanningCaseSchema,
} from "./futureCashFlow";
import {
  assertOwnershipMembers,
  capitalFlowOwnershipKey,
  OwnershipSchema,
  snapshotOwnershipKey,
} from "./household";
import {
  calculateJobMoveCompensation,
  type JobMoveScenarioIdInput,
  JobMoveScenarioIdInputSchema,
  JobMoveScenarioSchema,
  type SaveJobMoveScenarioInput,
  SaveJobMoveScenarioInputSchema,
} from "./jobMoveScenario";
import { MortgageTermsSchema } from "./mortgage";
import {
  type SaveMortgageScenarioInput,
  SaveMortgageScenarioInputSchema,
} from "./mortgageCalculator";
import {
  flowOccurrenceDates,
  monthlyAmount,
  RecurringFlowDefinitionShape,
  validateRecurringFlowDefinition,
} from "./recurringFlow";

/**
 * Commands are the write-side of the tracker: zod-validated inputs applied
 * by pure functions that return the next state. The browser store runs them
 * against local data today; a future Worker endpoint validates the same
 * schemas and domain rules before committing changes to PostgreSQL.
 */

export type AssetTrackerCommandErrorCode =
  | "ACCOUNT_NOT_FOUND"
  | "ACCOUNT_CLOSED"
  | "ACCOUNT_ALREADY_CLOSED"
  | "ACCOUNT_HAS_LATER_HISTORY"
  | "ACCOUNT_HAS_PLANNED_EXPENDITURES"
  | "SNAPSHOT_NOT_FOUND"
  | "CAPITAL_FLOW_NOT_FOUND"
  | "FLOW_NOT_FOUND"
  | "PLANNED_EXPENDITURE_NOT_FOUND"
  | "INVALID_PLANNED_EXPENDITURE"
  | "PLANNING_CASE_NOT_FOUND"
  | "FUTURE_CASH_FLOW_NOT_FOUND"
  | "INVALID_FUTURE_CASH_FLOW"
  | "FORECAST_ASSUMPTION_SET_NOT_FOUND"
  | "INVALID_FORECAST_ASSUMPTION"
  | "INVALID_RECURRING_FLOW_CONVERSION"
  | "JOB_MOVE_SCENARIO_NOT_FOUND"
  | "DUPLICATE_INCOME_DATE"
  | "RECEIVED_AMOUNT_REQUIRED"
  | "INVALID_ACCOUNT_NAME";

export class AssetTrackerCommandError extends Error {
  readonly code: AssetTrackerCommandErrorCode;

  constructor(code: AssetTrackerCommandErrorCode, message: string) {
    super(message);
    this.name = "AssetTrackerCommandError";
    this.code = code;
  }
}

const IsoDateSchema = z.iso.date();

// Compounding below a total loss per year is meaningless; there is no upper
// bound — nothing stops an asset being expected to more than double
const AnnualRateSchema = z
  .number()
  .gt(-1, "Expected return must be above -100%");

export const CreateAccountInputSchema = z.object({
  name: z.string().trim().min(1, "Account name is required"),
  provider: z.string().trim().min(1, "Provider is required"),
  currency: CurrencySchema,
  assetType: AssetTypeSchema,
  liquidity: LiquidityTierSchema.optional(),
  expectedAnnualReturn: AnnualRateSchema,
  /** e.g. the property a mortgage is secured on */
  linkedAccountId: AccountIdSchema.optional(),
  mortgageTerms: MortgageTermsSchema.optional(),
  openingBalance: z.number().optional(),
  openingDate: IsoDateSchema.optional(),
});
export type CreateAccountInput = z.infer<typeof CreateAccountInputSchema>;

export const RecordBalanceInputSchema = z.object({
  accountId: AccountIdSchema,
  date: IsoDateSchema,
  // Negative balances are valid: debt accounts, overdrafts
  balance: z.number(),
});
export type RecordBalanceInput = z.infer<typeof RecordBalanceInputSchema>;

export const CloseAccountInputSchema = z
  .object({
    accountId: AccountIdSchema,
    closedAt: IsoDateSchema,
    /** Move the remaining balance here before closing */
    transferToAccountId: AccountIdSchema.optional(),
  })
  .refine((input) => input.transferToAccountId !== input.accountId, {
    message: "Cannot transfer the balance to the account being closed",
  });
export type CloseAccountInput = z.infer<typeof CloseAccountInputSchema>;

export const DeleteSnapshotInputSchema = z.object({
  accountId: AccountIdSchema,
  date: IsoDateSchema,
});
export type DeleteSnapshotInput = z.infer<typeof DeleteSnapshotInputSchema>;

export const DeleteCapitalFlowInputSchema = z.object({
  accountId: AccountIdSchema,
  date: IsoDateSchema,
  kind: CapitalFlowKindSchema.optional(),
});
export type DeleteCapitalFlowInput = z.infer<
  typeof DeleteCapitalFlowInputSchema
>;

export const AccountHistoryKindSchema = z.enum(["balances", "capitalFlows"]);
export type AccountHistoryKind = z.infer<typeof AccountHistoryKindSchema>;

export const ClearAccountHistoryInputSchema = z.object({
  accountId: AccountIdSchema,
  kind: AccountHistoryKindSchema,
});
export type ClearAccountHistoryInput = z.infer<
  typeof ClearAccountHistoryInputSchema
>;

const HistoryValueSchema = z.object({
  date: IsoDateSchema,
  value: z.number(),
});

export const ImportIncomeHistoryInputSchema = z.object({
  income: z
    .array(
      z.object({
        date: IsoDateSchema,
        amount: z.number().nonnegative("Income cannot be negative"),
      }),
    )
    .min(1, "Paste at least one income row"),
  ownership: OwnershipSchema.optional(),
});
export type ImportIncomeHistoryInput = z.infer<
  typeof ImportIncomeHistoryInputSchema
>;

export const ImportAccountHistoryInputSchema = z
  .object({
    accountId: AccountIdSchema,
    balances: z.array(HistoryValueSchema).default([]),
    capitalFlows: z.array(HistoryValueSchema).default([]),
    /** Applies to every capital row in this import. */
    capitalFlowKind: CapitalFlowKindSchema.optional(),
    /** Complete cumulative imports replace this account's selected classified series. */
    replaceCapitalFlows: z.boolean().optional(),
    ownership: OwnershipSchema.optional(),
  })
  .refine(
    (input) => input.balances.length > 0 || input.capitalFlows.length > 0,
    { message: "Paste at least one balance or deposit/withdrawal" },
  );
export type ImportAccountHistoryInput = z.infer<
  typeof ImportAccountHistoryInputSchema
>;

export const RecordTransferInputSchema = z
  .object({
    date: IsoDateSchema,
    /** Omit for external income */
    fromAccountId: AccountIdSchema.optional(),
    /** Omit for external spending */
    toAccountId: AccountIdSchema.optional(),
    amount: z.number().positive("Amount must be positive"),
    /** Native amount received when the two accounts use different currencies. */
    receivedAmount: z.number().positive().optional(),
    /** Fee charged in the source account's native currency. */
    feeAmount: z.number().nonnegative().optional(),
    conversionProvider: z.string().trim().min(1).optional(),
    /** Links the transfer back to the recurring flow that produced it */
    flowId: z.string().min(1).optional(),
  })
  .refine((t) => t.fromAccountId != null || t.toAccountId != null, {
    message: "A transfer needs a source or a destination account",
  })
  .refine((t) => t.fromAccountId !== t.toAccountId, {
    message: "Source and destination must differ",
  });
export type RecordTransferInput = z.infer<typeof RecordTransferInputSchema>;

export const SetBaseCurrencyInputSchema = z.object({
  currency: CurrencySchema,
});
export type SetBaseCurrencyInput = z.infer<typeof SetBaseCurrencyInputSchema>;

export const AddRecurringFlowInputSchema = z
  .object({
    ...RecurringFlowDefinitionShape,
    name: z.string().trim().min(1, "Give the flow a name"),
    startDate: IsoDateSchema.optional(),
  })
  .superRefine(validateRecurringFlowDefinition);
export type AddRecurringFlowInput = z.input<typeof AddRecurringFlowInputSchema>;

export const DeleteRecurringFlowInputSchema = z.object({
  id: z.string().min(1),
});
export type DeleteRecurringFlowInput = z.infer<
  typeof DeleteRecurringFlowInputSchema
>;

export const AddPlannedExpenditureInputSchema = z.object({
  name: z.string().trim().min(1, "Give the expenditure a name"),
  amount: z.number().positive("Amount must be positive"),
  date: IsoDateSchema,
  fromAccountId: AccountIdSchema,
});
export type AddPlannedExpenditureInput = z.infer<
  typeof AddPlannedExpenditureInputSchema
>;

export const DeletePlannedExpenditureInputSchema = z.object({
  id: z.string().min(1),
});
export type DeletePlannedExpenditureInput = z.infer<
  typeof DeletePlannedExpenditureInputSchema
>;

export const CreatePlanningCaseInputSchema = PlanningCaseSchema.omit({
  id: true,
});
export type CreatePlanningCaseInput = z.input<
  typeof CreatePlanningCaseInputSchema
>;

const AddCommitmentStageInputSchema = z.object({
  name: z.string().trim().min(1).optional(),
  fromAccountId: AccountIdSchema,
  dueDate: IsoDateSchema,
  amount: z.number().positive("Amount must be positive"),
});

export const AddCommitmentInputSchema = z.object({
  name: z.string().trim().min(1, "Give the commitment a name"),
  description: z.string().trim().min(1).optional(),
  planningCaseId: z.string().trim().min(1).optional(),
  labels: z.array(z.string().trim().min(1)).default([]),
  currency: CurrencySchema,
  counterparty: z.string().trim().min(1).optional(),
  changeability: z.enum(["fixed", "variable"]).default("fixed"),
  refundable: z.boolean().default(false),
  notes: z.string().trim().min(1).optional(),
  stages: z.array(AddCommitmentStageInputSchema).min(1),
});
export type AddCommitmentInput = z.input<typeof AddCommitmentInputSchema>;

const AddDecisionStageInputSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    fromAccountId: AccountIdSchema,
    earliestDate: IsoDateSchema.optional(),
    expectedDate: IsoDateSchema,
    latestDate: IsoDateSchema.optional(),
    minimumAmount: z.number().nonnegative(),
    expectedAmount: z.number().positive("Expected amount must be positive"),
    maximumAmount: z.number().positive("Maximum amount must be positive"),
  })
  .superRefine((stage, context) => {
    if (
      stage.minimumAmount > stage.expectedAmount ||
      stage.expectedAmount > stage.maximumAmount
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Decision amounts must run from minimum to expected to maximum",
      });
    }
    if (
      (stage.earliestDate != null && stage.earliestDate > stage.expectedDate) ||
      (stage.latestDate != null && stage.expectedDate > stage.latestDate)
    ) {
      context.addIssue({
        code: "custom",
        message: "Decision dates must run from earliest to expected to latest",
      });
    }
  });

export const AddCashFlowDecisionInputSchema = z.object({
  name: z.string().trim().min(1, "Give the decision a name"),
  description: z.string().trim().min(1).optional(),
  planningCaseId: z.string().trim().min(1).optional(),
  labels: z.array(z.string().trim().min(1)).default([]),
  currency: CurrencySchema,
  importance: z.string().trim().min(1).optional(),
  confidence: z.number().min(0).max(1).optional(),
  reversibility: z
    .enum(["reversible", "partly-reversible", "irreversible"])
    .default("reversible"),
  dependencyIds: z.array(z.string().trim().min(1)).default([]),
  alternativeToIds: z.array(z.string().trim().min(1)).default([]),
  notes: z.string().trim().min(1).optional(),
  stages: z.array(AddDecisionStageInputSchema).min(1),
});
export type AddCashFlowDecisionInput = z.input<
  typeof AddCashFlowDecisionInputSchema
>;

export const SetCashFlowDecisionStatusInputSchema = z.object({
  id: z.string().trim().min(1),
  status: z.enum(["considering", "selected", "declined"]),
});
export type SetCashFlowDecisionStatusInput = z.infer<
  typeof SetCashFlowDecisionStatusInputSchema
>;

export const SetCommitmentStatusInputSchema = z.object({
  id: z.string().trim().min(1),
  status: z.enum(["active", "cancelled"]),
});
export type SetCommitmentStatusInput = z.infer<
  typeof SetCommitmentStatusInputSchema
>;

export const RecordActualCashFlowInputSchema = z.object({
  futureCashFlowId: z.string().trim().min(1),
  stageId: z.string().trim().min(1),
  date: IsoDateSchema,
  amount: z.number().positive("Amount must be positive"),
  direction: z.enum(["payment", "refund"]),
});
export type RecordActualCashFlowInput = z.infer<
  typeof RecordActualCashFlowInputSchema
>;

export const DeleteFutureCashFlowInputSchema = z.object({
  id: z.string().trim().min(1),
});
export type DeleteFutureCashFlowInput = z.infer<
  typeof DeleteFutureCashFlowInputSchema
>;

export const CreateForecastAssumptionSetInputSchema = z.object({
  name: z.string().trim().min(1, "Give the assumption set a name"),
});
export type CreateForecastAssumptionSetInput = z.infer<
  typeof CreateForecastAssumptionSetInputSchema
>;

export const SaveEmergencyFundPlanInputSchema = EmergencyFundPlanInputSchema;
export type SaveEmergencyFundPlanInput = EmergencyFundPlanInput;

export const AddForecastAssumptionInputSchema =
  ForecastAssumptionBaseSchema.omit({
    id: true,
  }).extend({
    setId: z.string().trim().min(1),
  });
export type AddForecastAssumptionInput = z.input<
  typeof AddForecastAssumptionInputSchema
>;

export const VersionForecastAssumptionSetInputSchema = z.object({
  id: z.string().trim().min(1),
});
export type VersionForecastAssumptionSetInput = z.infer<
  typeof VersionForecastAssumptionSetInputSchema
>;

export const DeleteForecastAssumptionInputSchema = z.object({
  setId: z.string().trim().min(1),
  assumptionId: z.string().trim().min(1),
});
export type DeleteForecastAssumptionInput = z.infer<
  typeof DeleteForecastAssumptionInputSchema
>;

export const SetExpectedReturnInputSchema = z.object({
  accountId: AccountIdSchema,
  rate: AnnualRateSchema,
  effectiveFrom: IsoDateSchema,
});
export type SetExpectedReturnInput = z.infer<
  typeof SetExpectedReturnInputSchema
>;

export const SetAccountLiquidityInputSchema = z.object({
  accountId: AccountIdSchema,
  liquidity: LiquidityTierSchema,
});
export type SetAccountLiquidityInput = z.infer<
  typeof SetAccountLiquidityInputSchema
>;

export const MaterializeFlowInputSchema = z.object({
  flowId: z.string().min(1),
  /** Generate occurrences up to and including this date */
  throughDate: IsoDateSchema,
});
export type MaterializeFlowInput = z.infer<typeof MaterializeFlowInputSchema>;

export const SetInflationInputSchema = z.object({
  rate: AnnualRateSchema,
});
export type SetInflationInput = z.infer<typeof SetInflationInputSchema>;

export const SetWithdrawalRateInputSchema = z.object({
  rate: z
    .number()
    .positive("Withdrawal rate must be positive")
    .max(1, "Withdrawal rate cannot exceed 100%"),
});
export type SetWithdrawalRateInput = z.infer<
  typeof SetWithdrawalRateInputSchema
>;

export const SetNetWorthTargetInputSchema = z.object({
  /** Null clears the target */
  target: z.number().positive("Target must be positive").nullable(),
  /** Interpret the target in today's money rather than nominal future money */
  inTodaysMoney: z.boolean().optional(),
});
export type SetNetWorthTargetInput = z.infer<
  typeof SetNetWorthTargetInputSchema
>;

export type {
  JobMoveScenarioIdInput,
  SaveJobMoveScenarioInput,
  SaveMortgageScenarioInput,
};

function uniqueId(taken: Set<string>, base: string): string {
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) suffix++;
  return `${base}-${suffix}`;
}

function uniqueAccountId(data: AssetTrackerData, name: string): AccountId {
  const base = normalizeSlug(name);
  if (!base) {
    throw new AssetTrackerCommandError(
      "INVALID_ACCOUNT_NAME",
      `Cannot derive an ID from account name "${name}"`,
    );
  }
  return uniqueId(new Set(data.accounts.map((account) => account.id)), base);
}

function requireAccount(data: AssetTrackerData, accountId: AccountId): Account {
  const account = data.accounts.find((a) => a.id === accountId);
  if (!account) {
    throw new AssetTrackerCommandError(
      "ACCOUNT_NOT_FOUND",
      `Account not found: ${accountId}`,
    );
  }
  return account;
}

function requireOpenOn(
  data: AssetTrackerData,
  accountId: AccountId,
  date: string,
): Account {
  const account = requireAccount(data, accountId);
  // Backfilling history up to the closure date is allowed
  if (account.closedAt && date > account.closedAt) {
    throw new AssetTrackerCommandError(
      "ACCOUNT_CLOSED",
      `"${account.name}" closed on ${account.closedAt}; cannot record changes after that`,
    );
  }
  return account;
}

function assertNoPlannedExpendituresFrom(
  data: AssetTrackerData,
  account: Account,
  action: string,
): void {
  if (
    data.plannedExpenditures.some(
      (expenditure) => expenditure.fromAccountId === account.id,
    ) ||
    data.futureCashFlows.some((record) =>
      futureCashFlowAccountIds(record).includes(account.id),
    )
  ) {
    throw new AssetTrackerCommandError(
      "ACCOUNT_HAS_PLANNED_EXPENDITURES",
      `"${account.name}" funds a future cash flow; delete or reassign it before ${action}`,
    );
  }
}

function upsertSnapshot(
  snapshots: BalanceSnapshot[],
  snapshot: BalanceSnapshot,
): BalanceSnapshot[] {
  const others = snapshots.filter(
    (s) => !(s.accountId === snapshot.accountId && s.date === snapshot.date),
  );
  return [...others, snapshot];
}

/** The recorded balance in force on a date: latest snapshot on or before it */
export function balanceAsOf(
  snapshots: BalanceSnapshot[],
  accountId: AccountId,
  date: string,
): number {
  const applicable = snapshots
    .filter((s) => s.accountId === accountId && s.date <= date)
    .sort((a, b) => a.date.localeCompare(b.date));
  return applicable.at(-1)?.balance ?? 0;
}

export function applyCreateAccount(
  data: AssetTrackerData,
  input: CreateAccountInput,
  defaultDate: string,
): { data: AssetTrackerData; account: Account } {
  const parsed = CreateAccountInputSchema.parse(input);
  if (parsed.linkedAccountId != null) {
    requireAccount(data, parsed.linkedAccountId);
  }
  const openingDate = parsed.openingDate ?? defaultDate;
  const account = AccountContentSchema.parse({
    id: uniqueAccountId(data, parsed.name),
    name: parsed.name,
    provider: parsed.provider,
    currency: parsed.currency,
    assetType: parsed.assetType,
    liquidity: parsed.liquidity,
    expectedAnnualReturn: parsed.expectedAnnualReturn,
    linkedAccountId: parsed.linkedAccountId,
    mortgageTerms: parsed.mortgageTerms,
    createdAt: openingDate,
  });
  const snapshots =
    parsed.openingBalance != null
      ? [
          ...data.snapshots,
          {
            accountId: account.id,
            date: openingDate,
            balance: parsed.openingBalance,
          },
        ]
      : data.snapshots;
  return {
    data: { ...data, accounts: [...data.accounts, account], snapshots },
    account,
  };
}

export function applyRecordBalance(
  data: AssetTrackerData,
  input: RecordBalanceInput,
): AssetTrackerData {
  const parsed = RecordBalanceInputSchema.parse(input);
  requireOpenOn(data, parsed.accountId, parsed.date);
  return { ...data, snapshots: upsertSnapshot(data.snapshots, parsed) };
}

/**
 * Atomically upserts pasted balance and signed capital-flow history. Input rows
 * may be in any order; repository projections sort them chronologically.
 */
export function applyImportAccountHistory(
  data: AssetTrackerData,
  input: ImportAccountHistoryInput,
): AssetTrackerData {
  const parsed = ImportAccountHistoryInputSchema.parse(input);
  // Validate every date before constructing the next state. A closed-account
  // error on one row must not leave the earlier rows partially imported.
  for (const row of [...parsed.balances, ...parsed.capitalFlows]) {
    requireOpenOn(data, parsed.accountId, row.date);
  }

  const snapshotsByAccountDate = new Map(
    data.snapshots.map((snapshot) => [
      `${snapshot.accountId}\0${snapshot.date}`,
      snapshot,
    ]),
  );
  for (const row of parsed.balances) {
    const snapshot: BalanceSnapshot = {
      accountId: parsed.accountId,
      date: row.date,
      balance: row.value,
    };
    snapshotsByAccountDate.set(
      `${snapshot.accountId}\0${snapshot.date}`,
      snapshot,
    );
  }

  const existingCapitalFlows =
    parsed.replaceCapitalFlows && parsed.capitalFlows.length > 0
      ? data.capitalFlows.filter(
          (flow) =>
            flow.accountId !== parsed.accountId ||
            capitalFlowKind(flow) !==
              (parsed.capitalFlowKind ?? "personalSaving"),
        )
      : data.capitalFlows;
  const capitalFlowsByAccountDate = new Map(
    existingCapitalFlows.map((flow) => [
      `${flow.accountId}\0${flow.date}\0${capitalFlowKind(flow)}`,
      flow,
    ]),
  );
  for (const row of parsed.capitalFlows) {
    const flow: CapitalFlow = {
      accountId: parsed.accountId,
      date: row.date,
      amount: row.value,
      ...(parsed.capitalFlowKind != null
        ? { kind: parsed.capitalFlowKind }
        : {}),
    };
    capitalFlowsByAccountDate.set(
      `${flow.accountId}\0${flow.date}\0${capitalFlowKind(flow)}`,
      flow,
    );
  }
  const ownership = parsed.ownership;
  const nextOwnership =
    ownership == null
      ? data.ownership
      : {
          ...data.ownership,
          accounts: {
            ...data.ownership.accounts,
            [parsed.accountId]: ownership,
          },
          snapshots: { ...data.ownership.snapshots },
          capitalFlows: { ...data.ownership.capitalFlows },
        };
  if (ownership != null) {
    for (const row of parsed.balances) {
      nextOwnership.snapshots[
        snapshotOwnershipKey(parsed.accountId, row.date)
      ] = ownership;
    }
    for (const row of parsed.capitalFlows) {
      nextOwnership.capitalFlows[
        capitalFlowOwnershipKey({
          accountId: parsed.accountId,
          date: row.date,
          kind: parsed.capitalFlowKind,
        })
      ] = ownership;
    }
  }
  return {
    ...data,
    snapshots: Array.from(snapshotsByAccountDate.values()),
    capitalFlows: Array.from(capitalFlowsByAccountDate.values()),
    ownership: nextOwnership,
  };
}

/** Replaces the complete portfolio income series atomically. */
export function applyImportIncomeHistory(
  data: AssetTrackerData,
  input: ImportIncomeHistoryInput,
): AssetTrackerData {
  const parsed = ImportIncomeHistoryInputSchema.parse(input);
  const byDate = new Map<string, number>();
  for (const row of parsed.income) {
    if (byDate.has(row.date)) {
      throw new AssetTrackerCommandError(
        "DUPLICATE_INCOME_DATE",
        `Duplicate income record on ${row.date}`,
      );
    }
    byDate.set(row.date, row.amount);
  }
  const incomeOwnership = { ...data.ownership.incomeHistory };
  if (parsed.ownership != null) {
    for (const row of parsed.income) {
      incomeOwnership[row.date] = parsed.ownership;
    }
  }
  return {
    ...data,
    incomeHistory: Array.from(byDate, ([date, amount]) => ({
      date,
      amount,
      currency: data.settings.baseCurrency,
    })).sort((a, b) => a.date.localeCompare(b.date)),
    ownership: {
      ...data.ownership,
      incomeHistory: incomeOwnership,
    },
  };
}

export function applyClearIncomeHistory(
  data: AssetTrackerData,
): AssetTrackerData {
  return { ...data, incomeHistory: [] };
}

export function applyRecordTransfer(
  data: AssetTrackerData,
  input: RecordTransferInput,
): AssetTrackerData {
  const parsed = RecordTransferInputSchema.parse(input);
  const source =
    parsed.fromAccountId == null
      ? null
      : requireOpenOn(data, parsed.fromAccountId, parsed.date);
  const destination =
    parsed.toAccountId == null
      ? null
      : requireOpenOn(data, parsed.toAccountId, parsed.date);
  const crossCurrency =
    source != null &&
    destination != null &&
    source.currency !== destination.currency;
  if (crossCurrency && parsed.receivedAmount == null) {
    throw new AssetTrackerCommandError(
      "RECEIVED_AMOUNT_REQUIRED",
      "Enter the amount received for a cross-currency transfer",
    );
  }
  if (!crossCurrency && parsed.receivedAmount != null) {
    throw new AssetTrackerCommandError(
      "RECEIVED_AMOUNT_REQUIRED",
      "A received amount only applies to a cross-currency transfer",
    );
  }
  const receivedAmount = parsed.receivedAmount ?? parsed.amount;
  const feeAmount = parsed.feeAmount ?? 0;
  let snapshots = data.snapshots;
  if (parsed.fromAccountId != null) {
    snapshots = upsertSnapshot(snapshots, {
      accountId: parsed.fromAccountId,
      date: parsed.date,
      balance:
        balanceAsOf(data.snapshots, parsed.fromAccountId, parsed.date) -
        parsed.amount -
        feeAmount,
    });
  }
  if (parsed.toAccountId != null) {
    snapshots = upsertSnapshot(snapshots, {
      accountId: parsed.toAccountId,
      date: parsed.date,
      balance:
        balanceAsOf(data.snapshots, parsed.toAccountId, parsed.date) +
        receivedAmount,
    });
  }
  const taken = new Set(data.transfers.map((t) => t.id));
  const transfer = {
    id: uniqueId(taken, `transfer-${parsed.date}`),
    date: parsed.date,
    fromAccountId: parsed.fromAccountId,
    toAccountId: parsed.toAccountId,
    amount: parsed.amount,
    ...(crossCurrency
      ? { fromAmount: parsed.amount, toAmount: receivedAmount }
      : {}),
    ...(feeAmount > 0 ? { feeAmount } : {}),
    ...(parsed.conversionProvider == null
      ? {}
      : { conversionProvider: parsed.conversionProvider }),
    flowId: parsed.flowId,
  };
  return { ...data, snapshots, transfers: [...data.transfers, transfer] };
}

/**
 * Realises a recurring flow into actual transfers from its start (or the day
 * after its last already-recorded transfer) through `throughDate`. Each
 * occurrence debits the source and credits the destination, so the recorded
 * balances — and the trajectory and CAGR that read them — reflect the money
 * actually moving. Re-running only tops up newly-due periods. Formula amounts
 * are evaluated against the liability's running balance at each step, and a
 * period with nothing due (debt cleared) is skipped.
 */
export function applyMaterializeFlow(
  data: AssetTrackerData,
  input: MaterializeFlowInput,
): AssetTrackerData {
  const parsed = MaterializeFlowInputSchema.parse(input);
  const flow = data.recurringFlows.find((f) => f.id === parsed.flowId);
  if (!flow) {
    throw new AssetTrackerCommandError(
      "FLOW_NOT_FOUND",
      `No recurring flow found with ID ${parsed.flowId}`,
    );
  }
  const lastRecorded = data.transfers
    .filter((t) => t.flowId === flow.id)
    .map((t) => t.date)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .at(-1);
  const dates = flowOccurrenceDates(flow, parsed.throughDate, lastRecorded);

  let working = data;
  for (const date of dates) {
    const liabilityBalance =
      flow.toAccountId != null
        ? balanceAsOf(working.snapshots, flow.toAccountId, date)
        : undefined;
    const amount =
      flow.formula != null
        ? monthlyAmount(flow, liabilityBalance)
        : (flow.amount ?? 0);
    if (amount <= 0) continue;
    working = applyRecordTransfer(working, {
      date,
      fromAccountId: flow.fromAccountId,
      toAccountId: flow.toAccountId,
      amount,
      receivedAmount: flow.conversion?.received.amount,
      feeAmount: flow.conversion?.fee?.amount,
      conversionProvider: flow.conversion?.provider,
      flowId: flow.id,
    });
  }
  return working;
}

export function applyCloseAccount(
  data: AssetTrackerData,
  input: CloseAccountInput,
): AssetTrackerData {
  const parsed = CloseAccountInputSchema.parse(input);
  const account = requireAccount(data, parsed.accountId);
  if (account.closedAt) {
    throw new AssetTrackerCommandError(
      "ACCOUNT_ALREADY_CLOSED",
      `"${account.name}" is already closed`,
    );
  }
  assertNoPlannedExpendituresFrom(data, account, "closing");
  // Closing before later history would strand those snapshots, so the account
  // would reappear in net-worth views after its close date
  const hasLaterHistory = data.snapshots.some(
    (s) => s.accountId === account.id && s.date > parsed.closedAt,
  );
  if (hasLaterHistory) {
    throw new AssetTrackerCommandError(
      "ACCOUNT_HAS_LATER_HISTORY",
      `"${account.name}" has balances recorded after ${parsed.closedAt}; delete them before closing`,
    );
  }

  let working = data;
  const remaining = balanceAsOf(data.snapshots, account.id, parsed.closedAt);
  if (parsed.transferToAccountId != null && remaining > 0) {
    working = applyRecordTransfer(working, {
      date: parsed.closedAt,
      fromAccountId: account.id,
      toAccountId: parsed.transferToAccountId,
      amount: remaining,
    });
  }
  const accounts = working.accounts.map((a) =>
    a.id === account.id ? { ...a, closedAt: parsed.closedAt } : a,
  );
  // Record the final zero balance so net worth trends stay accurate without
  // the user manually entering rows of zeros — but never clobber a balance the
  // user already recorded for the close date
  const hasSnapshotOnCloseDate = working.snapshots.some(
    (s) => s.accountId === account.id && s.date === parsed.closedAt,
  );
  const snapshots = hasSnapshotOnCloseDate
    ? working.snapshots
    : upsertSnapshot(working.snapshots, {
        accountId: account.id,
        date: parsed.closedAt,
        balance: 0,
      });
  return { ...working, accounts, snapshots };
}

export function applyDeleteSnapshot(
  data: AssetTrackerData,
  input: DeleteSnapshotInput,
): AssetTrackerData {
  const parsed = DeleteSnapshotInputSchema.parse(input);
  requireAccount(data, parsed.accountId);
  const snapshots = data.snapshots.filter(
    (s) => !(s.accountId === parsed.accountId && s.date === parsed.date),
  );
  if (snapshots.length === data.snapshots.length) {
    throw new AssetTrackerCommandError(
      "SNAPSHOT_NOT_FOUND",
      `No balance recorded for ${parsed.accountId} on ${parsed.date}`,
    );
  }
  return { ...data, snapshots };
}

export function applyDeleteCapitalFlow(
  data: AssetTrackerData,
  input: DeleteCapitalFlowInput,
): AssetTrackerData {
  const parsed = DeleteCapitalFlowInputSchema.parse(input);
  requireAccount(data, parsed.accountId);
  const capitalFlows = data.capitalFlows.filter(
    (flow) =>
      !(
        flow.accountId === parsed.accountId &&
        flow.date === parsed.date &&
        capitalFlowKind(flow) === (parsed.kind ?? "personalSaving")
      ),
  );
  if (capitalFlows.length === data.capitalFlows.length) {
    const kindFilter = parsed.kind == null ? "" : ` of kind "${parsed.kind}"`;
    throw new AssetTrackerCommandError(
      "CAPITAL_FLOW_NOT_FOUND",
      `No deposit or withdrawal${kindFilter} recorded for ${parsed.accountId} on ${parsed.date}`,
    );
  }
  return { ...data, capitalFlows };
}

export function applyClearAccountHistory(
  data: AssetTrackerData,
  input: ClearAccountHistoryInput,
): AssetTrackerData {
  const parsed = ClearAccountHistoryInputSchema.parse(input);
  requireAccount(data, parsed.accountId);
  if (parsed.kind === "balances") {
    return {
      ...data,
      snapshots: data.snapshots.filter(
        (snapshot) => snapshot.accountId !== parsed.accountId,
      ),
    };
  }
  return {
    ...data,
    capitalFlows: data.capitalFlows.filter(
      (flow) => flow.accountId !== parsed.accountId,
    ),
  };
}

export function applyAddRecurringFlow(
  data: AssetTrackerData,
  input: AddRecurringFlowInput,
  defaultStartDate: string,
): AssetTrackerData {
  const startDate = input.startDate ?? defaultStartDate;
  const source =
    input.fromAccountId == null
      ? null
      : requireOpenOn(data, input.fromAccountId, startDate);
  const destination =
    input.toAccountId == null
      ? null
      : requireOpenOn(data, input.toAccountId, startDate);
  const currency =
    input.currency ??
    source?.currency ??
    destination?.currency ??
    data.settings.baseCurrency;
  const parsed = AddRecurringFlowInputSchema.parse({ ...input, currency });
  const destinationCurrency = destination?.currency;
  const needsConversion =
    destinationCurrency != null && parsed.currency !== destinationCurrency;
  if (needsConversion && parsed.conversion == null) {
    throw new AssetTrackerCommandError(
      "INVALID_RECURRING_FLOW_CONVERSION",
      "Enter the expected amount received for a cross-currency flow",
    );
  }
  if (parsed.conversion != null && destination == null) {
    throw new AssetTrackerCommandError(
      "INVALID_RECURRING_FLOW_CONVERSION",
      "A currency conversion needs a destination account",
    );
  }
  if (
    parsed.conversion != null &&
    destinationCurrency != null &&
    parsed.conversion.received.currency !== destinationCurrency
  ) {
    throw new AssetTrackerCommandError(
      "INVALID_RECURRING_FLOW_CONVERSION",
      "The received currency must match the destination account",
    );
  }
  if (source != null && parsed.currency !== source.currency) {
    throw new AssetTrackerCommandError(
      "INVALID_RECURRING_FLOW_CONVERSION",
      "The sent currency must match the source account",
    );
  }
  const base = normalizeSlug(parsed.name) || "flow";
  const flow = {
    id: uniqueId(new Set(data.recurringFlows.map((f) => f.id)), base),
    name: parsed.name,
    fromAccountId: parsed.fromAccountId,
    toAccountId: parsed.toAccountId,
    amount: parsed.amount,
    currency: parsed.currency,
    conversion: parsed.conversion,
    grossAmount: parsed.grossAmount,
    formula: parsed.formula,
    compensationKind: parsed.compensationKind,
    frequency: parsed.frequency,
    startDate,
    endDate: parsed.endDate,
  };
  return { ...data, recurringFlows: [...data.recurringFlows, flow] };
}

export function applyDeleteRecurringFlow(
  data: AssetTrackerData,
  input: DeleteRecurringFlowInput,
): AssetTrackerData {
  const parsed = DeleteRecurringFlowInputSchema.parse(input);
  const recurringFlows = data.recurringFlows.filter((f) => f.id !== parsed.id);
  if (recurringFlows.length === data.recurringFlows.length) {
    throw new AssetTrackerCommandError(
      "FLOW_NOT_FOUND",
      `No recurring flow found with ID ${parsed.id}`,
    );
  }
  return { ...data, recurringFlows };
}

export function applyAddPlannedExpenditure(
  data: AssetTrackerData,
  input: AddPlannedExpenditureInput,
  asOfDate: string,
): AssetTrackerData {
  const parsed = AddPlannedExpenditureInputSchema.parse(input);
  const source = requireAccount(data, parsed.fromAccountId);
  if (source.closedAt != null) {
    throw new AssetTrackerCommandError(
      "INVALID_PLANNED_EXPENDITURE",
      "Planned expenditure must come from an open account",
    );
  }
  if (
    isLiability(source.assetType) ||
    accountLiquidity(source) === "illiquid"
  ) {
    throw new AssetTrackerCommandError(
      "INVALID_PLANNED_EXPENDITURE",
      "Planned expenditure must come from cash or a liquid investment",
    );
  }
  if (parsed.date <= asOfDate) {
    throw new AssetTrackerCommandError(
      "INVALID_PLANNED_EXPENDITURE",
      "Planned expenditure must have a future date",
    );
  }
  const base = normalizeSlug(parsed.name) || "expenditure";
  const expenditure = {
    id: uniqueId(
      new Set(data.plannedExpenditures.map((item) => item.id)),
      base,
    ),
    ...parsed,
  };
  return {
    ...data,
    plannedExpenditures: [...data.plannedExpenditures, expenditure],
  };
}

export function applyDeletePlannedExpenditure(
  data: AssetTrackerData,
  input: DeletePlannedExpenditureInput,
): AssetTrackerData {
  const parsed = DeletePlannedExpenditureInputSchema.parse(input);
  const plannedExpenditures = data.plannedExpenditures.filter(
    (item) => item.id !== parsed.id,
  );
  if (plannedExpenditures.length === data.plannedExpenditures.length) {
    throw new AssetTrackerCommandError(
      "PLANNED_EXPENDITURE_NOT_FOUND",
      `No planned expenditure found with ID ${parsed.id}`,
    );
  }
  return {
    ...data,
    plannedExpenditures,
    futureCashFlows: data.futureCashFlows.filter(
      (record) => record.id !== parsed.id,
    ),
    ownership: {
      ...data.ownership,
      futureCashFlows: Object.fromEntries(
        Object.entries(data.ownership.futureCashFlows).filter(
          ([id]) => id !== parsed.id,
        ),
      ),
    },
  };
}

function requirePlanningCase(
  data: AssetTrackerData,
  planningCaseId: string | undefined,
): void {
  if (
    planningCaseId != null &&
    !data.planningCases.some(({ id }) => id === planningCaseId)
  ) {
    throw new AssetTrackerCommandError(
      "PLANNING_CASE_NOT_FOUND",
      `No planning case found with ID ${planningCaseId}`,
    );
  }
}

function requireEligibleFutureCashFlowAccount(
  data: AssetTrackerData,
  accountId: AccountId,
): Account {
  const account = requireAccount(data, accountId);
  if (account.closedAt != null) {
    throw new AssetTrackerCommandError(
      "INVALID_FUTURE_CASH_FLOW",
      "Future cash flows must come from an open account",
    );
  }
  if (
    isLiability(account.assetType) ||
    accountLiquidity(account) === "illiquid"
  ) {
    throw new AssetTrackerCommandError(
      "INVALID_FUTURE_CASH_FLOW",
      "Future cash flows must come from cash or a liquid investment",
    );
  }
  return account;
}

function futureCashFlowOwnership(data: AssetTrackerData, accountId: AccountId) {
  return data.ownership.accounts[accountId];
}

function addFutureCashFlowOwnership(
  data: AssetTrackerData,
  recordId: string,
  accountId: AccountId,
): AssetTrackerData["ownership"] {
  const owner = futureCashFlowOwnership(data, accountId);
  if (owner == null) return data.ownership;
  return {
    ...data.ownership,
    futureCashFlows: {
      ...data.ownership.futureCashFlows,
      [recordId]: owner,
    },
  };
}

export function applyCreatePlanningCase(
  data: AssetTrackerData,
  input: CreatePlanningCaseInput,
): AssetTrackerData {
  const parsed = CreatePlanningCaseInputSchema.parse(input);
  const id = uniqueId(
    new Set(data.planningCases.map((planningCase) => planningCase.id)),
    normalizeSlug(parsed.name) || "planning-case",
  );
  return {
    ...data,
    planningCases: [
      ...data.planningCases,
      PlanningCaseSchema.parse({ id, ...parsed }),
    ],
  };
}

export function applyAddCommitment(
  data: AssetTrackerData,
  input: AddCommitmentInput,
  asOfDate: string,
): AssetTrackerData {
  const parsed = AddCommitmentInputSchema.parse(input);
  requirePlanningCase(data, parsed.planningCaseId);
  for (const stage of parsed.stages) {
    const account = requireEligibleFutureCashFlowAccount(
      data,
      stage.fromAccountId,
    );
    if (account.currency !== parsed.currency) {
      throw new AssetTrackerCommandError(
        "INVALID_FUTURE_CASH_FLOW",
        "A commitment must use the currency of its source account",
      );
    }
    if (stage.dueDate <= asOfDate) {
      throw new AssetTrackerCommandError(
        "INVALID_FUTURE_CASH_FLOW",
        "Commitment stages must have a future due date",
      );
    }
  }
  const firstStage = parsed.stages[0];
  if (firstStage == null) {
    throw new AssetTrackerCommandError(
      "INVALID_FUTURE_CASH_FLOW",
      "A commitment needs at least one stage",
    );
  }
  const id = uniqueId(
    new Set(data.futureCashFlows.map((record) => record.id)),
    normalizeSlug(parsed.name) || "commitment",
  );
  const commitment: Commitment = CommitmentSchema.parse({
    id,
    ...parsed,
    kind: "commitment",
    status: "active",
    stages: parsed.stages.map((stage, index) => ({
      id: `payment-${index + 1}`,
      ...stage,
      actuals: [],
    })),
  });
  return {
    ...data,
    futureCashFlows: [...data.futureCashFlows, commitment],
    ownership: addFutureCashFlowOwnership(
      data,
      id,
      commitment.stages[0]?.fromAccountId ?? firstStage.fromAccountId,
    ),
  };
}

export function applyAddCashFlowDecision(
  data: AssetTrackerData,
  input: AddCashFlowDecisionInput,
  asOfDate: string,
): AssetTrackerData {
  const parsed = AddCashFlowDecisionInputSchema.parse(input);
  requirePlanningCase(data, parsed.planningCaseId);
  const referencedIds = new Set(data.futureCashFlows.map(({ id }) => id));
  for (const referencedId of [
    ...parsed.dependencyIds,
    ...parsed.alternativeToIds,
  ]) {
    if (!referencedIds.has(referencedId)) {
      throw new AssetTrackerCommandError(
        "FUTURE_CASH_FLOW_NOT_FOUND",
        `No future cash flow found with ID ${referencedId}`,
      );
    }
  }
  for (const stage of parsed.stages) {
    const account = requireEligibleFutureCashFlowAccount(
      data,
      stage.fromAccountId,
    );
    if (account.currency !== parsed.currency) {
      throw new AssetTrackerCommandError(
        "INVALID_FUTURE_CASH_FLOW",
        "A decision must use the currency of its source account",
      );
    }
    if (stage.expectedDate <= asOfDate) {
      throw new AssetTrackerCommandError(
        "INVALID_FUTURE_CASH_FLOW",
        "Decision stages must have a future expected date",
      );
    }
  }
  const firstStage = parsed.stages[0];
  if (firstStage == null) {
    throw new AssetTrackerCommandError(
      "INVALID_FUTURE_CASH_FLOW",
      "A decision needs at least one stage",
    );
  }
  const id = uniqueId(referencedIds, normalizeSlug(parsed.name) || "decision");
  const decision: CashFlowDecision = CashFlowDecisionSchema.parse({
    id,
    ...parsed,
    kind: "decision",
    status: "considering",
    stages: parsed.stages.map((stage, index) => ({
      id: `cash-flow-${index + 1}`,
      ...stage,
      actuals: [],
    })),
  });
  return {
    ...data,
    futureCashFlows: [...data.futureCashFlows, decision],
    ownership: addFutureCashFlowOwnership(
      data,
      id,
      decision.stages[0]?.fromAccountId ?? firstStage.fromAccountId,
    ),
  };
}

export function applySetCashFlowDecisionStatus(
  data: AssetTrackerData,
  input: SetCashFlowDecisionStatusInput,
): AssetTrackerData {
  const parsed = SetCashFlowDecisionStatusInputSchema.parse(input);
  const record = data.futureCashFlows.find(({ id }) => id === parsed.id);
  if (record?.kind !== "decision") {
    throw new AssetTrackerCommandError(
      "FUTURE_CASH_FLOW_NOT_FOUND",
      `No cash-flow decision found with ID ${parsed.id}`,
    );
  }
  return {
    ...data,
    futureCashFlows: data.futureCashFlows.map((candidate) =>
      candidate.id === record.id
        ? { ...record, status: parsed.status }
        : candidate,
    ),
  };
}

export function applySetCommitmentStatus(
  data: AssetTrackerData,
  input: SetCommitmentStatusInput,
): AssetTrackerData {
  const parsed = SetCommitmentStatusInputSchema.parse(input);
  const record = data.futureCashFlows.find(({ id }) => id === parsed.id);
  if (record?.kind !== "commitment") {
    throw new AssetTrackerCommandError(
      "FUTURE_CASH_FLOW_NOT_FOUND",
      `No commitment found with ID ${parsed.id}`,
    );
  }
  return {
    ...data,
    futureCashFlows: data.futureCashFlows.map((candidate) =>
      candidate.id === record.id
        ? { ...record, status: parsed.status }
        : candidate,
    ),
  };
}

function appendActualToRecord(
  record: FutureCashFlow,
  stageId: string,
  actual: ActualCashFlow,
): FutureCashFlow {
  return FutureCashFlowSchema.parse({
    ...record,
    stages: record.stages.map((candidateStage) =>
      candidateStage.id === stageId
        ? {
            ...candidateStage,
            actuals: [...candidateStage.actuals, actual],
          }
        : candidateStage,
    ),
  });
}

export function applyRecordActualCashFlow(
  data: AssetTrackerData,
  input: RecordActualCashFlowInput,
  asOfDate: string,
): AssetTrackerData {
  const parsed = RecordActualCashFlowInputSchema.parse(input);
  if (parsed.date > asOfDate) {
    throw new AssetTrackerCommandError(
      "INVALID_FUTURE_CASH_FLOW",
      "Actual cash flows cannot have a future date",
    );
  }
  const record = data.futureCashFlows.find(
    ({ id }) => id === parsed.futureCashFlowId,
  );
  const stage = record?.stages.find(({ id }) => id === parsed.stageId);
  if (record == null || stage == null) {
    throw new AssetTrackerCommandError(
      "FUTURE_CASH_FLOW_NOT_FOUND",
      "No matching future cash-flow stage was found",
    );
  }
  if (
    parsed.direction === "refund" &&
    record.kind === "commitment" &&
    !record.refundable
  ) {
    throw new AssetTrackerCommandError(
      "INVALID_FUTURE_CASH_FLOW",
      "This commitment is not marked as refundable",
    );
  }
  const netPayments = stage.actuals.reduce(
    (total, actual) =>
      total + (actual.direction === "payment" ? actual.amount : -actual.amount),
    0,
  );
  if (parsed.direction === "refund" && parsed.amount > netPayments) {
    throw new AssetTrackerCommandError(
      "INVALID_FUTURE_CASH_FLOW",
      "A refund cannot exceed the net amount already paid",
    );
  }
  const takenActualIds = new Set(
    data.futureCashFlows.flatMap((candidate) =>
      candidate.stages.flatMap((candidateStage) =>
        candidateStage.actuals.map(({ id }) => id),
      ),
    ),
  );
  const actual = {
    id: uniqueId(
      takenActualIds,
      `${record.id}-${stage.id}-${parsed.direction}`,
    ),
    date: parsed.date,
    amount: parsed.amount,
    direction: parsed.direction,
  };
  const updatedRecord = appendActualToRecord(record, stage.id, actual);
  return {
    ...data,
    futureCashFlows: data.futureCashFlows.map((candidate) =>
      candidate.id === record.id ? updatedRecord : candidate,
    ),
  };
}

export function applyDeleteFutureCashFlow(
  data: AssetTrackerData,
  input: DeleteFutureCashFlowInput,
): AssetTrackerData {
  const parsed = DeleteFutureCashFlowInputSchema.parse(input);
  if (!data.futureCashFlows.some(({ id }) => id === parsed.id)) {
    throw new AssetTrackerCommandError(
      "FUTURE_CASH_FLOW_NOT_FOUND",
      `No future cash flow found with ID ${parsed.id}`,
    );
  }
  const dependent = data.futureCashFlows.find(
    (record) =>
      record.kind === "decision" &&
      (record.dependencyIds.includes(parsed.id) ||
        record.alternativeToIds.includes(parsed.id)),
  );
  if (dependent != null) {
    throw new AssetTrackerCommandError(
      "INVALID_FUTURE_CASH_FLOW",
      `"${dependent.name}" still references this future cash flow`,
    );
  }
  return {
    ...data,
    futureCashFlows: data.futureCashFlows.filter(({ id }) => id !== parsed.id),
    plannedExpenditures: data.plannedExpenditures.filter(
      ({ id }) => id !== parsed.id,
    ),
    ownership: {
      ...data.ownership,
      plannedExpenditures: Object.fromEntries(
        Object.entries(data.ownership.plannedExpenditures).filter(
          ([id]) => id !== parsed.id,
        ),
      ),
      futureCashFlows: Object.fromEntries(
        Object.entries(data.ownership.futureCashFlows).filter(
          ([id]) => id !== parsed.id,
        ),
      ),
    },
  };
}

function requireActiveForecastAssumptionSet(
  data: AssetTrackerData,
  id: string,
) {
  const set = data.forecastAssumptionSets.find(
    (candidate) => candidate.id === id,
  );
  if (set == null) {
    throw new AssetTrackerCommandError(
      "FORECAST_ASSUMPTION_SET_NOT_FOUND",
      `No forecast assumption set found with ID ${id}`,
    );
  }
  if (set.status !== "active") {
    throw new AssetTrackerCommandError(
      "INVALID_FORECAST_ASSUMPTION",
      "Superseded assumption sets are read-only; create changes on the active version",
    );
  }
  return set;
}

export function applyCreateForecastAssumptionSet(
  data: AssetTrackerData,
  input: CreateForecastAssumptionSetInput,
  acceptedAt: string,
): AssetTrackerData {
  const parsed = CreateForecastAssumptionSetInputSchema.parse(input);
  const seriesId = uniqueId(
    new Set(data.forecastAssumptionSets.map(({ seriesId: id }) => id)),
    normalizeSlug(parsed.name) || "forecast-assumptions",
  );
  const set = ForecastAssumptionSetSchema.parse({
    id: `${seriesId}-v1`,
    seriesId,
    name: parsed.name,
    version: 1,
    status: "active",
    createdAt: acceptedAt,
    assumptions: [],
  });
  return {
    ...data,
    forecastAssumptionSets: [...data.forecastAssumptionSets, set],
  };
}

export function applyAddForecastAssumption(
  data: AssetTrackerData,
  input: AddForecastAssumptionInput,
): AssetTrackerData {
  const parsed = AddForecastAssumptionInputSchema.parse(input);
  const set = requireActiveForecastAssumptionSet(data, parsed.setId);
  assertOwnershipMembers(data.household, parsed.ownership);
  if (parsed.accountId != null) {
    const account = requireEligibleFutureCashFlowAccount(
      data,
      parsed.accountId,
    );
    if (account.currency !== parsed.currency) {
      throw new AssetTrackerCommandError(
        "INVALID_FORECAST_ASSUMPTION",
        "An income assumption must use the currency of its destination account",
      );
    }
  }
  const takenIds = new Set(
    data.forecastAssumptionSets.flatMap(({ assumptions }) =>
      assumptions.map(({ id }) => id),
    ),
  );
  const assumption = ForecastAssumptionSchema.parse({
    id: uniqueId(takenIds, normalizeSlug(parsed.name) || "assumption"),
    ...parsed,
  });
  return {
    ...data,
    forecastAssumptionSets: data.forecastAssumptionSets.map((candidate) =>
      candidate.id === set.id
        ? { ...candidate, assumptions: [...candidate.assumptions, assumption] }
        : candidate,
    ),
  };
}

export function applyVersionForecastAssumptionSet(
  data: AssetTrackerData,
  input: VersionForecastAssumptionSetInput,
  acceptedAt: string,
): AssetTrackerData {
  const parsed = VersionForecastAssumptionSetInputSchema.parse(input);
  const set = requireActiveForecastAssumptionSet(data, parsed.id);
  const nextVersion =
    Math.max(
      ...data.forecastAssumptionSets
        .filter(({ seriesId }) => seriesId === set.seriesId)
        .map(({ version }) => version),
    ) + 1;
  const takenAssumptionIds = new Set(
    data.forecastAssumptionSets.flatMap(({ assumptions }) =>
      assumptions.map(({ id }) => id),
    ),
  );
  const assumptions = set.assumptions.map((assumption) => {
    const id = uniqueId(
      takenAssumptionIds,
      `${normalizeSlug(assumption.name) || "assumption"}-v${nextVersion}`,
    );
    takenAssumptionIds.add(id);
    return { ...assumption, id };
  });
  const versioned = ForecastAssumptionSetSchema.parse({
    ...set,
    id: `${set.seriesId}-v${nextVersion}`,
    version: nextVersion,
    status: "active",
    createdAt: acceptedAt,
    supersedesId: set.id,
    assumptions,
  });
  return {
    ...data,
    forecastAssumptionSets: [
      ...data.forecastAssumptionSets.map((candidate) =>
        candidate.id === set.id
          ? { ...candidate, status: "superseded" as const }
          : candidate,
      ),
      versioned,
    ],
  };
}

export function applyDeleteForecastAssumption(
  data: AssetTrackerData,
  input: DeleteForecastAssumptionInput,
): AssetTrackerData {
  const parsed = DeleteForecastAssumptionInputSchema.parse(input);
  const set = requireActiveForecastAssumptionSet(data, parsed.setId);
  if (!set.assumptions.some(({ id }) => id === parsed.assumptionId)) {
    throw new AssetTrackerCommandError(
      "INVALID_FORECAST_ASSUMPTION",
      `No forecast assumption found with ID ${parsed.assumptionId}`,
    );
  }
  return {
    ...data,
    forecastAssumptionSets: data.forecastAssumptionSets.map((candidate) =>
      candidate.id === set.id
        ? {
            ...candidate,
            assumptions: candidate.assumptions.filter(
              ({ id }) => id !== parsed.assumptionId,
            ),
          }
        : candidate,
    ),
  };
}

export function applySetExpectedReturn(
  data: AssetTrackerData,
  input: SetExpectedReturnInput,
): AssetTrackerData {
  const parsed = SetExpectedReturnInputSchema.parse(input);
  const account = requireAccount(data, parsed.accountId);
  const changes = [
    ...(account.expectedReturnChanges ?? []).filter(
      (change) => change.date !== parsed.effectiveFrom,
    ),
    { date: parsed.effectiveFrom, rate: parsed.rate },
  ].sort((a, b) => a.date.localeCompare(b.date));
  const accounts = data.accounts.map((a) =>
    a.id === account.id ? { ...a, expectedReturnChanges: changes } : a,
  );
  return { ...data, accounts };
}

export function applySaveEmergencyFundPlan(
  data: AssetTrackerData,
  input: SaveEmergencyFundPlanInput,
  createdAt: string,
): AssetTrackerData {
  const parsed = SaveEmergencyFundPlanInputSchema.parse(input);
  const plans = data.emergencyFundPlans ?? [];
  const active = plans.find(({ status }) => status === "active");
  const seriesId = active?.seriesId ?? "household-emergency-reserves";
  const version = active == null ? 1 : active.version + 1;
  const takenIds = new Set(plans.map(({ id }) => id));
  const plan = EmergencyFundPlanSchema.parse({
    ...parsed,
    id: uniqueId(takenIds, `${seriesId}-v${version}`),
    seriesId,
    version,
    status: "active",
    createdAt,
    ...(active == null ? {} : { supersedesId: active.id }),
  });
  return {
    ...data,
    emergencyFundPlans: [
      ...plans.map((candidate) =>
        candidate.id === active?.id
          ? { ...candidate, status: "superseded" as const }
          : candidate,
      ),
      plan,
    ],
  };
}

export function applySetAccountLiquidity(
  data: AssetTrackerData,
  input: SetAccountLiquidityInput,
): AssetTrackerData {
  const parsed = SetAccountLiquidityInputSchema.parse(input);
  const account = requireAccount(data, parsed.accountId);
  if (parsed.liquidity === "illiquid") {
    assertNoPlannedExpendituresFrom(
      data,
      account,
      "making the account illiquid",
    );
  }
  const accounts = data.accounts.map((candidate) =>
    candidate.id === account.id
      ? { ...candidate, liquidity: parsed.liquidity }
      : candidate,
  );
  return { ...data, accounts };
}

export function applySetInflation(
  data: AssetTrackerData,
  input: SetInflationInput,
): AssetTrackerData {
  const parsed = SetInflationInputSchema.parse(input);
  return {
    ...data,
    settings: { ...data.settings, expectedAnnualInflation: parsed.rate },
  };
}

export function applySetBaseCurrency(
  data: AssetTrackerData,
  input: SetBaseCurrencyInput,
): AssetTrackerData {
  const parsed = SetBaseCurrencyInputSchema.parse(input);
  return {
    ...data,
    settings: { ...data.settings, baseCurrency: parsed.currency },
  };
}

export function applySetWithdrawalRate(
  data: AssetTrackerData,
  input: SetWithdrawalRateInput,
): AssetTrackerData {
  const parsed = SetWithdrawalRateInputSchema.parse(input);
  return {
    ...data,
    settings: { ...data.settings, withdrawalRate: parsed.rate },
  };
}

export function applySetNetWorthTarget(
  data: AssetTrackerData,
  input: SetNetWorthTargetInput,
): AssetTrackerData {
  const parsed = SetNetWorthTargetInputSchema.parse(input);
  const cleared = parsed.target == null;
  return {
    ...data,
    settings: {
      ...data.settings,
      targetNetWorth:
        parsed.target == null
          ? undefined
          : { amount: parsed.target, currency: data.settings.baseCurrency },
      targetNetWorthIsReal: cleared
        ? undefined
        : (parsed.inTodaysMoney ?? false),
    },
  };
}

export function applySaveMortgageScenario(
  data: AssetTrackerData,
  input: SaveMortgageScenarioInput,
  recordedAt: string,
): AssetTrackerData {
  const parsed = SaveMortgageScenarioInputSchema.parse(input);
  const takenScenarioIds = new Set(
    (data.mortgageScenarios ?? []).map((scenario) => scenario.id),
  );
  const scenarioId = uniqueId(
    takenScenarioIds,
    normalizeSlug(parsed.name) || "mortgage-scenario",
  );
  if (parsed.source.mortgageAccountId != null) {
    requireAccount(data, parsed.source.mortgageAccountId);
  }
  if (parsed.source.propertyAccountId != null) {
    requireAccount(data, parsed.source.propertyAccountId);
  }
  const decisionId = parsed.recordDecision
    ? uniqueId(
        new Set((data.decisionRecords ?? []).map((decision) => decision.id)),
        `${scenarioId}-decision`,
      )
    : undefined;
  return {
    ...data,
    mortgageScenarios: [
      ...(data.mortgageScenarios ?? []),
      {
        id: scenarioId,
        name: parsed.name,
        createdAt: recordedAt,
        assumptions: parsed.assumptions,
        source: parsed.source,
        ...(decisionId == null ? {} : { decisionRecordId: decisionId }),
      },
    ],
    decisionRecords:
      decisionId == null
        ? (data.decisionRecords ?? [])
        : [
            ...(data.decisionRecords ?? []),
            {
              id: decisionId,
              kind: "mortgage",
              title: parsed.name,
              scenarioId,
              recordedAt,
              status: "recorded",
            },
          ],
  };
}

function requireJobMoveScenario(data: AssetTrackerData, id: string) {
  const scenario = (data.jobMoveScenarios ?? []).find(
    (candidate) => candidate.id === id,
  );
  if (scenario == null) {
    throw new AssetTrackerCommandError(
      "JOB_MOVE_SCENARIO_NOT_FOUND",
      `No job-move scenario found with ID ${id}`,
    );
  }
  return scenario;
}

function validateJobMoveScenarioReferences(
  data: AssetTrackerData,
  input: SaveJobMoveScenarioInput["scenario"],
) {
  if (input.destinationAccountId != null) {
    requireAccount(data, input.destinationAccountId);
  }
  if (input.pensionAccountId != null) {
    requireAccount(data, input.pensionAccountId);
  }
  const flowIds = new Set(data.recurringFlows.map(({ id }) => id));
  for (const flowId of input.replacedRecurringFlowIds) {
    if (!flowIds.has(flowId)) {
      throw new AssetTrackerCommandError(
        "FLOW_NOT_FOUND",
        `No recurring flow found with ID ${flowId}`,
      );
    }
  }
}

export function applySaveJobMoveScenario(
  data: AssetTrackerData,
  input: SaveJobMoveScenarioInput,
  recordedAt: string,
): AssetTrackerData {
  const parsed = SaveJobMoveScenarioInputSchema.parse(input);
  validateJobMoveScenarioReferences(data, parsed.scenario);
  const existing =
    parsed.id == null ? null : requireJobMoveScenario(data, parsed.id);
  const id =
    existing?.id ??
    uniqueId(
      new Set((data.jobMoveScenarios ?? []).map((scenario) => scenario.id)),
      normalizeSlug(parsed.scenario.name) || "job-move-scenario",
    );
  const scenario = JobMoveScenarioSchema.parse({
    ...parsed.scenario,
    id,
    createdAt: existing?.createdAt ?? recordedAt,
    updatedAt: recordedAt,
  });
  calculateJobMoveCompensation(scenario);
  return {
    ...data,
    jobMoveScenarios:
      existing == null
        ? [...(data.jobMoveScenarios ?? []), scenario]
        : (data.jobMoveScenarios ?? []).map((candidate) =>
            candidate.id === existing.id ? scenario : candidate,
          ),
  };
}

export function applyDuplicateJobMoveScenario(
  data: AssetTrackerData,
  input: JobMoveScenarioIdInput,
  recordedAt: string,
): AssetTrackerData {
  const parsed = JobMoveScenarioIdInputSchema.parse(input);
  const source = requireJobMoveScenario(data, parsed.id);
  const name = `${source.name} copy`;
  const duplicate = JobMoveScenarioSchema.parse({
    ...source,
    id: uniqueId(
      new Set((data.jobMoveScenarios ?? []).map((scenario) => scenario.id)),
      normalizeSlug(name) || "job-move-scenario-copy",
    ),
    name,
    createdAt: recordedAt,
    updatedAt: recordedAt,
  });
  return {
    ...data,
    jobMoveScenarios: [...(data.jobMoveScenarios ?? []), duplicate],
  };
}

export function applyDeleteJobMoveScenario(
  data: AssetTrackerData,
  input: JobMoveScenarioIdInput,
): AssetTrackerData {
  const parsed = JobMoveScenarioIdInputSchema.parse(input);
  requireJobMoveScenario(data, parsed.id);
  return {
    ...data,
    jobMoveScenarios: (data.jobMoveScenarios ?? []).filter(
      (scenario) => scenario.id !== parsed.id,
    ),
  };
}

/** Maps validation and command failures to a message safe to show in a form */
export function formatAssetTrackerError(error: unknown): string {
  if (error instanceof AssetTrackerCommandError) return error.message;
  if (error instanceof AssetTrackerDataError) return error.message;
  if (error instanceof z.ZodError) {
    return error.issues[0]?.message ?? "Invalid input";
  }
  if (error instanceof SyntaxError) return "File is not valid JSON";
  return "Something went wrong";
}
