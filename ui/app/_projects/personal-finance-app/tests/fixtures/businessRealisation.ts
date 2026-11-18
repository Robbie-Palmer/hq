import type {
  BusinessRealisationOwnerTaxInput,
  BusinessRealisationScenario,
  EntityTransfer,
  FinancialRecordLineage,
} from "@/app/_projects/personal-finance-app/domain";
import { businessWealthFixture } from "./businessWealth";

const lineage = (
  sourceId: string,
  parentRecordIds: string[] = [],
): FinancialRecordLineage => ({
  kind: "manual",
  sourceId,
  sourceRevision: "synthetic-realisation-v1",
  parentRecordIds,
});

const ownerTaxInput = (
  ownerEntityId: string,
  ownershipPercent: number,
  destinationAccountId?: string,
): BusinessRealisationOwnerTaxInput => ({
  ownerEntityId,
  shareBaseCost: 10_000,
  lossesApplied: 0,
  remainingAnnualExemptAmount: 3_000,
  remainingDividendAllowance: 500,
  remainingBasicRateBand: 0,
  remainingHigherRateBand: 100_000,
  reliefEligibility: {
    state: "assessed",
    intendsToClaim: true,
    nonEmiOrdinaryShares: true,
    officerOrEmployeeForTwoYears: true,
    tradingCompanyForTwoYears: true,
    heldForTwoYears: true,
    ordinaryShareCapitalPercent: ownershipPercent,
    votingRightsPercent: ownershipPercent,
    economicEntitlement: {
      kind: "company-sale-proceeds",
      percent: ownershipPercent,
    },
    priorLifetimeQualifyingGainsPence: 0,
  },
  ...(destinationAccountId == null ? {} : { destinationAccountId }),
});

const ownerTaxInputs = (): BusinessRealisationOwnerTaxInput[] => [
  ownerTaxInput("person:alex", 40, "alex-cash"),
  ownerTaxInput("person:sam", 35),
];

const transfer = (input: {
  recordId: string;
  ownerEntityId: string;
  source: "company" | "buyer";
  kind: "dividend" | "other";
  amount: number;
}): EntityTransfer => ({
  recordId: input.recordId,
  transferId: input.recordId,
  effectiveFrom: "2026-11-15",
  acceptedAt: "2026-11-16T09:00:00.000Z",
  lineage: lineage(input.recordId),
  classification: { state: "known", kind: input.kind },
  legs: [
    {
      id: `${input.recordId}:source`,
      role: "source",
      endpoint:
        input.source === "company"
          ? { kind: "entity", entityId: "company:northstar" }
          : { kind: "external", counterpartyId: "buyer:example" },
      amount: { state: "known", currency: "GBP", amount: input.amount },
      financialFactId: `${input.recordId}:source-fact`,
    },
    {
      id: `${input.recordId}:destination`,
      role: "destination",
      endpoint: { kind: "entity", entityId: input.ownerEntityId },
      amount: { state: "known", currency: "GBP", amount: input.amount },
      financialFactId: `${input.recordId}:destination-fact`,
    },
  ],
});

const commonScenario = {
  companyEntityId: "company:northstar",
  effectiveFrom: "2026-11-01",
  valuationRecordId: "northstar-valuation-correction",
  maxValuationAgeDays: 60,
  ownershipDate: "2026-11-15",
  householdOwnerEntityIds: ["person:alex", "person:sam"],
  saleCosts: [
    {
      id: "sale-adviser-cost",
      kind: "professional-cost" as const,
      label: "Legal and tax advisers",
      settledAt: "2026-11-15",
      amount: {
        currency: "GBP" as const,
        amount: 20_000,
        range: {
          currency: "GBP" as const,
          lowerBound: 15_000,
          upperBound: 25_000,
        },
      },
      inputRecordIds: ["sale-adviser-invoice"],
    },
  ],
  ownerTaxInputs: ownerTaxInputs(),
  unsupportedCases: [],
  availableAt: "2026-11-15",
};

export function businessRealisationFixture() {
  const data = businessWealthFixture();
  const shareSaleOriginal: BusinessRealisationScenario = {
    ...commonScenario,
    recordId: "northstar-share-sale-v1",
    scenarioId: "northstar-share-sale",
    acceptedAt: "2026-11-02T09:00:00.000Z",
    lineage: lineage("share-sale-offer-v1"),
    route: "share-sale",
    completedAt: "2026-11-15",
    proceeds: {
      recordId: "northstar-share-sale-proceeds-v1",
      receivedAt: "2026-11-15",
      evidenceKind: "contract",
      amount: {
        currency: "GBP",
        amount: 390_000,
        range: { currency: "GBP", lowerBound: 375_000, upperBound: 410_000 },
      },
      lineage: lineage("share-sale-contract-v1"),
    },
    settlements: [],
    relatedTransferRecordIds: ["share-sale-alex", "share-sale-sam"],
  };
  const shareSaleCorrection: BusinessRealisationScenario = {
    ...shareSaleOriginal,
    recordId: "northstar-share-sale-v2",
    acceptedAt: "2026-11-10T09:00:00.000Z",
    correctsId: shareSaleOriginal.recordId,
    lineage: lineage("share-sale-completion-v2", [shareSaleOriginal.recordId]),
    proceeds: {
      recordId: "northstar-share-sale-proceeds-v2",
      receivedAt: "2026-11-15",
      evidenceKind: "observed",
      amount: {
        currency: "GBP",
        amount: 400_000,
        range: { currency: "GBP", lowerBound: 400_000, upperBound: 400_000 },
      },
      lineage: lineage("share-sale-completion-statement", [
        shareSaleOriginal.proceeds.recordId,
      ]),
    },
  };
  const assetSale: BusinessRealisationScenario = {
    ...commonScenario,
    recordId: "northstar-asset-sale-v1",
    scenarioId: "northstar-asset-sale",
    acceptedAt: "2026-11-10T09:00:00.000Z",
    lineage: lineage("asset-sale-plan"),
    route: "company-asset-sale",
    assetSaleCompletedAt: "2026-11-15",
    distributionTreatment: "ordinary-dividend",
    companyTaxTreatment: {
      state: "settled",
      settlementId: "asset-sale-company-tax",
    },
    proceeds: {
      recordId: "northstar-asset-sale-proceeds",
      receivedAt: "2026-11-15",
      evidenceKind: "contract",
      amount: { currency: "GBP", amount: 300_000 },
      lineage: lineage("asset-sale-contract"),
    },
    settlements: [
      {
        id: "asset-sale-liability",
        subjectId: "northstar-working-capital-debt",
        kind: "liability",
        settledAt: "2026-11-15",
        amount: { currency: "GBP", amount: 50_000 },
        inputRecordIds: ["company-loan-value-2026-09-30"],
      },
      {
        id: "asset-sale-company-tax",
        subjectId: "northstar-asset-sale-tax",
        kind: "company-tax",
        settledAt: "2026-11-15",
        amount: { currency: "GBP", amount: 20_000 },
        inputRecordIds: ["northstar-asset-sale-tax-assessment"],
      },
    ],
    relatedTransferRecordIds: [
      "asset-sale-dividend-alex",
      "asset-sale-dividend-sam",
    ],
  };
  const windDown: BusinessRealisationScenario = {
    ...commonScenario,
    recordId: "northstar-wind-down-v1",
    scenarioId: "northstar-wind-down",
    acceptedAt: "2026-11-10T09:00:00.000Z",
    lineage: lineage("mvl-plan"),
    route: "solvent-wind-down",
    procedure: "members-voluntary-liquidation",
    ceasedTradingAt: "2026-10-31",
    solvent: true,
    canPayDebtsWithinTwelveMonths: true,
    companyTaxTreatment: {
      state: "settled",
      settlementId: "wind-down-company-tax",
    },
    proceeds: {
      recordId: "northstar-wind-down-proceeds",
      receivedAt: "2026-11-15",
      evidenceKind: "assumption",
      amount: {
        currency: "GBP",
        amount: 120_000,
        range: { currency: "GBP", lowerBound: 100_000, upperBound: 140_000 },
      },
      lineage: lineage("mvl-estimate"),
    },
    settlements: [
      {
        id: "wind-down-obligation",
        subjectId: "northstar-corporation-tax-2026",
        kind: "obligation",
        settledAt: "2026-11-15",
        amount: { currency: "GBP", amount: 20_000 },
        inputRecordIds: ["northstar-corporation-tax-2026"],
      },
      {
        id: "wind-down-company-tax",
        subjectId: "northstar-closure-tax",
        kind: "company-tax",
        settledAt: "2026-11-15",
        amount: { currency: "GBP", amount: 5_000 },
        inputRecordIds: ["northstar-closure-tax-assessment"],
      },
    ],
    relatedTransferRecordIds: ["wind-down-alex", "wind-down-sam"],
  };

  const entityTransfers = [
    transfer({
      recordId: "share-sale-alex",
      ownerEntityId: "person:alex",
      source: "buyer",
      kind: "other",
      amount: 152_000,
    }),
    transfer({
      recordId: "share-sale-sam",
      ownerEntityId: "person:sam",
      source: "buyer",
      kind: "other",
      amount: 133_000,
    }),
    transfer({
      recordId: "asset-sale-dividend-alex",
      ownerEntityId: "person:alex",
      source: "company",
      kind: "dividend",
      amount: 84_000,
    }),
    transfer({
      recordId: "asset-sale-dividend-sam",
      ownerEntityId: "person:sam",
      source: "company",
      kind: "dividend",
      amount: 73_500,
    }),
    transfer({
      recordId: "wind-down-alex",
      ownerEntityId: "person:alex",
      source: "company",
      kind: "other",
      amount: 30_000,
    }),
    transfer({
      recordId: "wind-down-sam",
      ownerEntityId: "person:sam",
      source: "company",
      kind: "other",
      amount: 26_250,
    }),
  ];

  return {
    data,
    scenarios: [shareSaleOriginal, shareSaleCorrection, assetSale, windDown],
    shareSaleOriginal,
    shareSaleCorrection,
    assetSale,
    windDown,
    entityTransfers,
    input: {
      scenarioId: shareSaleCorrection.scenarioId,
      asKnownAt: "2026-11-20T00:00:00.000Z",
      scenarios: [shareSaleOriginal, shareSaleCorrection, assetSale, windDown],
      valuations: data.companyEquityValuations,
      shareOwnershipInterests: data.shareOwnershipInterests,
      entityTransfers,
    },
  };
}
