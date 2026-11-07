import {
  type BusinessAssetDisposalReliefEligibility,
  calculateCapitalRealisationTax,
  calculateDividendRealisationTax,
  resolveBusinessRealisationTaxRules,
} from "finance-tax-rules/business-realisation";
import { z } from "zod";
import {
  type CompanyEquityValuation,
  type EntityTransfer,
  effectiveFinancialRecords,
  FinancialRecordLineageSchema,
  type ShareOwnershipInterest,
  SignedMonetaryRangeSchema,
  shareOwnershipAt,
} from "./businessWealth";
import { CurrencySchema } from "./currency";

export const BUSINESS_REALISATION_CALCULATION_VERSION =
  "business-realisation-v1" as const;

const RecordIdSchema = z.string().trim().min(1);
const EntityIdSchema = z.string().trim().min(1);

export const BusinessRealisationAmountSchema = z
  .object({
    currency: CurrencySchema,
    amount: z.number().nonnegative(),
    range: SignedMonetaryRangeSchema.optional(),
  })
  .superRefine(({ amount, currency, range }, context) => {
    if (range == null) return;
    if (range.currency !== currency) {
      context.addIssue({
        code: "custom",
        message: "A realisation amount and range must use the same currency",
        path: ["range", "currency"],
      });
    }
    if (amount < range.lowerBound || amount > range.upperBound) {
      context.addIssue({
        code: "custom",
        message: "A realisation amount must fall within its range",
        path: ["amount"],
      });
    }
  });
export type BusinessRealisationAmount = z.infer<
  typeof BusinessRealisationAmountSchema
>;

export const BusinessRealisationProceedsSchema = z.object({
  recordId: RecordIdSchema,
  receivedAt: z.iso.date(),
  evidenceKind: z.enum(["assumption", "contract", "observed"]),
  amount: BusinessRealisationAmountSchema,
  lineage: FinancialRecordLineageSchema,
});
export type BusinessRealisationProceeds = z.infer<
  typeof BusinessRealisationProceedsSchema
>;

export const BusinessRealisationDeductionSchema = z.object({
  id: RecordIdSchema,
  kind: z.enum(["transaction-cost", "professional-cost"]),
  label: z.string().trim().min(1),
  settledAt: z.iso.date(),
  amount: BusinessRealisationAmountSchema,
  inputRecordIds: z.array(RecordIdSchema).min(1),
});
export type BusinessRealisationDeduction = z.infer<
  typeof BusinessRealisationDeductionSchema
>;

export const BusinessRealisationSettlementSchema = z.object({
  id: RecordIdSchema,
  subjectId: RecordIdSchema,
  kind: z.enum(["liability", "obligation", "company-tax"]),
  settledAt: z.iso.date(),
  amount: BusinessRealisationAmountSchema,
  inputRecordIds: z.array(RecordIdSchema).min(1),
});
export type BusinessRealisationSettlement = z.infer<
  typeof BusinessRealisationSettlementSchema
>;

export const BusinessAssetDisposalReliefEligibilitySchema =
  z.discriminatedUnion("state", [
    z.object({
      state: z.literal("unknown"),
      reason: z.string().trim().min(1),
    }),
    z.object({
      state: z.literal("not-claimed"),
      reason: z.string().trim().min(1),
    }),
    z.object({
      state: z.literal("assessed"),
      intendsToClaim: z.boolean(),
      nonEmiOrdinaryShares: z.boolean(),
      officerOrEmployeeForTwoYears: z.boolean(),
      tradingCompanyForTwoYears: z.boolean(),
      heldForTwoYears: z.boolean(),
      ordinaryShareCapitalPercent: z.number().min(0).max(100),
      votingRightsPercent: z.number().min(0).max(100),
      economicEntitlement: z.discriminatedUnion("kind", [
        z.object({
          kind: z.literal("profits-and-winding-up-assets"),
          percent: z.number().min(0).max(100),
        }),
        z.object({
          kind: z.literal("company-sale-proceeds"),
          percent: z.number().min(0).max(100),
        }),
      ]),
      priorLifetimeQualifyingGainsPence: z.number().int().nonnegative(),
    }),
  ]);

export const BusinessRealisationOwnerTaxInputSchema = z.object({
  ownerEntityId: EntityIdSchema,
  shareBaseCost: z.number().nonnegative(),
  lossesApplied: z.number().nonnegative(),
  remainingAnnualExemptAmount: z.number().nonnegative(),
  remainingDividendAllowance: z.number().nonnegative(),
  remainingBasicRateBand: z.number().nonnegative(),
  remainingHigherRateBand: z.number().nonnegative(),
  reliefEligibility: BusinessAssetDisposalReliefEligibilitySchema,
  destinationAccountId: RecordIdSchema.optional(),
});
export type BusinessRealisationOwnerTaxInput = z.infer<
  typeof BusinessRealisationOwnerTaxInputSchema
>;

export const BusinessRealisationUnsupportedCaseSchema = z.object({
  code: z.enum([
    "insolvency",
    "earn-out",
    "deferred-consideration",
    "multiple-share-classes",
    "trust-owner",
    "cross-border-owner",
    "anti-avoidance",
    "unverified-company-asset-tax",
    "non-cash-consideration",
    "emi-shares",
    "dilution-election",
  ]),
  detail: z.string().trim().min(1),
});

const CompanyTaxTreatmentSchema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("settled"),
    settlementId: RecordIdSchema,
  }),
  z.object({
    state: z.literal("not-applicable"),
    reason: z.string().trim().min(1),
  }),
  z.object({
    state: z.literal("unsupported"),
    reason: z.string().trim().min(1),
  }),
]);

const ScenarioRecordShape = {
  recordId: RecordIdSchema,
  scenarioId: RecordIdSchema,
  companyEntityId: EntityIdSchema,
  effectiveFrom: z.iso.date(),
  acceptedAt: z.iso.datetime({ offset: true }),
  correctsId: RecordIdSchema.optional(),
  lineage: FinancialRecordLineageSchema,
  valuationRecordId: RecordIdSchema,
  maxValuationAgeDays: z.number().int().nonnegative(),
  ownershipDate: z.iso.date(),
  householdOwnerEntityIds: z.array(EntityIdSchema).min(1),
  proceeds: BusinessRealisationProceedsSchema,
  saleCosts: z.array(BusinessRealisationDeductionSchema).default([]),
  settlements: z.array(BusinessRealisationSettlementSchema).default([]),
  ownerTaxInputs: z.array(BusinessRealisationOwnerTaxInputSchema).min(1),
  relatedTransferRecordIds: z.array(RecordIdSchema).default([]),
  unsupportedCases: z
    .array(BusinessRealisationUnsupportedCaseSchema)
    .default([]),
  availableAt: z.iso.date(),
};

export const BusinessRealisationScenarioSchema = z.discriminatedUnion("route", [
  z.object({
    ...ScenarioRecordShape,
    route: z.literal("share-sale"),
    completedAt: z.iso.date(),
  }),
  z.object({
    ...ScenarioRecordShape,
    route: z.literal("company-asset-sale"),
    assetSaleCompletedAt: z.iso.date(),
    distributionTreatment: z.literal("ordinary-dividend"),
    companyTaxTreatment: CompanyTaxTreatmentSchema,
  }),
  z.object({
    ...ScenarioRecordShape,
    route: z.literal("solvent-wind-down"),
    procedure: z.enum(["members-voluntary-liquidation", "striking-off"]),
    ceasedTradingAt: z.iso.date(),
    solvent: z.boolean(),
    canPayDebtsWithinTwelveMonths: z.boolean(),
    companyTaxTreatment: CompanyTaxTreatmentSchema,
  }),
]);
export type BusinessRealisationScenario = z.infer<
  typeof BusinessRealisationScenarioSchema
>;

export type BusinessRealisationIssue = {
  code:
    | "missing-valuation"
    | "stale-valuation"
    | "unsupported-currency"
    | "missing-share-ownership"
    | "unknown-share-ownership"
    | "missing-owner-tax-input"
    | "duplicate-owner-tax-input"
    | "duplicate-deduction"
    | "duplicate-settlement"
    | "missing-company-tax-settlement"
    | "unsupported-company-tax"
    | "insolvent-company"
    | "striking-off-distribution-limit-exceeded"
    | "unknown-relief-eligibility"
    | "missing-transfer"
    | "unsupported-transfer"
    | "unsupported-case";
  subjectId: string;
  detail: string;
};

export type BusinessRealisationDistribution = {
  ownerEntityId: string;
  ownershipFraction: number;
  grossAmount: number;
  grossRange: { currency: string; lowerBound: number; upperBound: number };
  taxTreatment: "capital-gain" | "dividend";
  personalTax: number | null;
  netAmount: number | null;
  taxableAmount: number | null;
  businessAssetDisposalReliefApplied: boolean | null;
  businessAssetDisposalReliefAmount: number | null;
  availableAt: string;
  destinationAccountId?: string;
  ownershipRecordIds: string[];
  taxRuleIds: string[];
  taxSourceIds: string[];
};

export type BusinessRealisationResult = {
  calculationVersion: typeof BUSINESS_REALISATION_CALCULATION_VERSION;
  scenarioId: string;
  scenarioRecordId: string;
  route: BusinessRealisationScenario["route"];
  companyEntityId: string;
  complete: boolean;
  grossProceeds: BusinessRealisationProceeds;
  valuation: {
    recordId: string;
    validAt: string;
    evidenceAt: string;
    method: CompanyEquityValuation["method"];
    amount: CompanyEquityValuation["amount"];
    range?: NonNullable<CompanyEquityValuation["range"]>;
    ageDays: number;
  } | null;
  saleCosts: BusinessRealisationDeduction[];
  settlements: BusinessRealisationSettlement[];
  netProceedsBeforePersonalTax: number;
  netProceedsRange: {
    currency: string;
    lowerBound: number;
    upperBound: number;
  };
  shortfall: number;
  distributions: BusinessRealisationDistribution[];
  totalPersonalTax: number | null;
  netHouseholdProceeds: number | null;
  unallocatedOwnershipFraction: number;
  issues: BusinessRealisationIssue[];
  unsupportedCases: BusinessRealisationScenario["unsupportedCases"];
  lineage: {
    inputRecordIds: string[];
    valuationRecordIds: string[];
    ownershipRecordIds: string[];
    transferRecordIds: string[];
    taxRuleIds: string[];
    taxSourceIds: string[];
  };
  doubleCounting: {
    replacesContributionId: string;
    destinationAccountIds: string[];
    eliminatedTransferIds: string[];
  };
};

export type CalculateBusinessRealisationInput = {
  scenarioId: string;
  asKnownAt: string;
  scenarios: readonly BusinessRealisationScenario[];
  valuations: readonly CompanyEquityValuation[];
  shareOwnershipInterests: readonly ShareOwnershipInterest[];
  entityTransfers?: readonly EntityTransfer[];
};

type Range = { currency: string; lowerBound: number; upperBound: number };

function amountRange(amount: BusinessRealisationAmount): Range {
  return (
    amount.range ?? {
      currency: amount.currency,
      lowerBound: amount.amount,
      upperBound: amount.amount,
    }
  );
}

function sumAmounts(
  amounts: readonly BusinessRealisationAmount[],
  currency: string,
): { amount: number; range: Range } {
  return amounts.reduce(
    (total, amount) => {
      const range = amountRange(amount);
      return {
        amount: total.amount + amount.amount,
        range: {
          currency,
          lowerBound: total.range.lowerBound + range.lowerBound,
          upperBound: total.range.upperBound + range.upperBound,
        },
      };
    },
    {
      amount: 0,
      range: { currency, lowerBound: 0, upperBound: 0 },
    },
  );
}

function daysBetween(from: string, to: string): number {
  const start = new Date(`${from}T00:00:00Z`).valueOf();
  const end = new Date(`${to}T00:00:00Z`).valueOf();
  return Math.max(0, Math.floor((end - start) / 86_400_000));
}

function selectedScenario(
  input: CalculateBusinessRealisationInput,
): BusinessRealisationScenario | null {
  return (
    effectiveFinancialRecords(
      input.scenarios.filter(
        ({ scenarioId }) => scenarioId === input.scenarioId,
      ),
      input.asKnownAt,
    ).toSorted(
      (left, right) =>
        right.acceptedAt.localeCompare(left.acceptedAt) ||
        right.recordId.localeCompare(left.recordId),
    )[0] ?? null
  );
}

export function validateBusinessRealisationScenarios(
  scenarios: readonly BusinessRealisationScenario[],
): void {
  const byId = new Map<string, BusinessRealisationScenario>();
  const correctedIds = new Set<string>();
  for (const scenario of scenarios) {
    if (byId.has(scenario.recordId)) {
      throw new Error(
        `Duplicate business realisation record ID "${scenario.recordId}"`,
      );
    }
    byId.set(scenario.recordId, scenario);
  }
  for (const scenario of scenarios) {
    if (scenario.correctsId == null) continue;
    const corrected = byId.get(scenario.correctsId);
    if (corrected == null) {
      throw new Error(
        `Business realisation "${scenario.recordId}" corrects unknown record "${scenario.correctsId}"`,
      );
    }
    if (correctedIds.has(corrected.recordId)) {
      throw new Error(
        `Business realisation "${corrected.recordId}" has more than one correction`,
      );
    }
    if (
      scenario.scenarioId !== corrected.scenarioId ||
      scenario.companyEntityId !== corrected.companyEntityId ||
      scenario.route !== corrected.route
    ) {
      throw new Error(
        `Business realisation correction "${scenario.recordId}" must preserve its scenario, company, and route`,
      );
    }
    if (scenario.acceptedAt <= corrected.acceptedAt) {
      throw new Error(
        `Business realisation correction "${scenario.recordId}" must be accepted after "${corrected.recordId}"`,
      );
    }
    correctedIds.add(corrected.recordId);
  }
}

function selectedValuation(
  scenario: BusinessRealisationScenario,
  input: CalculateBusinessRealisationInput,
): CompanyEquityValuation | null {
  return (
    effectiveFinancialRecords(input.valuations, input.asKnownAt).find(
      ({ recordId, companyEntityId }) =>
        recordId === scenario.valuationRecordId &&
        companyEntityId === scenario.companyEntityId,
    ) ?? null
  );
}

function validateUniqueIds(
  ids: readonly string[],
  code: "duplicate-deduction" | "duplicate-settlement",
  issues: BusinessRealisationIssue[],
): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      issues.push({
        code,
        subjectId: id,
        detail: `${id} appears more than once`,
      });
    }
    seen.add(id);
  }
}

type KnownInterest = ShareOwnershipInterest & {
  fraction: { state: "known"; fraction: number };
};

function knownPersonInterests(
  scenario: BusinessRealisationScenario,
  input: CalculateBusinessRealisationInput,
  issues: BusinessRealisationIssue[],
): KnownInterest[] {
  const interests = shareOwnershipAt(
    input.shareOwnershipInterests,
    scenario.companyEntityId,
    scenario.ownershipDate,
    input.asKnownAt,
  ).filter(({ ownerEntityId }) =>
    scenario.householdOwnerEntityIds.includes(ownerEntityId),
  );
  if (interests.length === 0) {
    issues.push({
      code: "missing-share-ownership",
      subjectId: scenario.companyEntityId,
      detail: `No share ownership applies on ${scenario.ownershipDate}`,
    });
    return [];
  }
  const representedOwners = new Set(
    interests.map(({ ownerEntityId }) => ownerEntityId),
  );
  for (const ownerEntityId of scenario.householdOwnerEntityIds) {
    if (representedOwners.has(ownerEntityId)) continue;
    issues.push({
      code: "missing-share-ownership",
      subjectId: ownerEntityId,
      detail: `No share ownership applies for this household owner on ${scenario.ownershipDate}`,
    });
  }
  const known: KnownInterest[] = [];
  for (const interest of interests) {
    if (interest.fraction.state !== "known") {
      issues.push({
        code: "unknown-share-ownership",
        subjectId: interest.recordId,
        detail: "A realised distribution needs a known ownership fraction",
      });
      continue;
    }
    known.push(interest as KnownInterest);
  }
  return known;
}

function companyTaxIssue(
  scenario: Exclude<BusinessRealisationScenario, { route: "share-sale" }>,
  issues: BusinessRealisationIssue[],
): void {
  if (scenario.companyTaxTreatment.state === "unsupported") {
    issues.push({
      code: "unsupported-company-tax",
      subjectId: scenario.scenarioId,
      detail: scenario.companyTaxTreatment.reason,
    });
    return;
  }
  if (scenario.companyTaxTreatment.state === "not-applicable") return;
  const settlementId = scenario.companyTaxTreatment.settlementId;
  if (
    !scenario.settlements.some(
      ({ id, kind }) => id === settlementId && kind === "company-tax",
    )
  ) {
    issues.push({
      code: "missing-company-tax-settlement",
      subjectId: settlementId,
      detail: "The selected company tax settlement is missing",
    });
  }
}

function matchedTransfers(
  scenario: BusinessRealisationScenario,
  ownerIds: ReadonlySet<string>,
  input: CalculateBusinessRealisationInput,
  issues: BusinessRealisationIssue[],
): EntityTransfer[] {
  const transfers = effectiveFinancialRecords(
    input.entityTransfers ?? [],
    input.asKnownAt,
  );
  return scenario.relatedTransferRecordIds.flatMap((recordId) => {
    const transfer = transfers.find(
      (candidate) => candidate.recordId === recordId,
    );
    if (transfer == null) {
      issues.push({
        code: "missing-transfer",
        subjectId: recordId,
        detail: "The referenced inter-entity transfer is missing",
      });
      return [];
    }
    const source = transfer.legs.find(
      ({ role }) => role === "source",
    )?.endpoint;
    const destination = transfer.legs.find(
      ({ role }) => role === "destination",
    )?.endpoint;
    const supported =
      scenario.route === "share-sale"
        ? source?.kind === "external" &&
          destination?.kind === "entity" &&
          ownerIds.has(destination.entityId)
        : source?.kind === "entity" &&
          source.entityId === scenario.companyEntityId &&
          destination?.kind === "entity" &&
          ownerIds.has(destination.entityId);
    const supportedClassification =
      transfer.classification.state === "known" &&
      (scenario.route === "company-asset-sale"
        ? transfer.classification.kind === "dividend"
        : transfer.classification.kind === "other");
    if (!supported || !supportedClassification) {
      issues.push({
        code: "unsupported-transfer",
        subjectId: recordId,
        detail:
          "The transfer endpoints or classification do not match this realisation route",
      });
    }
    return [transfer];
  });
}

const poundsToPence = (amount: number): number => Math.round(amount * 100);
const penceToPounds = (amount: number): number => amount / 100;

function capitalTax(
  scenario: BusinessRealisationScenario,
  ownerInput: BusinessRealisationOwnerTaxInput,
  grossAmount: number,
) {
  return calculateCapitalRealisationTax({
    date:
      scenario.route === "share-sale"
        ? scenario.completedAt
        : scenario.availableAt,
    proceedsPence: poundsToPence(grossAmount),
    allowableCostPence: poundsToPence(ownerInput.shareBaseCost),
    lossesAppliedPence: poundsToPence(ownerInput.lossesApplied),
    remainingAnnualExemptAmountPence: poundsToPence(
      ownerInput.remainingAnnualExemptAmount,
    ),
    remainingBasicRateBandPence: poundsToPence(
      ownerInput.remainingBasicRateBand,
    ),
    reliefEligibility:
      ownerInput.reliefEligibility as BusinessAssetDisposalReliefEligibility,
  });
}

function dividendTax(
  scenario: BusinessRealisationScenario,
  ownerInput: BusinessRealisationOwnerTaxInput,
  grossAmount: number,
) {
  return calculateDividendRealisationTax({
    date: scenario.availableAt,
    distributionPence: poundsToPence(grossAmount),
    remainingDividendAllowancePence: poundsToPence(
      ownerInput.remainingDividendAllowance,
    ),
    remainingBasicRateBandPence: poundsToPence(
      ownerInput.remainingBasicRateBand,
    ),
    remainingHigherRateBandPence: poundsToPence(
      ownerInput.remainingHigherRateBand,
    ),
  });
}

type DistributionCalculationInput = {
  scenario: BusinessRealisationScenario;
  interests: readonly KnownInterest[];
  distributableAmount: number;
  distributableRange: Range;
  capitalTreatment: boolean;
  taxSupported: boolean;
  issues: BusinessRealisationIssue[];
};

function distributionWithoutTax(input: {
  calculation: DistributionCalculationInput;
  ownerEntityId: string;
  interests: readonly KnownInterest[];
  ownerInput?: BusinessRealisationOwnerTaxInput;
}): BusinessRealisationDistribution {
  const fraction = input.interests.reduce(
    (total, interest) => total + interest.fraction.fraction,
    0,
  );
  const grossAmount = input.calculation.distributableAmount * fraction;
  return {
    ownerEntityId: input.ownerEntityId,
    ownershipFraction: fraction,
    grossAmount,
    grossRange: {
      currency: input.calculation.distributableRange.currency,
      lowerBound: input.calculation.distributableRange.lowerBound * fraction,
      upperBound: input.calculation.distributableRange.upperBound * fraction,
    },
    taxTreatment: input.calculation.capitalTreatment
      ? "capital-gain"
      : "dividend",
    personalTax: null,
    netAmount: null,
    taxableAmount: null,
    businessAssetDisposalReliefApplied: null,
    businessAssetDisposalReliefAmount: null,
    availableAt: input.calculation.scenario.availableAt,
    ...(input.ownerInput?.destinationAccountId == null
      ? {}
      : { destinationAccountId: input.ownerInput.destinationAccountId }),
    ownershipRecordIds: input.interests.map(({ recordId }) => recordId),
    taxRuleIds: [],
    taxSourceIds: [],
  };
}

function calculateOwnerDistribution(input: {
  calculation: DistributionCalculationInput;
  ownerEntityId: string;
  interests: readonly KnownInterest[];
  ownerInput?: BusinessRealisationOwnerTaxInput;
}): BusinessRealisationDistribution {
  const base = distributionWithoutTax(input);
  if (input.ownerInput == null) {
    input.calculation.issues.push({
      code: "missing-owner-tax-input",
      subjectId: input.ownerEntityId,
      detail: "A realised distribution needs the owner's tax position",
    });
    return base;
  }
  if (!input.calculation.taxSupported) return base;
  const tax = input.calculation.capitalTreatment
    ? capitalTax(input.calculation.scenario, input.ownerInput, base.grossAmount)
    : dividendTax(
        input.calculation.scenario,
        input.ownerInput,
        base.grossAmount,
      );
  if (!tax.available) {
    input.calculation.issues.push({
      code: "unknown-relief-eligibility",
      subjectId: input.ownerEntityId,
      detail:
        tax.unsupported[0]?.detail ??
        "The owner's tax treatment is unsupported",
    });
  }
  const personalTax = tax.taxPence == null ? null : penceToPounds(tax.taxPence);
  const taxableAmount =
    "taxableGainPence" in tax
      ? penceToPounds(tax.taxableGainPence)
      : penceToPounds(tax.taxableDividendPence);
  const reliefApplied = "reliefApplied" in tax ? tax.reliefApplied : false;
  const reliefAmount =
    "businessAssetDisposalReliefGainPence" in tax
      ? penceToPounds(tax.businessAssetDisposalReliefGainPence)
      : 0;
  return {
    ...base,
    personalTax,
    netAmount: personalTax == null ? null : base.grossAmount - personalTax,
    taxableAmount,
    businessAssetDisposalReliefApplied: reliefApplied,
    businessAssetDisposalReliefAmount: reliefAmount,
    taxRuleIds: tax.lineage.ruleIds,
    taxSourceIds: tax.lineage.sourceIds,
  };
}

function calculateDistributions(
  input: DistributionCalculationInput,
): BusinessRealisationDistribution[] {
  const ownerInputs = new Map<string, BusinessRealisationOwnerTaxInput>();
  for (const ownerInput of input.scenario.ownerTaxInputs) {
    if (ownerInputs.has(ownerInput.ownerEntityId)) {
      input.issues.push({
        code: "duplicate-owner-tax-input",
        subjectId: ownerInput.ownerEntityId,
        detail: "Each owner needs one tax input",
      });
    }
    ownerInputs.set(ownerInput.ownerEntityId, ownerInput);
  }
  const byOwner = new Map<string, KnownInterest[]>();
  for (const interest of input.interests) {
    byOwner.set(interest.ownerEntityId, [
      ...(byOwner.get(interest.ownerEntityId) ?? []),
      interest,
    ]);
  }
  return [...byOwner.entries()].map(([ownerEntityId, interests]) =>
    calculateOwnerDistribution({
      calculation: input,
      ownerEntityId,
      interests,
      ownerInput: ownerInputs.get(ownerEntityId),
    }),
  );
}

function collectScenarioIssues(input: {
  scenario: BusinessRealisationScenario;
  valuation: CompanyEquityValuation | null;
  valuationAgeDays: number | null;
}): BusinessRealisationIssue[] {
  const issues: BusinessRealisationIssue[] =
    input.scenario.unsupportedCases.map(({ code, detail }) => ({
      code: "unsupported-case",
      subjectId: code,
      detail,
    }));
  validateUniqueIds(
    input.scenario.saleCosts.map(({ id }) => id),
    "duplicate-deduction",
    issues,
  );
  validateUniqueIds(
    input.scenario.settlements.map(({ id }) => id),
    "duplicate-settlement",
    issues,
  );
  if (input.valuation == null) {
    issues.push({
      code: "missing-valuation",
      subjectId: input.scenario.valuationRecordId,
      detail: "The scenario must cite a dated company valuation",
    });
  } else if (
    input.valuationAgeDays != null &&
    input.valuationAgeDays > input.scenario.maxValuationAgeDays
  ) {
    issues.push({
      code: "stale-valuation",
      subjectId: input.valuation.recordId,
      detail: `The cited valuation is ${input.valuationAgeDays} days old`,
    });
  }
  const amounts = [
    input.scenario.proceeds.amount,
    ...input.scenario.saleCosts.map(({ amount }) => amount),
    ...input.scenario.settlements.map(({ amount }) => amount),
  ];
  if (amounts.some(({ currency }) => currency !== "GBP")) {
    issues.push({
      code: "unsupported-currency",
      subjectId: input.scenario.scenarioId,
      detail: "This release supports GBP proceeds and deductions only",
    });
  }
  if (input.scenario.route !== "share-sale") {
    companyTaxIssue(input.scenario, issues);
  }
  if (
    input.scenario.route === "share-sale" &&
    input.scenario.settlements.length > 0
  ) {
    issues.push({
      code: "unsupported-case",
      subjectId: input.scenario.scenarioId,
      detail:
        "A share sale leaves company liabilities with the company; do not deduct them again from shareholder proceeds",
    });
  }
  if (
    input.scenario.route === "solvent-wind-down" &&
    (!input.scenario.solvent || !input.scenario.canPayDebtsWithinTwelveMonths)
  ) {
    issues.push({
      code: "insolvent-company",
      subjectId: input.scenario.companyEntityId,
      detail:
        "A supported solvent wind-down must pay all debts within 12 months",
    });
  }
  return issues;
}

function netProceeds(scenario: BusinessRealisationScenario) {
  const saleCost = sumAmounts(
    scenario.saleCosts.map(({ amount }) => amount),
    scenario.proceeds.amount.currency,
  );
  const settlement = sumAmounts(
    scenario.route === "share-sale"
      ? []
      : scenario.settlements.map(({ amount }) => amount),
    scenario.proceeds.amount.currency,
  );
  const proceedsRange = amountRange(scenario.proceeds.amount);
  const amount =
    scenario.proceeds.amount.amount - saleCost.amount - settlement.amount;
  const range = {
    currency: scenario.proceeds.amount.currency,
    lowerBound:
      proceedsRange.lowerBound -
      saleCost.range.upperBound -
      settlement.range.upperBound,
    upperBound:
      proceedsRange.upperBound -
      saleCost.range.lowerBound -
      settlement.range.lowerBound,
  };
  return {
    amount,
    range,
    distributableAmount: Math.max(0, amount),
    distributableRange: {
      ...range,
      lowerBound: Math.max(0, range.lowerBound),
      upperBound: Math.max(0, range.upperBound),
    },
  };
}

function addStrikingOffLimitIssue(input: {
  scenario: BusinessRealisationScenario;
  distributableAmount: number;
  issues: BusinessRealisationIssue[];
}): void {
  if (
    input.scenario.route !== "solvent-wind-down" ||
    input.scenario.procedure !== "striking-off"
  ) {
    return;
  }
  const resolution = resolveBusinessRealisationTaxRules(
    input.scenario.availableAt,
  );
  if (
    !resolution.available ||
    poundsToPence(input.distributableAmount) <=
      resolution.rules.strikingOffCapitalDistributionLimitPence
  ) {
    return;
  }
  input.issues.push({
    code: "striking-off-distribution-limit-exceeded",
    subjectId: input.scenario.scenarioId,
    detail:
      "A striking-off distribution above £25,000 cannot use the supported capital treatment",
  });
}

function supportedRouteTax(
  issues: readonly BusinessRealisationIssue[],
): boolean {
  const blockingCodes = new Set<BusinessRealisationIssue["code"]>([
    "unsupported-currency",
    "unsupported-company-tax",
    "missing-company-tax-settlement",
    "insolvent-company",
    "striking-off-distribution-limit-exceeded",
    "unsupported-case",
  ]);
  return !issues.some(({ code }) => blockingCodes.has(code));
}

export function calculateBusinessRealisation(
  input: CalculateBusinessRealisationInput,
): BusinessRealisationResult | null {
  validateBusinessRealisationScenarios(input.scenarios);
  const scenario = selectedScenario(input);
  if (scenario == null) return null;
  const valuation = selectedValuation(scenario, input);
  const valuationAgeDays =
    valuation == null
      ? null
      : daysBetween(valuation.validAt, scenario.proceeds.receivedAt);
  const issues = collectScenarioIssues({
    scenario,
    valuation,
    valuationAgeDays,
  });

  const interests = knownPersonInterests(scenario, input, issues);
  const ownerIds = new Set(interests.map(({ ownerEntityId }) => ownerEntityId));
  const transfers = matchedTransfers(scenario, ownerIds, input, issues);
  const net = netProceeds(scenario);
  const capitalTreatment = scenario.route !== "company-asset-sale";
  addStrikingOffLimitIssue({
    scenario,
    distributableAmount: net.distributableAmount,
    issues,
  });
  const distributions = calculateDistributions({
    scenario,
    interests,
    distributableAmount: net.distributableAmount,
    distributableRange: net.distributableRange,
    capitalTreatment,
    taxSupported: supportedRouteTax(issues),
    issues,
  });
  const allocatedFraction = distributions.reduce(
    (total, distribution) => total + distribution.ownershipFraction,
    0,
  );
  const personalTaxes = distributions.map(({ personalTax }) => personalTax);
  const totalPersonalTax = personalTaxes.some((tax) => tax == null)
    ? null
    : personalTaxes.reduce<number>((total, tax) => total + (tax ?? 0), 0);
  const netHouseholdProceeds = distributions.some(
    ({ netAmount }) => netAmount == null,
  )
    ? null
    : distributions.reduce<number>(
        (total, distribution) => total + (distribution.netAmount ?? 0),
        0,
      );
  const ownershipRecordIds = [
    ...new Set(interests.map(({ recordId }) => recordId)),
  ];
  const taxRuleIds = [
    ...new Set(distributions.flatMap(({ taxRuleIds: ids }) => ids)),
  ];
  const taxSourceIds = [
    ...new Set(distributions.flatMap(({ taxSourceIds: ids }) => ids)),
  ];
  const inputRecordIds = [
    scenario.recordId,
    scenario.proceeds.recordId,
    ...(valuation == null ? [] : [valuation.recordId]),
    ...ownershipRecordIds,
    ...scenario.saleCosts.flatMap(({ id, inputRecordIds: ids }) => [
      id,
      ...ids,
    ]),
    ...scenario.settlements.flatMap(({ id, inputRecordIds: ids }) => [
      id,
      ...ids,
    ]),
    ...transfers.map(({ recordId }) => recordId),
    ...scenario.lineage.parentRecordIds,
    ...scenario.proceeds.lineage.parentRecordIds,
  ];

  return {
    calculationVersion: BUSINESS_REALISATION_CALCULATION_VERSION,
    scenarioId: scenario.scenarioId,
    scenarioRecordId: scenario.recordId,
    route: scenario.route,
    companyEntityId: scenario.companyEntityId,
    complete: issues.length === 0,
    grossProceeds: scenario.proceeds,
    valuation:
      valuation == null || valuationAgeDays == null
        ? null
        : {
            recordId: valuation.recordId,
            validAt: valuation.validAt,
            evidenceAt: valuation.evidenceAt,
            method: valuation.method,
            amount: valuation.amount,
            ...(valuation.range == null ? {} : { range: valuation.range }),
            ageDays: valuationAgeDays,
          },
    saleCosts: scenario.saleCosts,
    settlements: scenario.settlements,
    netProceedsBeforePersonalTax: net.amount,
    netProceedsRange: net.range,
    shortfall: Math.max(0, -net.amount),
    distributions,
    totalPersonalTax,
    netHouseholdProceeds,
    unallocatedOwnershipFraction: Math.max(0, 1 - allocatedFraction),
    issues,
    unsupportedCases: scenario.unsupportedCases,
    lineage: {
      inputRecordIds: [...new Set(inputRecordIds)],
      valuationRecordIds: valuation == null ? [] : [valuation.recordId],
      ownershipRecordIds,
      transferRecordIds: transfers.map(({ recordId }) => recordId),
      taxRuleIds,
      taxSourceIds,
    },
    doubleCounting: {
      replacesContributionId: `business-interest:${scenario.companyEntityId}`,
      destinationAccountIds: distributions.flatMap(
        ({ destinationAccountId }) =>
          destinationAccountId == null ? [] : [destinationAccountId],
      ),
      eliminatedTransferIds: transfers.map(({ recordId }) => recordId),
    },
  };
}

export function businessRealisationAt(input: {
  scenarioId: string;
  asKnownAt: string;
  scenarios: readonly BusinessRealisationScenario[];
}): BusinessRealisationScenario | null {
  validateBusinessRealisationScenarios(input.scenarios);
  return selectedScenario({
    ...input,
    valuations: [],
    shareOwnershipInterests: [],
  });
}
