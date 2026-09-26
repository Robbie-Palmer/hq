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
  | "INVALID_RECURRING_FLOW_CONVERSION"
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

export function todayIsoDate(): string {
  // Local calendar date, not UTC — toISOString() would roll over around
  // local midnight and record the wrong day
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

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
    )
  ) {
    throw new AssetTrackerCommandError(
      "ACCOUNT_HAS_PLANNED_EXPENDITURES",
      `"${account.name}" funds planned spending; delete or reassign it before ${action}`,
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
): { data: AssetTrackerData; account: Account } {
  const parsed = CreateAccountInputSchema.parse(input);
  if (parsed.linkedAccountId != null) {
    requireAccount(data, parsed.linkedAccountId);
  }
  const openingDate = parsed.openingDate ?? todayIsoDate();
  const account = AccountContentSchema.parse({
    id: uniqueAccountId(data, parsed.name),
    name: parsed.name,
    provider: parsed.provider,
    currency: parsed.currency,
    assetType: parsed.assetType,
    liquidity: parsed.liquidity,
    expectedAnnualReturn: parsed.expectedAnnualReturn,
    linkedAccountId: parsed.linkedAccountId,
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
  return {
    ...data,
    snapshots: Array.from(snapshotsByAccountDate.values()),
    capitalFlows: Array.from(capitalFlowsByAccountDate.values()),
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
  return {
    ...data,
    incomeHistory: Array.from(byDate, ([date, amount]) => ({
      date,
      amount,
      currency: data.settings.baseCurrency,
    })).sort((a, b) => a.date.localeCompare(b.date)),
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
): AssetTrackerData {
  const startDate = input.startDate ?? todayIsoDate();
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
  if (parsed.date <= todayIsoDate()) {
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
  return { ...data, plannedExpenditures };
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
