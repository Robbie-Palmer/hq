import { accounts } from "@/content/assettracker/accounts";
import { incomeHistory } from "@/content/assettracker/incomeHistory";
import { propertyIndexHistories } from "@/content/assettracker/propertyIndexHistory";
import { recurringFlows } from "@/content/assettracker/recurringFlows";
import { salaryHistory } from "@/content/assettracker/salaryHistory";
import { snapshots } from "@/content/assettracker/snapshots";
import { transfers } from "@/content/assettracker/transfers";
import {
  exchangeRateObservations,
  holdingObservations,
  instruments,
  priceObservations,
} from "@/content/assettracker/valuations";
import {
  type AssetTrackerData,
  AssetTrackerDataSchema,
} from "@/lib/domain/assettracker/assetTrackerData";
import {
  type Ownership,
  personalOwnership,
} from "@/lib/domain/assettracker/household";

const alexOwnership = personalOwnership("alex");
const samOwnership = personalOwnership("sam");
const equalHouseholdOwnership: Ownership = {
  kind: "shared",
  shares: [
    { memberId: "alex", share: 0.5 },
    { memberId: "sam", share: 0.5 },
  ],
};
const homeOwnership: Ownership = {
  kind: "shared",
  shares: [
    { memberId: "alex", share: 0.6 },
    { memberId: "sam", share: 0.4 },
  ],
};

/** Builds the bundled demo dataset used by the static UI and local adapter. */
export function getDemoAssetTrackerData(): AssetTrackerData {
  return AssetTrackerDataSchema.parse({
    accounts,
    snapshots,
    incomeHistory,
    salaryHistory,
    transfers,
    recurringFlows,
    instruments,
    holdingObservations,
    priceObservations,
    exchangeRateObservations,
    propertyIndexHistories,
    mortgageScenarios: [
      {
        id: "five-year-fix",
        name: "Five-year fix",
        createdAt: "2024-12-01",
        assumptions: {
          purchasePrice: 298_000,
          availableFunds: 85_200,
          depositAmount: 85_200,
          initialAnnualRate: 0.0425,
          termMonths: 274,
          repaymentType: "repayment",
          accrualStartDate: "2024-12-01",
          firstPaymentDate: "2025-01-01",
          fixedPeriodEnd: "2030-01-01",
          followOnAnnualRate: 0.0525,
          refinanceFee: 999,
          purchaseFees: 0,
          taxes: 0,
          transactionCosts: 0,
          monthlyOverpayment: 0,
          overpaymentAllowance: 10_000,
          overpaymentChargeRate: 0.05,
        },
        source: {
          mortgageAccountId: "home-mortgage",
          propertyAccountId: "home",
          snapshotDate: "2024-12-01",
        },
        decisionRecordId: "five-year-fix-decision",
      },
    ],
    decisionRecords: [
      {
        id: "five-year-fix-decision",
        kind: "mortgage",
        title: "Five-year fix",
        scenarioId: "five-year-fix",
        recordedAt: "2024-12-01",
        status: "recorded",
      },
    ],
    household: {
      members: [
        { id: "alex", displayName: "Alex" },
        { id: "sam", displayName: "Sam" },
      ],
      activeScope: { kind: "household" },
    },
    ownership: {
      accounts: {
        "marcus-savings": samOwnership,
        "vanguard-global-all-cap": alexOwnership,
        "trading-212-isa": samOwnership,
        "us-brokerage": alexOwnership,
        "coinbase-btc": alexOwnership,
        "nationwide-current": equalHouseholdOwnership,
        home: homeOwnership,
        "home-mortgage": homeOwnership,
        "amex-credit-card": samOwnership,
        "workplace-pension": alexOwnership,
        "old-mutual-pension": alexOwnership,
      },
      incomeHistory: Object.fromEntries(
        incomeHistory.map(({ date }) => [date, equalHouseholdOwnership]),
      ),
    },
    taxPosition: {
      taxYear: "2026-27",
      profiles: [
        {
          memberId: "alex",
          jurisdiction: "england-and-northern-ireland",
          residence: "full-year-uk",
          hasTaxableBenefits: false,
          nationalInsuranceCategory: "A",
          isCompanyDirector: false,
          flexiblyAccessedPension: false,
          evidence: {
            kind: "assumption",
            sourceRecordId: "tax-profile-alex-2026-27",
            detail: "Demo household assumption",
          },
        },
        {
          memberId: "sam",
          jurisdiction: "england-and-northern-ireland",
          residence: "full-year-uk",
          hasTaxableBenefits: false,
          nationalInsuranceCategory: "A",
          isCompanyDirector: false,
          flexiblyAccessedPension: false,
          evidence: {
            kind: "assumption",
            sourceRecordId: "tax-profile-sam-2026-27",
            detail: "Demo household assumption",
          },
        },
      ],
      income: [
        {
          id: "alex-employment-observed-2026-27",
          memberId: "alex",
          employmentId: "alex-main-job",
          date: "2026-10-04",
          kind: "employment",
          amountPence: 5_000_000,
          evidence: {
            kind: "observed",
            sourceRecordId: "alex-payroll-to-date-2026-10-04",
            detail: "Payroll taxable pay recorded to date",
          },
        },
        {
          id: "alex-employment-forecast-2026-27",
          memberId: "alex",
          employmentId: "alex-main-job",
          date: "2027-04-05",
          kind: "employment",
          amountPence: 1_000_000,
          evidence: {
            kind: "assumption",
            sourceRecordId: "alex-pay-forecast-2026-27",
            detail: "Expected taxable pay for the rest of the tax year",
          },
        },
        {
          id: "sam-employment-2026-27",
          memberId: "sam",
          employmentId: "sam-main-job",
          date: "2027-04-05",
          kind: "employment",
          amountPence: 4_000_000,
          evidence: {
            kind: "observed",
            sourceRecordId: "sam-p60-2026-27",
            detail: "P60 taxable pay",
          },
        },
        {
          id: "sam-marcus-interest-2026-27",
          memberId: "sam",
          accountId: "marcus-savings",
          date: "2027-03-31",
          kind: "savings-interest",
          amountPence: 150_000,
          evidence: {
            kind: "observed",
            sourceRecordId: "marcus-interest-certificate-2026-27",
            detail: "Annual interest certificate",
          },
        },
        {
          id: "alex-vanguard-dividend-2026-27",
          memberId: "alex",
          accountId: "vanguard-global-all-cap",
          date: "2027-03-31",
          kind: "dividend",
          amountPence: 120_000,
          evidence: {
            kind: "observed",
            sourceRecordId: "vanguard-tax-certificate-2026-27",
            detail: "Consolidated tax certificate",
          },
        },
        {
          id: "sam-isa-dividend-2026-27",
          memberId: "sam",
          accountId: "trading-212-isa",
          date: "2027-03-31",
          kind: "dividend",
          amountPence: 60_000,
          evidence: {
            kind: "observed",
            sourceRecordId: "trading-212-statement-2026-27",
            detail: "ISA annual statement",
          },
        },
      ],
      disposals: [
        {
          id: "alex-bitcoin-disposal-2026-27",
          memberId: "alex",
          accountId: "coinbase-btc",
          date: "2026-09-20",
          proceedsPence: 1_200_000,
          allowableCostPence: 700_000,
          lossesAppliedPence: 0,
          claimsRelief: false,
          evidence: {
            kind: "observed",
            sourceRecordId: "coinbase-disposal-2026-09-20",
            detail: "Exchange disposal record and pooled allowable cost",
          },
        },
      ],
      contributions: [
        {
          id: "sam-isa-contributions-2026-27",
          memberId: "sam",
          accountId: "trading-212-isa",
          date: "2026-10-04",
          kind: "isa",
          amountPence: 400_000,
          evidence: {
            kind: "observed",
            sourceRecordId: "trading-212-subscriptions-2026-27",
            detail: "ISA subscriptions recorded to date",
          },
        },
        {
          id: "sam-isa-contributions-forecast-2026-27",
          memberId: "sam",
          accountId: "trading-212-isa",
          date: "2027-04-05",
          kind: "isa",
          amountPence: 200_000,
          evidence: {
            kind: "assumption",
            sourceRecordId: "sam-isa-forecast-2026-27",
            detail: "Expected ISA subscriptions for the rest of the tax year",
          },
        },
        {
          id: "alex-pension-contributions-2026-27",
          memberId: "alex",
          accountId: "workplace-pension",
          date: "2026-10-04",
          kind: "pension",
          amountPence: 800_000,
          pensionMethod: "relief-at-source",
          employerContribution: false,
          evidence: {
            kind: "observed",
            sourceRecordId: "pension-statement-2026-27",
            detail:
              "Gross personal contributions recorded to date, including provider relief",
          },
        },
        {
          id: "alex-pension-contributions-forecast-2026-27",
          memberId: "alex",
          accountId: "workplace-pension",
          date: "2027-04-05",
          kind: "pension",
          amountPence: 200_000,
          pensionMethod: "relief-at-source",
          employerContribution: false,
          evidence: {
            kind: "assumption",
            sourceRecordId: "alex-pension-forecast-2026-27",
            detail:
              "Expected gross personal contributions for the rest of the tax year",
          },
        },
      ],
      unsupportedCases: [],
    },
    settings: {
      expectedAnnualInflation: 0.025,
      targetNetWorth: { amount: 500_000, currency: "GBP" },
      targetNetWorthIsReal: true,
      withdrawalRate: 0.04,
      baseCurrency: "GBP",
      valuationMaxAgeDays: 7,
    },
  });
}
