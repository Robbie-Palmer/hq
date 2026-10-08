import { z } from "zod";
import { normalizeSlug } from "../../generic/slugs";
import type { AssetTrackerData } from "./assetTrackerData";
import { capitalFlowKind } from "./capitalFlow";
import type { ForecastAssumptionSet } from "./forecastAssumption";
import type { FutureCashFlow } from "./futureCashFlow";

export const DEFAULT_HOUSEHOLD_MEMBER_ID = "primary";

export const HouseholdMemberSchema = z.object({
  id: z.string().trim().min(1),
  displayName: z.string().trim().min(1, "Enter a display name"),
});
export type HouseholdMember = z.infer<typeof HouseholdMemberSchema>;

const OwnershipShareSchema = z.object({
  memberId: z.string().trim().min(1),
  share: z.number().positive().max(1),
});

export const OwnershipSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("personal"),
    memberId: z.string().trim().min(1),
  }),
  z
    .object({
      kind: z.literal("shared"),
      shares: z.array(OwnershipShareSchema).min(2),
    })
    .superRefine(({ shares }, context) => {
      if (
        new Set(shares.map(({ memberId }) => memberId)).size !== shares.length
      ) {
        context.addIssue({
          code: "custom",
          message: "Shared ownership must name each member once",
        });
      }
      const total = shares.reduce((sum, { share }) => sum + share, 0);
      if (Math.abs(total - 1) > 1e-6) {
        context.addIssue({
          code: "custom",
          message: "Shared ownership shares must total 100%",
        });
      }
    }),
]);
export type Ownership = z.infer<typeof OwnershipSchema>;

export const HouseholdScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("household") }),
  z.object({
    kind: z.literal("member"),
    memberId: z.string().trim().min(1),
  }),
]);
export type HouseholdScope = z.infer<typeof HouseholdScopeSchema>;

export const HouseholdSchema = z.object({
  members: z.array(HouseholdMemberSchema).min(1),
  activeScope: HouseholdScopeSchema,
});
export type Household = z.infer<typeof HouseholdSchema>;

export const DEFAULT_HOUSEHOLD: Household = {
  members: [{ id: DEFAULT_HOUSEHOLD_MEMBER_ID, displayName: "Me" }],
  activeScope: { kind: "household" },
};

const OwnershipRecordSchema = z.record(z.string(), OwnershipSchema);

export const HouseholdOwnershipIndexSchema = z.object({
  accounts: OwnershipRecordSchema.default({}),
  snapshots: OwnershipRecordSchema.default({}),
  capitalFlows: OwnershipRecordSchema.default({}),
  incomeHistory: OwnershipRecordSchema.default({}),
  transfers: OwnershipRecordSchema.default({}),
  recurringFlows: OwnershipRecordSchema.default({}),
  plannedExpenditures: OwnershipRecordSchema.default({}),
  futureCashFlows: OwnershipRecordSchema.default({}),
  holdingObservations: OwnershipRecordSchema.default({}),
});
export type HouseholdOwnershipIndex = z.infer<
  typeof HouseholdOwnershipIndexSchema
>;

export const EMPTY_HOUSEHOLD_OWNERSHIP: HouseholdOwnershipIndex = {
  accounts: {},
  snapshots: {},
  capitalFlows: {},
  incomeHistory: {},
  transfers: {},
  recurringFlows: {},
  plannedExpenditures: {},
  futureCashFlows: {},
  holdingObservations: {},
};

export function defaultHouseholdFields(): Pick<
  AssetTrackerData,
  "household" | "ownership"
> {
  return {
    household: {
      members: DEFAULT_HOUSEHOLD.members.map((member) => ({ ...member })),
      activeScope: { kind: "household" },
    },
    ownership: {
      accounts: {},
      snapshots: {},
      capitalFlows: {},
      incomeHistory: {},
      transfers: {},
      recurringFlows: {},
      plannedExpenditures: {},
      futureCashFlows: {},
      holdingObservations: {},
    },
  };
}

export const AddHouseholdMemberInputSchema = z.object({
  displayName: z.string().trim().min(1, "Enter a display name"),
});
export type AddHouseholdMemberInput = z.infer<
  typeof AddHouseholdMemberInputSchema
>;

export const RenameHouseholdMemberInputSchema = z.object({
  memberId: z.string().trim().min(1),
  displayName: z.string().trim().min(1, "Enter a display name"),
});
export type RenameHouseholdMemberInput = z.infer<
  typeof RenameHouseholdMemberInputSchema
>;

export const SetAccountOwnershipInputSchema = z.object({
  accountId: z.string().trim().min(1),
  ownership: OwnershipSchema,
});
export type SetAccountOwnershipInput = z.infer<
  typeof SetAccountOwnershipInputSchema
>;

export function snapshotOwnershipKey(accountId: string, date: string): string {
  return `${accountId}\0${date}`;
}

export function capitalFlowOwnershipKey(input: {
  accountId: string;
  date: string;
  kind?: "personalSaving" | "debtPrincipal" | "external";
}): string {
  return `${input.accountId}\0${input.date}\0${capitalFlowKind(input)}`;
}

export function personalOwnership(memberId: string): Ownership {
  return { kind: "personal", memberId };
}

export function equalSharedOwnership(
  members: readonly HouseholdMember[],
): Ownership {
  if (members.length < 2)
    return personalOwnership(members[0]?.id ?? DEFAULT_HOUSEHOLD_MEMBER_ID);
  const share = 1 / members.length;
  return {
    kind: "shared",
    shares: members.map(({ id }) => ({ memberId: id, share })),
  };
}

export function ownershipShare(ownership: Ownership, memberId: string): number {
  if (ownership.kind === "personal") {
    return ownership.memberId === memberId ? 1 : 0;
  }
  return (
    ownership.shares.find((share) => share.memberId === memberId)?.share ?? 0
  );
}

export function ownershipLabel(
  ownership: Ownership,
  members: readonly HouseholdMember[],
): string {
  const names = new Map(
    members.map(({ id, displayName }) => [id, displayName]),
  );
  if (ownership.kind === "personal") {
    return names.get(ownership.memberId) ?? "Unknown member";
  }
  return ownership.shares
    .map(
      ({ memberId, share }) =>
        `${names.get(memberId) ?? "Unknown member"} ${Math.round(share * 100)}%`,
    )
    .join(", ");
}

type MigratableData = {
  household: Household;
  ownership: HouseholdOwnershipIndex;
  accounts: Array<{ id: string }>;
  snapshots: Array<{ accountId: string; date: string }>;
  capitalFlows: Array<{
    accountId: string;
    date: string;
    kind?: "personalSaving" | "debtPrincipal" | "external";
  }>;
  incomeHistory: Array<{ date: string }>;
  transfers: Array<{
    id: string;
    fromAccountId?: string;
    toAccountId?: string;
  }>;
  recurringFlows: Array<{
    id: string;
    fromAccountId?: string;
    toAccountId?: string;
  }>;
  plannedExpenditures: Array<{ id: string; fromAccountId: string }>;
  futureCashFlows: Array<{
    id: string;
    stages: Array<{ fromAccountId: string }>;
  }>;
  holdingObservations?: Array<{ id: string; accountId: string }>;
};

function fallbackOwner(data: MigratableData): Ownership {
  return personalOwnership(
    data.household.members[0]?.id ?? DEFAULT_HOUSEHOLD_MEMBER_ID,
  );
}

export function migrateHouseholdOwnership<T extends MigratableData>(
  data: T,
): T {
  const fallback = fallbackOwner(data);
  const accounts = { ...data.ownership.accounts };
  for (const account of data.accounts) accounts[account.id] ??= fallback;
  const ownerFor = (accountId: string | undefined) =>
    accountId == null ? fallback : (accounts[accountId] ?? fallback);
  const snapshots = { ...data.ownership.snapshots };
  for (const row of data.snapshots) {
    snapshots[snapshotOwnershipKey(row.accountId, row.date)] ??= ownerFor(
      row.accountId,
    );
  }
  const capitalFlows = { ...data.ownership.capitalFlows };
  for (const row of data.capitalFlows) {
    capitalFlows[capitalFlowOwnershipKey(row)] ??= ownerFor(row.accountId);
  }
  const incomeHistory = { ...data.ownership.incomeHistory };
  for (const row of data.incomeHistory) incomeHistory[row.date] ??= fallback;
  const transfers = { ...data.ownership.transfers };
  for (const row of data.transfers) {
    transfers[row.id] ??= ownerFor(row.toAccountId ?? row.fromAccountId);
  }
  const recurringFlows = { ...data.ownership.recurringFlows };
  for (const row of data.recurringFlows) {
    recurringFlows[row.id] ??= ownerFor(row.toAccountId ?? row.fromAccountId);
  }
  const plannedExpenditures = { ...data.ownership.plannedExpenditures };
  for (const row of data.plannedExpenditures) {
    plannedExpenditures[row.id] ??= ownerFor(row.fromAccountId);
  }
  const futureCashFlows = { ...data.ownership.futureCashFlows };
  for (const row of data.futureCashFlows) {
    futureCashFlows[row.id] ??= ownerFor(row.stages[0]?.fromAccountId);
  }
  const holdingObservations = { ...data.ownership.holdingObservations };
  for (const row of data.holdingObservations ?? []) {
    holdingObservations[row.id] ??= ownerFor(row.accountId);
  }
  return {
    ...data,
    ownership: {
      accounts,
      snapshots,
      capitalFlows,
      incomeHistory,
      transfers,
      recurringFlows,
      plannedExpenditures,
      futureCashFlows,
      holdingObservations,
    },
  };
}

function nextMemberId(data: AssetTrackerData, displayName: string): string {
  const base = normalizeSlug(displayName) || "member";
  const taken = new Set(data.household.members.map(({ id }) => id));
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

export function applyAddHouseholdMember(
  data: AssetTrackerData,
  input: AddHouseholdMemberInput,
): AssetTrackerData {
  const parsed = AddHouseholdMemberInputSchema.parse(input);
  return {
    ...data,
    household: {
      ...data.household,
      members: [
        ...data.household.members,
        {
          id: nextMemberId(data, parsed.displayName),
          displayName: parsed.displayName,
        },
      ],
    },
  };
}

export function applyRenameHouseholdMember(
  data: AssetTrackerData,
  input: RenameHouseholdMemberInput,
): AssetTrackerData {
  const parsed = RenameHouseholdMemberInputSchema.parse(input);
  if (!data.household.members.some(({ id }) => id === parsed.memberId)) {
    throw new Error(`Unknown household member "${parsed.memberId}"`);
  }
  return {
    ...data,
    household: {
      ...data.household,
      members: data.household.members.map((member) =>
        member.id === parsed.memberId
          ? { ...member, displayName: parsed.displayName }
          : member,
      ),
    },
  };
}

export function applySetActiveHouseholdScope(
  data: AssetTrackerData,
  scope: HouseholdScope,
): AssetTrackerData {
  const parsed = HouseholdScopeSchema.parse(scope);
  if (
    parsed.kind === "member" &&
    !data.household.members.some(({ id }) => id === parsed.memberId)
  ) {
    throw new Error(`Unknown household member "${parsed.memberId}"`);
  }
  return { ...data, household: { ...data.household, activeScope: parsed } };
}

export function applySetAccountOwnership(
  data: AssetTrackerData,
  input: SetAccountOwnershipInput,
): AssetTrackerData {
  const parsed = SetAccountOwnershipInputSchema.parse(input);
  if (!data.accounts.some(({ id }) => id === parsed.accountId)) {
    throw new Error(`Unknown account "${parsed.accountId}"`);
  }
  assertOwnershipMembers(data.household, parsed.ownership);
  const ownership = {
    ...data.ownership,
    accounts: {
      ...data.ownership.accounts,
      [parsed.accountId]: parsed.ownership,
    },
    snapshots: { ...data.ownership.snapshots },
    capitalFlows: { ...data.ownership.capitalFlows },
    holdingObservations: { ...data.ownership.holdingObservations },
    plannedExpenditures: { ...data.ownership.plannedExpenditures },
    futureCashFlows: { ...data.ownership.futureCashFlows },
  };
  for (const row of data.snapshots.filter(
    ({ accountId }) => accountId === parsed.accountId,
  )) {
    ownership.snapshots[snapshotOwnershipKey(row.accountId, row.date)] =
      parsed.ownership;
  }
  for (const row of data.capitalFlows.filter(
    ({ accountId }) => accountId === parsed.accountId,
  )) {
    ownership.capitalFlows[capitalFlowOwnershipKey(row)] = parsed.ownership;
  }
  for (const row of (data.holdingObservations ?? []).filter(
    ({ accountId }) => accountId === parsed.accountId,
  )) {
    ownership.holdingObservations[row.id] = parsed.ownership;
  }
  for (const row of data.plannedExpenditures.filter(
    ({ fromAccountId }) => fromAccountId === parsed.accountId,
  )) {
    ownership.plannedExpenditures[row.id] = parsed.ownership;
  }
  for (const row of data.futureCashFlows.filter(
    (record) => record.stages[0]?.fromAccountId === parsed.accountId,
  )) {
    ownership.futureCashFlows[row.id] = parsed.ownership;
  }
  return { ...data, ownership };
}

export function assertOwnershipMembers(
  household: Household,
  ownership: Ownership,
): void {
  const memberIds = new Set(household.members.map(({ id }) => id));
  const referenced =
    ownership.kind === "personal"
      ? [ownership.memberId]
      : ownership.shares.map(({ memberId }) => memberId);
  for (const memberId of referenced) {
    if (!memberIds.has(memberId))
      throw new Error(
        `Ownership references unknown household member "${memberId}"`,
      );
  }
}

export function validateHouseholdOwnership(data: AssetTrackerData): void {
  const ids = data.household.members.map(({ id }) => id);
  if (new Set(ids).size !== ids.length)
    throw new Error("Household member IDs must be unique");
  if (data.household.activeScope.kind === "member") {
    assertOwnershipMembers(
      data.household,
      personalOwnership(data.household.activeScope.memberId),
    );
  }
  for (const collection of Object.values(data.ownership)) {
    for (const ownership of Object.values(collection)) {
      assertOwnershipMembers(data.household, ownership);
    }
  }
  for (const assumption of data.forecastAssumptionSets.flatMap(
    ({ assumptions }) => assumptions,
  )) {
    assertOwnershipMembers(data.household, assumption.ownership);
  }
}

function scale(value: number, share: number): number {
  return Math.round(value * share * 100) / 100;
}

export function scopeAssetTrackerData(
  data: AssetTrackerData,
): AssetTrackerData {
  const scope = data.household.activeScope;
  if (scope.kind === "household") return data;
  const share = (ownership: Ownership | undefined) =>
    ownership == null ? 0 : ownershipShare(ownership, scope.memberId);
  const keptAccountIds = new Set(
    data.accounts
      .filter(({ id }) => share(data.ownership.accounts[id]) > 0)
      .map(({ id }) => id),
  );
  const accounts = data.accounts
    .filter(({ id }) => keptAccountIds.has(id))
    .map((account) =>
      account.linkedAccountId != null &&
      !keptAccountIds.has(account.linkedAccountId)
        ? { ...account, linkedAccountId: undefined }
        : account,
    );
  const snapshots = data.snapshots.flatMap((row) => {
    if (!keptAccountIds.has(row.accountId)) return [];
    const fraction = share(
      data.ownership.snapshots[snapshotOwnershipKey(row.accountId, row.date)],
    );
    return fraction > 0
      ? [{ ...row, balance: scale(row.balance, fraction) }]
      : [];
  });
  const capitalFlows = data.capitalFlows.flatMap((row) => {
    if (!keptAccountIds.has(row.accountId)) return [];
    const fraction = share(
      data.ownership.capitalFlows[capitalFlowOwnershipKey(row)],
    );
    return fraction > 0
      ? [{ ...row, amount: scale(row.amount, fraction) }]
      : [];
  });
  const incomeHistory = data.incomeHistory.flatMap((row) => {
    const fraction = share(data.ownership.incomeHistory[row.date]);
    return fraction > 0
      ? [{ ...row, amount: scale(row.amount, fraction) }]
      : [];
  });
  const transfers = data.transfers.flatMap((row) => {
    const referencesKeptAccounts =
      (row.fromAccountId == null || keptAccountIds.has(row.fromAccountId)) &&
      (row.toAccountId == null || keptAccountIds.has(row.toAccountId));
    const fraction = share(data.ownership.transfers[row.id]);
    if (!referencesKeptAccounts || fraction <= 0) return [];
    return [
      {
        ...row,
        amount: scale(row.amount, fraction),
        ...(row.fromAmount == null
          ? {}
          : { fromAmount: scale(row.fromAmount, fraction) }),
        ...(row.toAmount == null
          ? {}
          : { toAmount: scale(row.toAmount, fraction) }),
        ...(row.feeAmount == null
          ? {}
          : { feeAmount: scale(row.feeAmount, fraction) }),
      },
    ];
  });
  const recurringFlows = data.recurringFlows.flatMap((row) => {
    const referencesKeptAccounts =
      (row.fromAccountId == null || keptAccountIds.has(row.fromAccountId)) &&
      (row.toAccountId == null || keptAccountIds.has(row.toAccountId));
    const fraction = share(data.ownership.recurringFlows[row.id]);
    if (!referencesKeptAccounts || fraction <= 0) return [];
    return [
      {
        ...row,
        ...(row.amount == null ? {} : { amount: scale(row.amount, fraction) }),
        ...(row.grossAmount == null
          ? {}
          : { grossAmount: scale(row.grossAmount, fraction) }),
      },
    ];
  });
  const plannedExpenditures = data.plannedExpenditures.flatMap((row) => {
    if (!keptAccountIds.has(row.fromAccountId)) return [];
    const fraction = share(data.ownership.plannedExpenditures[row.id]);
    return fraction > 0
      ? [{ ...row, amount: scale(row.amount, fraction) }]
      : [];
  });
  const scopedFutureCashFlows = data.futureCashFlows.flatMap(
    (record): FutureCashFlow[] => {
      const stages = record.stages.filter(({ fromAccountId }) =>
        keptAccountIds.has(fromAccountId),
      );
      const fraction = share(data.ownership.futureCashFlows[record.id]);
      if (stages.length === 0 || fraction <= 0) return [];
      if (record.kind === "commitment") {
        return [
          {
            ...record,
            stages: record.stages
              .filter(({ fromAccountId }) => keptAccountIds.has(fromAccountId))
              .map((stage) => ({
                ...stage,
                amount: scale(stage.amount, fraction),
                actuals: stage.actuals.map((actual) => ({
                  ...actual,
                  amount: scale(actual.amount, fraction),
                })),
              })),
          },
        ];
      }
      return [
        {
          ...record,
          stages: record.stages
            .filter(({ fromAccountId }) => keptAccountIds.has(fromAccountId))
            .map((stage) => ({
              ...stage,
              minimumAmount: scale(stage.minimumAmount, fraction),
              expectedAmount: scale(stage.expectedAmount, fraction),
              maximumAmount: scale(stage.maximumAmount, fraction),
              actuals: stage.actuals.map((actual) => ({
                ...actual,
                amount: scale(actual.amount, fraction),
              })),
            })),
        },
      ];
    },
  );
  const keptFutureCashFlowIds = new Set(
    scopedFutureCashFlows.map(({ id }) => id),
  );
  const futureCashFlows = scopedFutureCashFlows.map((record) =>
    record.kind === "decision"
      ? {
          ...record,
          dependencyIds: record.dependencyIds.filter((id) =>
            keptFutureCashFlowIds.has(id),
          ),
          alternativeToIds: record.alternativeToIds.filter((id) =>
            keptFutureCashFlowIds.has(id),
          ),
        }
      : record,
  );
  const forecastAssumptionSets = data.forecastAssumptionSets.map(
    (set): ForecastAssumptionSet => ({
      ...set,
      assumptions: set.assumptions.flatMap((assumption) => {
        if (
          assumption.accountId != null &&
          !keptAccountIds.has(assumption.accountId)
        ) {
          return [];
        }
        const fraction = share(assumption.ownership);
        if (fraction <= 0) return [];
        return [
          {
            ...assumption,
            monthlyChange: {
              minimum: scale(assumption.monthlyChange.minimum, fraction),
              expected: scale(assumption.monthlyChange.expected, fraction),
              maximum: scale(assumption.monthlyChange.maximum, fraction),
            },
            ownership: personalOwnership(scope.memberId),
          },
        ];
      }),
    }),
  );
  const emergencyFundPlans = (data.emergencyFundPlans ?? []).map((plan) => ({
    ...plan,
    accountPolicies: plan.accountPolicies.filter(({ accountId }) =>
      keptAccountIds.has(accountId),
    ),
  }));
  const mortgageScenarios = (data.mortgageScenarios ?? []).filter(
    ({ source }) =>
      (source.mortgageAccountId == null ||
        keptAccountIds.has(source.mortgageAccountId)) &&
      (source.propertyAccountId == null ||
        keptAccountIds.has(source.propertyAccountId)),
  );
  const keptScenarioIds = new Set(
    mortgageScenarios.map((scenario) => scenario.id),
  );
  const decisionRecords = (data.decisionRecords ?? []).filter((decision) =>
    keptScenarioIds.has(decision.scenarioId),
  );
  const holdingObservations = (data.holdingObservations ?? []).flatMap(
    (row) => {
      if (!keptAccountIds.has(row.accountId)) return [];
      const fraction = share(data.ownership.holdingObservations[row.id]);
      return fraction > 0
        ? [{ ...row, quantity: row.quantity * fraction }]
        : [];
    },
  );
  const propertyIndexHistories = (data.propertyIndexHistories ?? []).flatMap(
    (history) => {
      if (!keptAccountIds.has(history.accountId)) return [];
      const fraction = share(data.ownership.accounts[history.accountId]);
      if (fraction <= 0) return [];
      return [
        {
          ...history,
          input: {
            ...history.input,
            recordedValuations: history.input.recordedValuations.map(
              (valuation) => ({
                ...valuation,
                value: scale(valuation.value, fraction),
              }),
            ),
          },
        },
      ];
    },
  );
  const propertyComparableSearches = (
    data.propertyComparableSearches ?? []
  ).filter(({ accountId }) => keptAccountIds.has(accountId));
  return {
    ...data,
    accounts,
    snapshots,
    capitalFlows,
    incomeHistory,
    transfers,
    recurringFlows,
    plannedExpenditures,
    futureCashFlows,
    forecastAssumptionSets,
    emergencyFundPlans,
    mortgageScenarios,
    decisionRecords,
    holdingObservations,
    propertyComparableSearches,
    propertyIndexHistories,
  };
}
