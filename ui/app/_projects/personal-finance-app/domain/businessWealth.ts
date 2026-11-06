import { z } from "zod";
import type { Account } from "./account";
import { AccountIdSchema } from "./account";
import { CurrencySchema } from "./currency";
import type {
  Household,
  HouseholdOwnershipIndex,
  Ownership,
} from "./household";

export const BUSINESS_WEALTH_CALCULATION_VERSION =
  "business-wealth-consolidation-v1" as const;
export const LEGACY_BUSINESS_WEALTH_ACCEPTED_AT =
  "2026-11-06T00:00:00.000Z" as const;
export const LEGACY_BUSINESS_WEALTH_SOURCE_REVISION =
  "legacy-household-ownership-v1" as const;

const RecordIdSchema = z.string().trim().min(1);
const EntityIdSchema = z.string().trim().min(1);

export const FinancialRecordLineageSchema = z.object({
  kind: z.enum(["manual", "import", "provider", "migration", "derived"]),
  sourceId: z.string().trim().min(1),
  sourceRevision: z.string().trim().min(1),
  parentRecordIds: z.array(RecordIdSchema).default([]),
});
export type FinancialRecordLineage = z.infer<
  typeof FinancialRecordLineageSchema
>;

const TemporalRecordShape = {
  recordId: RecordIdSchema,
  effectiveFrom: z.iso.date(),
  effectiveTo: z.iso.date().optional(),
  acceptedAt: z.iso.datetime({ offset: true }),
  lineage: FinancialRecordLineageSchema,
  correctsId: RecordIdSchema.optional(),
};

const FinancialEntityRevisionShape = {
  ...TemporalRecordShape,
  entityId: EntityIdSchema,
};

export const CompanyStructureSchema = z.enum([
  "uk-limited-company",
  "partnership",
  "overseas-company",
  "foreign-llc",
  "other",
  "structure-not-recorded",
]);

export const FinancialEntityRecordSchema = z.discriminatedUnion("kind", [
  z.object({
    ...FinancialEntityRevisionShape,
    kind: z.literal("person"),
    displayName: z.string().trim().min(1),
    householdMemberId: z.string().trim().min(1).optional(),
    authenticatedUserId: z.string().trim().min(1).optional(),
  }),
  z.object({
    ...FinancialEntityRevisionShape,
    kind: z.literal("company"),
    name: z.string().trim().min(1),
    structure: CompanyStructureSchema,
    jurisdiction: z.string().trim().min(1),
    incorporatedOn: z.iso.date().optional(),
    registrationId: z.string().trim().min(1).optional(),
  }),
]);
export type FinancialEntityRecord = z.infer<typeof FinancialEntityRecordSchema>;

const OwnershipAllocationSchema = z.object({
  entityId: EntityIdSchema,
  fraction: z.number().positive().max(1),
});

export const AccountOwnershipStateSchema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("known"),
      allocations: z.array(OwnershipAllocationSchema).min(1),
    })
    .superRefine(({ allocations }, context) => {
      if (
        new Set(allocations.map(({ entityId }) => entityId)).size !==
        allocations.length
      ) {
        context.addIssue({
          code: "custom",
          message: "Account ownership must name each entity once",
        });
      }
      const total = allocations.reduce(
        (sum, allocation) => sum + allocation.fraction,
        0,
      );
      if (Math.abs(total - 1) > 1e-6) {
        context.addIssue({
          code: "custom",
          message: "Known account ownership allocations must total 100%",
        });
      }
    }),
  z
    .object({
      state: z.literal("candidate-owners"),
      candidateEntityIds: z.array(EntityIdSchema).min(1),
    })
    .refine(
      ({ candidateEntityIds }) =>
        new Set(candidateEntityIds).size === candidateEntityIds.length,
      {
        message: "Candidate account owners must be unique",
        path: ["candidateEntityIds"],
      },
    ),
  z.object({
    state: z.literal("unsupported"),
    reason: z.string().trim().min(1),
    candidateEntityIds: z.array(EntityIdSchema).default([]),
  }),
]);
export type AccountOwnershipState = z.infer<typeof AccountOwnershipStateSchema>;

export const AccountOwnershipRecordSchema = z.object({
  ...TemporalRecordShape,
  accountId: AccountIdSchema,
  ownership: AccountOwnershipStateSchema,
});
export type AccountOwnershipRecord = z.infer<
  typeof AccountOwnershipRecordSchema
>;

export const FractionStateSchema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("known"),
    fraction: z.number().positive().max(1),
  }),
  z.object({ state: z.literal("fraction-not-recorded") }),
  z.object({
    state: z.literal("unsupported"),
    reason: z.string().trim().min(1),
  }),
]);
export type FractionState = z.infer<typeof FractionStateSchema>;

export const ShareOwnershipInterestSchema = z.object({
  ...TemporalRecordShape,
  interestId: z.string().trim().min(1),
  ownerEntityId: EntityIdSchema,
  companyEntityId: EntityIdSchema,
  interestClass: z.string().trim().min(1),
  fraction: FractionStateSchema,
});
export type ShareOwnershipInterest = z.infer<
  typeof ShareOwnershipInterestSchema
>;

export const MonetaryStateSchema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("known"),
    currency: CurrencySchema,
    amount: z.number().nonnegative(),
  }),
  z.object({
    state: z.literal("amount-not-recorded"),
    currency: CurrencySchema,
  }),
  z.object({
    state: z.literal("unsupported"),
    currency: CurrencySchema,
    reason: z.string().trim().min(1),
  }),
]);
export type MonetaryState = z.infer<typeof MonetaryStateSchema>;

export const SignedMonetaryStateSchema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("known"),
    currency: CurrencySchema,
    amount: z.number(),
  }),
  z.object({
    state: z.literal("amount-not-recorded"),
    currency: CurrencySchema,
  }),
  z.object({
    state: z.literal("unsupported"),
    currency: CurrencySchema,
    reason: z.string().trim().min(1),
  }),
]);
export type SignedMonetaryState = z.infer<typeof SignedMonetaryStateSchema>;

export const EntityObligationSchema = z.object({
  ...TemporalRecordShape,
  obligationId: z.string().trim().min(1),
  entityId: EntityIdSchema,
  kind: z.enum([
    "corporation-tax",
    "vat",
    "payroll",
    "personal-tax",
    "payable",
    "other",
  ]),
  jurisdiction: z.string().trim().min(1),
  periodStart: z.iso.date(),
  periodEnd: z.iso.date(),
  dueDate: z.iso.date(),
  status: z.enum([
    "estimated",
    "assessed",
    "due",
    "paid",
    "status-not-recorded",
  ]),
  amount: MonetaryStateSchema,
});
export type EntityObligation = z.infer<typeof EntityObligationSchema>;

export const CompanyValuationInputsSchema = z.object({
  accountIds: z.array(AccountIdSchema),
  accountObservationIds: z.array(RecordIdSchema),
  liabilityAccountObservationIds: z.array(RecordIdSchema),
  obligationIds: z.array(RecordIdSchema),
  exchangeRateObservationIds: z.array(RecordIdSchema),
  assumptionIds: z.array(RecordIdSchema),
  calculationVersion: z.string().trim().min(1),
});

export const CompanyEquityValuationSchema = z
  .object({
    recordId: RecordIdSchema,
    companyEntityId: EntityIdSchema,
    validAt: z.iso.date(),
    acceptedAt: z.iso.datetime({ offset: true }),
    method: z.enum(["adjusted-net-assets", "manual", "externally-supported"]),
    amount: SignedMonetaryStateSchema,
    lineage: FinancialRecordLineageSchema,
    correctsId: RecordIdSchema.optional(),
    inputs: CompanyValuationInputsSchema.optional(),
  })
  .superRefine((valuation, context) => {
    if (
      valuation.method === "adjusted-net-assets" &&
      valuation.inputs == null
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Adjusted-net-assets valuations must retain their account, liability, obligation, exchange-rate, assumption, and calculation inputs",
        path: ["inputs"],
      });
    }
  });
export type CompanyEquityValuation = z.infer<
  typeof CompanyEquityValuationSchema
>;

export const EntityTransferClassificationSchema = z.discriminatedUnion(
  "state",
  [
    z.object({
      state: z.literal("known"),
      kind: z.enum([
        "salary",
        "dividend",
        "employer-pension-contribution",
        "director-loan",
        "capital-contribution",
        "expense-reimbursement",
        "asset-sale",
        "other",
      ]),
    }),
    z.object({ state: z.literal("classification-not-recorded") }),
    z.object({
      state: z.literal("unsupported"),
      reason: z.string().trim().min(1),
    }),
  ],
);

export const TransferEndpointSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("entity"), entityId: EntityIdSchema }),
  z.object({
    kind: z.literal("external"),
    counterpartyId: z.string().trim().min(1),
  }),
]);
export type TransferEndpoint = z.infer<typeof TransferEndpointSchema>;

export const EntityTransferLegSchema = z
  .object({
    id: RecordIdSchema,
    role: z.enum(["source", "destination", "tax", "fee"]),
    endpoint: TransferEndpointSchema,
    amount: MonetaryStateSchema,
    accountId: AccountIdSchema.optional(),
    accountEntryId: RecordIdSchema.optional(),
    financialFactId: RecordIdSchema.optional(),
  })
  .refine((leg) => leg.accountEntryId != null || leg.financialFactId != null, {
    message: "A transfer leg must cite an account entry or financial fact",
  });
export type EntityTransferLeg = z.infer<typeof EntityTransferLegSchema>;

export const EntityTransferSchema = z
  .object({
    ...TemporalRecordShape,
    transferId: z.string().trim().min(1),
    classification: EntityTransferClassificationSchema,
    legs: z.array(EntityTransferLegSchema).min(2),
  })
  .superRefine(({ legs }, context) => {
    for (const role of ["source", "destination"] as const) {
      if (legs.filter((leg) => leg.role === role).length !== 1) {
        context.addIssue({
          code: "custom",
          message: `An entity transfer must have exactly one ${role} leg`,
          path: ["legs"],
        });
      }
    }
    const source = legs.find((leg) => leg.role === "source")?.endpoint;
    const destination = legs.find(
      (leg) => leg.role === "destination",
    )?.endpoint;
    if (
      source?.kind === "entity" &&
      destination?.kind === "entity" &&
      source.entityId === destination.entityId
    ) {
      context.addIssue({
        code: "custom",
        message: "Entity transfer endpoints must differ",
        path: ["legs"],
      });
    }
  });
export type EntityTransfer = z.infer<typeof EntityTransferSchema>;

export const HouseholdAccountValueSchema = z.object({
  recordId: RecordIdSchema,
  accountId: AccountIdSchema,
  validAt: z.iso.date(),
  acceptedAt: z.iso.datetime({ offset: true }),
  amount: SignedMonetaryStateSchema,
  correctsId: RecordIdSchema.optional(),
});
export type HouseholdAccountValue = z.infer<typeof HouseholdAccountValueSchema>;

export const BusinessWealthCollectionsSchema = z.object({
  financialEntities: z.array(FinancialEntityRecordSchema).default([]),
  accountOwnerships: z.array(AccountOwnershipRecordSchema).default([]),
  shareOwnershipInterests: z.array(ShareOwnershipInterestSchema).default([]),
  entityObligations: z.array(EntityObligationSchema).default([]),
  entityTransfers: z.array(EntityTransferSchema).default([]),
  companyEquityValuations: z.array(CompanyEquityValuationSchema).default([]),
});
export type BusinessWealthCollections = z.infer<
  typeof BusinessWealthCollectionsSchema
>;

const LEGACY_LINEAGE: FinancialRecordLineage = {
  kind: "migration",
  sourceId: "assettracker:data:v1",
  sourceRevision: LEGACY_BUSINESS_WEALTH_SOURCE_REVISION,
  parentRecordIds: [],
};

export function legacyPersonEntityId(memberId: string): string {
  return `person:${memberId}`;
}

function legacyOwnershipState(ownership: Ownership): AccountOwnershipState {
  if (ownership.kind === "personal") {
    return {
      state: "known",
      allocations: [
        { entityId: legacyPersonEntityId(ownership.memberId), fraction: 1 },
      ],
    };
  }
  return {
    state: "known",
    allocations: ownership.shares.map(({ memberId, share }) => ({
      entityId: legacyPersonEntityId(memberId),
      fraction: share,
    })),
  };
}

type LegacyBusinessWealthData = BusinessWealthCollections & {
  household: Household;
  ownership: HouseholdOwnershipIndex;
  accounts: Account[];
};

export function migrateLegacyBusinessWealth<T extends LegacyBusinessWealthData>(
  data: T,
): T {
  const financialEntities = [...data.financialEntities];
  const representedMemberIds = new Set(
    financialEntities.flatMap((entity) =>
      entity.kind === "person" && entity.householdMemberId != null
        ? [entity.householdMemberId]
        : [],
    ),
  );
  const earliestAccountDate =
    data.accounts
      .map(({ createdAt }) => createdAt)
      .toSorted((left, right) => left.localeCompare(right))[0] ?? "1970-01-01";
  for (const member of data.household.members) {
    if (representedMemberIds.has(member.id)) continue;
    const entityId = legacyPersonEntityId(member.id);
    financialEntities.push({
      recordId: `legacy-entity:${entityId}`,
      entityId,
      kind: "person",
      displayName: member.displayName,
      householdMemberId: member.id,
      effectiveFrom: earliestAccountDate,
      acceptedAt: LEGACY_BUSINESS_WEALTH_ACCEPTED_AT,
      lineage: LEGACY_LINEAGE,
    });
  }

  const accountOwnerships = [...data.accountOwnerships];
  const representedAccountIds = new Set(
    accountOwnerships.map(({ accountId }) => accountId),
  );
  for (const account of data.accounts) {
    if (representedAccountIds.has(account.id)) continue;
    const ownership = data.ownership.accounts[account.id];
    if (ownership == null) continue;
    accountOwnerships.push({
      recordId: `legacy-account-ownership:${account.id}`,
      accountId: account.id,
      effectiveFrom: account.createdAt,
      acceptedAt: LEGACY_BUSINESS_WEALTH_ACCEPTED_AT,
      lineage: LEGACY_LINEAGE,
      ownership: legacyOwnershipState(ownership),
    });
  }

  return { ...data, financialEntities, accountOwnerships };
}

type CorrectableRecord = {
  recordId: string;
  acceptedAt: string;
  correctsId?: string;
};

export function effectiveFinancialRecords<T extends CorrectableRecord>(
  records: readonly T[],
  asKnownAt?: string,
): T[] {
  const known = records
    .filter((record) => asKnownAt == null || record.acceptedAt <= asKnownAt)
    .toSorted(
      (left, right) =>
        left.acceptedAt.localeCompare(right.acceptedAt) ||
        left.recordId.localeCompare(right.recordId),
    );
  const corrected = new Set(
    known.flatMap((record) =>
      record.correctsId == null ? [] : [record.correctsId],
    ),
  );
  return known.filter((record) => !corrected.has(record.recordId));
}

function containsDate(
  record: { effectiveFrom: string; effectiveTo?: string },
  date: string,
): boolean {
  return (
    record.effectiveFrom <= date &&
    (record.effectiveTo == null || date < record.effectiveTo)
  );
}

export function accountOwnershipAt(
  records: readonly AccountOwnershipRecord[],
  accountId: string,
  validAt: string,
  asKnownAt?: string,
): AccountOwnershipRecord | null {
  return (
    effectiveFinancialRecords(records, asKnownAt)
      .filter(
        (record) =>
          record.accountId === accountId && containsDate(record, validAt),
      )
      .toSorted(
        (left, right) =>
          right.effectiveFrom.localeCompare(left.effectiveFrom) ||
          right.acceptedAt.localeCompare(left.acceptedAt),
      )[0] ?? null
  );
}

export function shareOwnershipAt(
  records: readonly ShareOwnershipInterest[],
  companyEntityId: string,
  validAt: string,
  asKnownAt?: string,
): ShareOwnershipInterest[] {
  return effectiveFinancialRecords(records, asKnownAt).filter(
    (record) =>
      record.companyEntityId === companyEntityId &&
      containsDate(record, validAt),
  );
}

function latestValuationAt(
  records: readonly CompanyEquityValuation[],
  companyEntityId: string,
  validAt: string,
  asKnownAt: string,
): CompanyEquityValuation | null {
  return (
    effectiveFinancialRecords(records, asKnownAt)
      .filter(
        (record) =>
          record.companyEntityId === companyEntityId &&
          record.validAt <= validAt,
      )
      .toSorted(
        (left, right) =>
          right.validAt.localeCompare(left.validAt) ||
          right.acceptedAt.localeCompare(left.acceptedAt),
      )[0] ?? null
  );
}

function latestAccountValueAt(
  records: readonly HouseholdAccountValue[],
  accountId: string,
  validAt: string,
  asKnownAt: string,
): HouseholdAccountValue | null {
  return (
    effectiveFinancialRecords(records, asKnownAt)
      .filter(
        (record) => record.accountId === accountId && record.validAt <= validAt,
      )
      .toSorted(
        (left, right) =>
          right.validAt.localeCompare(left.validAt) ||
          right.acceptedAt.localeCompare(left.acceptedAt),
      )[0] ?? null
  );
}

function intervalsOverlap(
  left: { effectiveFrom: string; effectiveTo?: string },
  right: { effectiveFrom: string; effectiveTo?: string },
): boolean {
  return !(
    (left.effectiveTo != null && left.effectiveTo <= right.effectiveFrom) ||
    (right.effectiveTo != null && right.effectiveTo <= left.effectiveFrom)
  );
}

function validateTemporalBounds(record: {
  recordId: string;
  effectiveFrom: string;
  effectiveTo?: string;
}): void {
  if (
    record.effectiveTo != null &&
    record.effectiveTo <= record.effectiveFrom
  ) {
    throw new Error(
      `Record "${record.recordId}" must end after its effective start`,
    );
  }
}

function validateCorrections<T extends CorrectableRecord>(
  records: readonly T[],
  label: string,
  seriesKey: (record: T) => string,
): void {
  const byId = new Map<string, T>();
  const correctedIds = new Set<string>();
  for (const record of records) {
    if (byId.has(record.recordId)) {
      throw new Error(`Duplicate ${label} record ID "${record.recordId}"`);
    }
    byId.set(record.recordId, record);
  }
  for (const record of records) {
    if (record.correctsId == null) continue;
    if (correctedIds.has(record.correctsId)) {
      throw new Error(
        `${label} record "${record.correctsId}" has more than one correction`,
      );
    }
    const corrected = byId.get(record.correctsId);
    if (corrected == null) {
      throw new Error(
        `${label} record "${record.recordId}" corrects unknown record "${record.correctsId}"`,
      );
    }
    if (seriesKey(record) !== seriesKey(corrected)) {
      throw new Error(
        `${label} correction "${record.recordId}" must correct the same series`,
      );
    }
    if (record.acceptedAt <= corrected.acceptedAt) {
      throw new Error(
        `${label} correction "${record.recordId}" must be accepted after "${record.correctsId}"`,
      );
    }
    correctedIds.add(record.correctsId);
  }
}

function assertNonOverlapping<
  T extends CorrectableRecord & {
    effectiveFrom: string;
    effectiveTo?: string;
  },
>(
  records: readonly T[],
  label: string,
  seriesKey: (record: T) => string,
): void {
  const current = effectiveFinancialRecords(records);
  for (let leftIndex = 0; leftIndex < current.length; leftIndex += 1) {
    const left = current[leftIndex];
    if (left == null) continue;
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < current.length;
      rightIndex += 1
    ) {
      const right = current[rightIndex];
      if (
        right != null &&
        seriesKey(left) === seriesKey(right) &&
        intervalsOverlap(left, right)
      ) {
        throw new Error(
          `${label} records "${left.recordId}" and "${right.recordId}" overlap`,
        );
      }
    }
  }
}

function entityAt(
  records: readonly FinancialEntityRecord[],
  entityId: string,
  validAt: string,
  asKnownAt?: string,
): FinancialEntityRecord | null {
  return (
    effectiveFinancialRecords(records, asKnownAt)
      .filter(
        (record) =>
          record.entityId === entityId && containsDate(record, validAt),
      )
      .toSorted((left, right) =>
        right.effectiveFrom.localeCompare(left.effectiveFrom),
      )[0] ?? null
  );
}

function assertEntity(
  records: readonly FinancialEntityRecord[],
  entityId: string,
  validAt: string,
  referrer: string,
): FinancialEntityRecord {
  const entity = entityAt(records, entityId, validAt);
  if (entity == null) {
    throw new Error(`${referrer} references missing entity "${entityId}"`);
  }
  return entity;
}

function validateShareTotals(records: readonly ShareOwnershipInterest[]): void {
  const current = effectiveFinancialRecords(records);
  const companies = new Set(
    current.map(({ companyEntityId }) => companyEntityId),
  );
  for (const companyEntityId of companies) {
    const companyRecords = current.filter(
      (record) => record.companyEntityId === companyEntityId,
    );
    const boundaries = new Set(
      companyRecords.flatMap((record) => [
        record.effectiveFrom,
        ...(record.effectiveTo == null ? [] : [record.effectiveTo]),
      ]),
    );
    for (const date of boundaries) {
      const total = companyRecords
        .filter(
          (record) =>
            containsDate(record, date) && record.fraction.state === "known",
        )
        .reduce(
          (sum, record) =>
            sum +
            (record.fraction.state === "known" ? record.fraction.fraction : 0),
          0,
        );
      if (total > 1 + 1e-6) {
        throw new Error(
          `Known share ownership for company "${companyEntityId}" exceeds 100% on ${date}`,
        );
      }
    }
  }
}

type BusinessWealthValidationData = BusinessWealthCollections & {
  accounts: readonly Account[];
};

function validateBusinessTemporalRecords(data: BusinessWealthValidationData) {
  for (const record of [
    ...data.financialEntities,
    ...data.accountOwnerships,
    ...data.shareOwnershipInterests,
    ...data.entityObligations,
    ...data.entityTransfers,
  ]) {
    validateTemporalBounds(record);
  }
}

function validateBusinessCorrectionChains(data: BusinessWealthValidationData) {
  validateCorrections(
    data.financialEntities,
    "Financial entity",
    (record) => record.entityId,
  );
  validateCorrections(
    data.accountOwnerships,
    "Account ownership",
    (record) => record.accountId,
  );
  validateCorrections(
    data.shareOwnershipInterests,
    "Share ownership",
    (record) =>
      `${record.interestId}\0${record.ownerEntityId}\0${record.companyEntityId}`,
  );
  validateCorrections(
    data.entityObligations,
    "Entity obligation",
    (record) => record.obligationId,
  );
  validateCorrections(
    data.entityTransfers,
    "Entity transfer",
    (record) => record.transferId,
  );
  validateCorrections(
    data.companyEquityValuations,
    "Company valuation",
    (record) => record.companyEntityId,
  );
  assertNonOverlapping(
    data.financialEntities,
    "Financial entity",
    (record) => record.entityId,
  );
  assertNonOverlapping(
    data.accountOwnerships,
    "Account ownership",
    (record) => record.accountId,
  );
  assertNonOverlapping(
    data.shareOwnershipInterests,
    "Share ownership",
    (record) =>
      `${record.interestId}\0${record.ownerEntityId}\0${record.companyEntityId}`,
  );
  assertNonOverlapping(
    data.entityObligations,
    "Entity obligation",
    (record) => record.obligationId,
  );
}

function accountOwnershipEntityIds(
  ownership: AccountOwnershipRecord,
): string[] {
  if (ownership.ownership.state !== "known") {
    const candidateEntityIds = ownership.ownership.candidateEntityIds;
    if (
      ownership.ownership.state === "candidate-owners" &&
      (candidateEntityIds.length === 0 ||
        new Set(candidateEntityIds).size !== candidateEntityIds.length)
    ) {
      throw new Error(
        `Candidate account ownership "${ownership.recordId}" must name at least one unique entity`,
      );
    }
    return candidateEntityIds;
  }
  const entityIds = ownership.ownership.allocations.map(
    ({ entityId }) => entityId,
  );
  const total = ownership.ownership.allocations.reduce(
    (sum, allocation) => sum + allocation.fraction,
    0,
  );
  if (
    new Set(entityIds).size !== entityIds.length ||
    Math.abs(total - 1) > 1e-6
  ) {
    throw new Error(
      `Known account ownership "${ownership.recordId}" must name each entity once and total 100%`,
    );
  }
  return entityIds;
}

function validateAccountOwnershipRecord(
  data: BusinessWealthValidationData,
  accountIds: ReadonlySet<string>,
  ownership: AccountOwnershipRecord,
) {
  if (!accountIds.has(ownership.accountId)) {
    throw new Error(
      `Account ownership "${ownership.recordId}" references unknown account "${ownership.accountId}"`,
    );
  }
  const entities = accountOwnershipEntityIds(ownership).map((entityId) =>
    assertEntity(
      data.financialEntities,
      entityId,
      ownership.effectiveFrom,
      `Account ownership "${ownership.recordId}"`,
    ),
  );
  if (
    ownership.ownership.state === "known" &&
    entities.some(({ kind }) => kind === "company") &&
    (entities.length !== 1 ||
      ownership.ownership.allocations[0]?.fraction !== 1)
  ) {
    throw new Error(
      `Company account "${ownership.accountId}" must have one company owner at 100%`,
    );
  }
}

function validateAccountOwnerships(
  data: BusinessWealthValidationData,
  accountIds: ReadonlySet<string>,
) {
  const currentOwnerships = effectiveFinancialRecords(data.accountOwnerships);
  for (const ownership of currentOwnerships) {
    validateAccountOwnershipRecord(data, accountIds, ownership);
  }
  for (const account of data.accounts) {
    if (!currentOwnerships.some(({ accountId }) => accountId === account.id)) {
      throw new Error(`Account "${account.id}" has no dated ownership record`);
    }
  }
}

function validateShareOwnerships(data: BusinessWealthValidationData) {
  for (const interest of effectiveFinancialRecords(
    data.shareOwnershipInterests,
  )) {
    const owner = assertEntity(
      data.financialEntities,
      interest.ownerEntityId,
      interest.effectiveFrom,
      `Share ownership "${interest.recordId}"`,
    );
    const company = assertEntity(
      data.financialEntities,
      interest.companyEntityId,
      interest.effectiveFrom,
      `Share ownership "${interest.recordId}"`,
    );
    if (company.kind !== "company") {
      throw new Error(
        `Share ownership "${interest.recordId}" must target a company`,
      );
    }
    if (owner.entityId === company.entityId) {
      throw new Error(
        `Share ownership "${interest.recordId}" cannot make a company own itself`,
      );
    }
  }
  validateShareTotals(data.shareOwnershipInterests);
}

function validateEntityObligations(data: BusinessWealthValidationData) {
  const liabilityAccountIds = new Set<string>();
  for (const account of data.accounts) {
    if (account.liabilityId == null) continue;
    if (liabilityAccountIds.has(account.liabilityId)) {
      throw new Error(
        `Duplicate liability account ID "${account.liabilityId}"`,
      );
    }
    liabilityAccountIds.add(account.liabilityId);
  }
  for (const obligation of effectiveFinancialRecords(data.entityObligations)) {
    assertEntity(
      data.financialEntities,
      obligation.entityId,
      obligation.effectiveFrom,
      `Entity obligation "${obligation.recordId}"`,
    );
    if (obligation.periodEnd < obligation.periodStart) {
      throw new Error(
        `Entity obligation "${obligation.recordId}" has an invalid period`,
      );
    }
    if (liabilityAccountIds.has(obligation.obligationId)) {
      throw new Error(
        `Liability "${obligation.obligationId}" cannot be both an account and an obligation`,
      );
    }
  }
}

function validateCompanyAccountInput(
  data: BusinessWealthValidationData,
  accountIds: ReadonlySet<string>,
  valuation: CompanyEquityValuation,
  company: FinancialEntityRecord,
  accountId: string,
) {
  if (!accountIds.has(accountId)) {
    throw new Error(
      `Company valuation "${valuation.recordId}" references unknown account "${accountId}"`,
    );
  }
  const ownership = accountOwnershipAt(
    data.accountOwnerships,
    accountId,
    valuation.validAt,
    valuation.acceptedAt,
  );
  if (
    ownership?.ownership.state !== "known" ||
    ownership.ownership.allocations.length !== 1 ||
    ownership.ownership.allocations[0]?.entityId !== company.entityId ||
    ownership.ownership.allocations[0]?.fraction !== 1
  ) {
    throw new Error(
      `Company valuation "${valuation.recordId}" can only cite accounts owned by company "${company.entityId}"`,
    );
  }
}

function validateCompanyValuations(
  data: BusinessWealthValidationData,
  accountIds: ReadonlySet<string>,
) {
  for (const valuation of effectiveFinancialRecords(
    data.companyEquityValuations,
  )) {
    const company = assertEntity(
      data.financialEntities,
      valuation.companyEntityId,
      valuation.validAt,
      `Company valuation "${valuation.recordId}"`,
    );
    if (company.kind !== "company") {
      throw new Error(
        `Company valuation "${valuation.recordId}" must target a company`,
      );
    }
    for (const accountId of valuation.inputs?.accountIds ?? []) {
      validateCompanyAccountInput(
        data,
        accountIds,
        valuation,
        company,
        accountId,
      );
    }
  }
}

function validateTransferAccount(
  data: BusinessWealthValidationData,
  accountIds: ReadonlySet<string>,
  transfer: EntityTransfer,
  leg: EntityTransferLeg,
) {
  if (leg.accountId == null) return;
  if (!accountIds.has(leg.accountId)) {
    throw new Error(
      `Transfer leg "${leg.id}" references unknown account "${leg.accountId}"`,
    );
  }
  if (leg.endpoint.kind !== "entity") {
    throw new Error(
      `Transfer leg "${leg.id}" cannot attach an internal account to an external endpoint`,
    );
  }
  const endpointEntityId = leg.endpoint.entityId;
  const ownership = accountOwnershipAt(
    data.accountOwnerships,
    leg.accountId,
    transfer.effectiveFrom,
    transfer.acceptedAt,
  );
  if (
    ownership?.ownership.state !== "known" ||
    !ownership.ownership.allocations.some(
      ({ entityId }) => entityId === endpointEntityId,
    )
  ) {
    throw new Error(
      `Transfer leg "${leg.id}" account is not owned by endpoint entity "${endpointEntityId}"`,
    );
  }
}

function validateEntityTransfers(
  data: BusinessWealthValidationData,
  accountIds: ReadonlySet<string>,
) {
  for (const transfer of effectiveFinancialRecords(data.entityTransfers)) {
    for (const leg of transfer.legs) {
      if (leg.endpoint.kind === "entity") {
        assertEntity(
          data.financialEntities,
          leg.endpoint.entityId,
          transfer.effectiveFrom,
          `Transfer leg "${leg.id}"`,
        );
      }
      validateTransferAccount(data, accountIds, transfer, leg);
    }
  }
}

export function validateBusinessWealth(
  data: BusinessWealthValidationData,
): void {
  const accountIds = new Set(data.accounts.map(({ id }) => id));
  validateBusinessTemporalRecords(data);
  validateBusinessCorrectionChains(data);
  validateAccountOwnerships(data, accountIds);
  validateShareOwnerships(data);
  validateEntityObligations(data);
  validateCompanyValuations(data, accountIds);
  validateEntityTransfers(data, accountIds);
}

export type HouseholdConsolidationIssue = {
  kind:
    | "missing_account_ownership"
    | "candidate_account_owners"
    | "unsupported_account_ownership"
    | "missing_account_value"
    | "account_value_not_recorded"
    | "unsupported_account_value"
    | "missing_company_valuation"
    | "company_valuation_not_recorded"
    | "unsupported_company_valuation"
    | "share_fraction_not_recorded"
    | "unsupported_share_ownership"
    | "unsupported_currency";
  subjectId: string;
  reason?: string;
};

export type HouseholdWealthContribution = {
  id: string;
  kind: "account" | "business-interest";
  subjectId: string;
  amount: number;
  currency: string;
  attribution: Array<{
    personEntityId: string;
    fraction: number;
    amount: number;
  }>;
  inputRecordIds: string[];
};

export type HouseholdWealthConsolidation = {
  calculationVersion: typeof BUSINESS_WEALTH_CALCULATION_VERSION;
  validAt: string;
  asKnownAt: string;
  baseCurrency: string;
  knownSubtotal: number;
  complete: boolean;
  contributions: HouseholdWealthContribution[];
  includedContributionIds: string[];
  excludedUnderlyingIds: string[];
  valuationRecordIds: string[];
  ownershipRecordIds: string[];
  exchangeRateObservationIds: string[];
  issues: HouseholdConsolidationIssue[];
};

type HouseholdConsolidationInput = {
  selectedPersonEntityIds: readonly string[];
  validAt: string;
  asKnownAt: string;
  baseCurrency: string;
  accounts: readonly Account[];
  accountValues: readonly HouseholdAccountValue[];
  financialEntities: readonly FinancialEntityRecord[];
  accountOwnerships: readonly AccountOwnershipRecord[];
  shareOwnershipInterests: readonly ShareOwnershipInterest[];
  companyEquityValuations: readonly CompanyEquityValuation[];
};

type ConsolidationAccumulator = {
  selectedPeople: ReadonlySet<string>;
  contributions: HouseholdWealthContribution[];
  issues: HouseholdConsolidationIssue[];
  excludedUnderlyingIds: Set<string>;
  valuationRecordIds: Set<string>;
  ownershipRecordIds: Set<string>;
};

function unresolvedMonetaryIssue(
  amount: Exclude<SignedMonetaryState, { state: "known" }>,
  subjectId: string,
  notRecordedKind:
    | "account_value_not_recorded"
    | "company_valuation_not_recorded",
  unsupportedKind:
    | "unsupported_account_value"
    | "unsupported_company_valuation",
): HouseholdConsolidationIssue {
  return {
    kind:
      amount.state === "amount-not-recorded"
        ? notRecordedKind
        : unsupportedKind,
    subjectId,
    ...(amount.state === "unsupported" ? { reason: amount.reason } : {}),
  };
}

function addUnresolvedAccountContribution(
  input: HouseholdConsolidationInput,
  account: Account,
  ownershipRecord: AccountOwnershipRecord,
  ownership: Exclude<AccountOwnershipState, { state: "known" }>,
  result: ConsolidationAccumulator,
) {
  const candidates = ownership.candidateEntityIds;
  const allCandidatesSelected =
    candidates.length > 0 &&
    candidates.every((entityId) => result.selectedPeople.has(entityId));
  const value = latestAccountValueAt(
    input.accountValues,
    account.id,
    input.validAt,
    input.asKnownAt,
  );
  if (
    allCandidatesSelected &&
    value?.amount.state === "known" &&
    value.amount.currency === input.baseCurrency
  ) {
    result.contributions.push({
      id: `account:${account.id}`,
      kind: "account",
      subjectId: account.id,
      amount: value.amount.amount,
      currency: value.amount.currency,
      attribution: [],
      inputRecordIds: [ownershipRecord.recordId, value.recordId],
    });
  }
  result.issues.push({
    kind:
      ownership.state === "candidate-owners"
        ? "candidate_account_owners"
        : "unsupported_account_ownership",
    subjectId: account.id,
    ...(ownership.state === "unsupported" ? { reason: ownership.reason } : {}),
  });
}

function addKnownAccountContribution(
  input: HouseholdConsolidationInput,
  account: Account,
  ownershipRecord: AccountOwnershipRecord,
  ownership: Extract<AccountOwnershipState, { state: "known" }>,
  result: ConsolidationAccumulator,
) {
  const allocations = ownership.allocations.filter(({ entityId }) =>
    result.selectedPeople.has(entityId),
  );
  if (allocations.length === 0) return;
  const value = latestAccountValueAt(
    input.accountValues,
    account.id,
    input.validAt,
    input.asKnownAt,
  );
  if (value == null) {
    result.issues.push({
      kind: "missing_account_value",
      subjectId: account.id,
    });
    return;
  }
  if (value.amount.state !== "known") {
    result.issues.push(
      unresolvedMonetaryIssue(
        value.amount,
        account.id,
        "account_value_not_recorded",
        "unsupported_account_value",
      ),
    );
    return;
  }
  if (value.amount.currency !== input.baseCurrency) {
    result.issues.push({
      kind: "unsupported_currency",
      subjectId: account.id,
    });
    return;
  }
  const accountAmount = value.amount.amount;
  const selectedFraction = allocations.reduce(
    (sum, allocation) => sum + allocation.fraction,
    0,
  );
  result.contributions.push({
    id: `account:${account.id}`,
    kind: "account",
    subjectId: account.id,
    amount: accountAmount * selectedFraction,
    currency: value.amount.currency,
    attribution: allocations.map((allocation) => ({
      personEntityId: allocation.entityId,
      fraction: allocation.fraction,
      amount: accountAmount * allocation.fraction,
    })),
    inputRecordIds: [ownershipRecord.recordId, value.recordId],
  });
}

function addAccountContribution(
  input: HouseholdConsolidationInput,
  account: Account,
  result: ConsolidationAccumulator,
) {
  const ownership = accountOwnershipAt(
    input.accountOwnerships,
    account.id,
    input.validAt,
    input.asKnownAt,
  );
  if (ownership == null) {
    result.issues.push({
      kind: "missing_account_ownership",
      subjectId: account.id,
    });
    return;
  }
  result.ownershipRecordIds.add(ownership.recordId);
  if (ownership.ownership.state === "known") {
    addKnownAccountContribution(
      input,
      account,
      ownership,
      ownership.ownership,
      result,
    );
    return;
  }
  addUnresolvedAccountContribution(
    input,
    account,
    ownership,
    ownership.ownership,
    result,
  );
}

function selectedCompanyIds(
  input: HouseholdConsolidationInput,
  selectedPeople: ReadonlySet<string>,
): Set<string> {
  return new Set(
    effectiveFinancialRecords(input.shareOwnershipInterests, input.asKnownAt)
      .filter(
        (interest) =>
          selectedPeople.has(interest.ownerEntityId) &&
          containsDate(interest, input.validAt),
      )
      .map(({ companyEntityId }) => companyEntityId),
  );
}

function addUnresolvedInterestIssue(
  interest: ShareOwnershipInterest & {
    fraction: Exclude<FractionState, { state: "known" }>;
  },
  result: ConsolidationAccumulator,
) {
  result.issues.push({
    kind:
      interest.fraction.state === "fraction-not-recorded"
        ? "share_fraction_not_recorded"
        : "unsupported_share_ownership",
    subjectId: interest.companyEntityId,
    ...(interest.fraction.state === "unsupported"
      ? { reason: interest.fraction.reason }
      : {}),
  });
}

function addBusinessContribution(
  input: HouseholdConsolidationInput,
  companyEntityId: string,
  result: ConsolidationAccumulator,
) {
  const interests = shareOwnershipAt(
    input.shareOwnershipInterests,
    companyEntityId,
    input.validAt,
    input.asKnownAt,
  ).filter(({ ownerEntityId }) => result.selectedPeople.has(ownerEntityId));
  for (const interest of interests) {
    result.ownershipRecordIds.add(interest.recordId);
  }
  const unresolved = interests.find(
    (
      interest,
    ): interest is ShareOwnershipInterest & {
      fraction: Exclude<FractionState, { state: "known" }>;
    } => interest.fraction.state !== "known",
  );
  if (unresolved != null) {
    addUnresolvedInterestIssue(unresolved, result);
    return;
  }
  const valuation = latestValuationAt(
    input.companyEquityValuations,
    companyEntityId,
    input.validAt,
    input.asKnownAt,
  );
  if (valuation == null) {
    result.issues.push({
      kind: "missing_company_valuation",
      subjectId: companyEntityId,
    });
    return;
  }
  result.valuationRecordIds.add(valuation.recordId);
  for (const accountId of valuation.inputs?.accountIds ?? []) {
    result.excludedUnderlyingIds.add(accountId);
  }
  if (valuation.amount.state !== "known") {
    result.issues.push(
      unresolvedMonetaryIssue(
        valuation.amount,
        companyEntityId,
        "company_valuation_not_recorded",
        "unsupported_company_valuation",
      ),
    );
    return;
  }
  if (valuation.amount.currency !== input.baseCurrency) {
    result.issues.push({
      kind: "unsupported_currency",
      subjectId: companyEntityId,
    });
    return;
  }
  const knownInterests = interests.filter(
    (
      interest,
    ): interest is ShareOwnershipInterest & {
      fraction: Extract<FractionState, { state: "known" }>;
    } => interest.fraction.state === "known",
  );
  const companyAmount = valuation.amount.amount;
  const attribution = knownInterests.map((interest) => ({
    personEntityId: interest.ownerEntityId,
    fraction: interest.fraction.fraction,
    amount: companyAmount * interest.fraction.fraction,
  }));
  result.contributions.push({
    id: `business-interest:${companyEntityId}`,
    kind: "business-interest",
    subjectId: companyEntityId,
    amount: attribution.reduce((sum, item) => sum + item.amount, 0),
    currency: valuation.amount.currency,
    attribution,
    inputRecordIds: [
      valuation.recordId,
      ...knownInterests.map(({ recordId }) => recordId),
    ],
  });
}

export function consolidateHouseholdWealth(
  input: HouseholdConsolidationInput,
): HouseholdWealthConsolidation {
  const selectedPeople = new Set(input.selectedPersonEntityIds);
  const result: ConsolidationAccumulator = {
    selectedPeople,
    contributions: [],
    issues: [],
    excludedUnderlyingIds: new Set(),
    valuationRecordIds: new Set(),
    ownershipRecordIds: new Set(),
  };

  for (const account of input.accounts) {
    addAccountContribution(input, account, result);
  }

  for (const companyId of selectedCompanyIds(input, selectedPeople)) {
    addBusinessContribution(input, companyId, result);
  }

  const filteredContributions = result.contributions.filter(
    (contribution) =>
      contribution.kind !== "account" ||
      !result.excludedUnderlyingIds.has(contribution.subjectId),
  );
  return {
    calculationVersion: BUSINESS_WEALTH_CALCULATION_VERSION,
    validAt: input.validAt,
    asKnownAt: input.asKnownAt,
    baseCurrency: input.baseCurrency,
    knownSubtotal: filteredContributions.reduce(
      (sum, contribution) => sum + contribution.amount,
      0,
    ),
    complete: result.issues.length === 0,
    contributions: filteredContributions,
    includedContributionIds: filteredContributions.map(({ id }) => id),
    excludedUnderlyingIds: [...result.excludedUnderlyingIds].sort(
      (left, right) => left.localeCompare(right),
    ),
    valuationRecordIds: [...result.valuationRecordIds].sort((left, right) =>
      left.localeCompare(right),
    ),
    ownershipRecordIds: [...result.ownershipRecordIds].sort((left, right) =>
      left.localeCompare(right),
    ),
    exchangeRateObservationIds: [],
    issues: result.issues,
  };
}
