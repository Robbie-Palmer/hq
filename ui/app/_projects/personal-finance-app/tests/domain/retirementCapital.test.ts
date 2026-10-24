import { describe, expect, it } from "vitest";
import {
  AccountAccessPolicySchema,
  compareRetirementCapitalScenarios,
  projectRetirementCapital,
  type RetirementCapitalAccount,
  type RetirementCapitalScenario,
} from "@/app/_projects/personal-finance-app/domain";

function account(
  overrides: Partial<RetirementCapitalAccount> &
    Pick<RetirementCapitalAccount, "id" | "name" | "balance">,
): RetirementCapitalAccount {
  return {
    provider: "Test provider",
    assetType: "stocks",
    liquidity: "liquid",
    taxWrapper: "isa",
    expectedAnnualReturn: 0,
    ...overrides,
  };
}

function scenario(
  accounts: RetirementCapitalAccount[],
  overrides: Partial<RetirementCapitalScenario> = {},
): RetirementCapitalScenario {
  return {
    id: "base",
    label: "Base order",
    startDate: "2035-01-01",
    endDate: "2035-03-01",
    annualSpending: 12_000,
    accounts,
    withdrawalOrder: accounts.map(({ id }) => id),
    ...overrides,
  };
}

describe("projectRetirementCapital", () => {
  it("rejects access policies whose tax and fee consume the withdrawal", () => {
    expect(() =>
      AccountAccessPolicySchema.parse({
        withdrawalFeeRate: 0.25,
        taxTreatment: { kind: "fixed-rate", rate: 0.75 },
      }),
    ).toThrow("Withdrawal tax and fee rates must total less than 100%");
  });

  it("reports accessible-capital exhaustion while restricted net worth remains positive", () => {
    const result = projectRetirementCapital(
      scenario([
        account({ id: "isa", name: "ISA", balance: 1_500 }),
        account({
          id: "pension",
          name: "Pension",
          balance: 100_000,
          taxWrapper: "pension",
          liquidity: "illiquid",
          accessPolicy: {
            accessibleFromDate: "2040-01-01",
            accessDelayMonths: 0,
            withdrawalFeeRate: 0,
            taxTreatment: { kind: "fixed-rate", rate: 0.2 },
            canFundOrdinarySpending: true,
          },
        }),
      ]),
    );

    expect(result.openingNetWorth).toBe(101_500);
    expect(result.openingAccessibleCapital).toBe(1_500);
    expect(result.openingRestrictedCapital).toBe(100_000);
    expect(result.accessibleCapitalExhaustionDate).toBe("2035-02-01");
    expect(result.points[1]).toMatchObject({
      spendingShortfall: 500,
      totalNetWorth: 100_000,
    });
  });

  it("merges partial policies with wrapper and liquidity defaults", () => {
    const partialPolicy = AccountAccessPolicySchema.parse({
      accessDelayMonths: 1,
    });
    const result = projectRetirementCapital(
      scenario([
        account({
          id: "isa",
          name: "ISA",
          balance: 2_000,
          accessPolicy: partialPolicy,
        }),
        account({
          id: "property",
          name: "Property",
          balance: 100_000,
          assetType: "property",
          liquidity: "illiquid",
          accessPolicy: AccountAccessPolicySchema.parse({}),
        }),
      ]),
    );

    expect(result.points[0]?.restrictions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          accountId: "isa",
          reason: "not-yet-accessible",
        }),
        expect.objectContaining({
          accountId: "property",
          reason: "ordinary-spending-disabled",
        }),
      ]),
    );
    expect(result.points[1]?.withdrawals).toEqual([
      expect.objectContaining({
        accountId: "isa",
        tax: 0,
        netSpendingCash: 1_000,
      }),
    ]);
  });

  it("starts pension withdrawals on the configured access date", () => {
    const result = projectRetirementCapital(
      scenario([
        account({ id: "cash", name: "Cash", balance: 2_000 }),
        account({
          id: "pension",
          name: "Pension",
          balance: 10_000,
          taxWrapper: "pension",
          accessPolicy: {
            accessibleFromDate: "2035-03-01",
            accessDelayMonths: 0,
            withdrawalFeeRate: 0,
            taxTreatment: { kind: "fixed-rate", rate: 0.2 },
            canFundOrdinarySpending: true,
          },
        }),
      ]),
    );

    expect(result.points[0]?.withdrawals[0]?.accountId).toBe("cash");
    expect(result.points[1]?.withdrawals[0]?.accountId).toBe("cash");
    expect(result.points[2]?.withdrawals).toEqual([
      {
        accountId: "pension",
        accountName: "Pension",
        taxWrapper: "pension",
        grossWithdrawal: 1_250,
        tax: 250,
        fee: 0,
        netSpendingCash: 1_000,
      },
    ]);
  });

  it("uses the explicit taxable-to-ISA-to-pension order and itemises deductions", () => {
    const result = projectRetirementCapital(
      scenario(
        [
          account({
            id: "taxable",
            name: "General account",
            balance: 600,
            taxWrapper: "taxable",
            accessPolicy: {
              accessDelayMonths: 0,
              withdrawalFeeRate: 0.02,
              taxTreatment: { kind: "fixed-rate", rate: 0.18 },
              canFundOrdinarySpending: true,
            },
          }),
          account({ id: "isa", name: "ISA", balance: 600 }),
          account({
            id: "pension",
            name: "Pension",
            balance: 600,
            taxWrapper: "pension",
            accessPolicy: {
              accessibleFromDate: "2035-01-01",
              accessDelayMonths: 0,
              withdrawalFeeRate: 0,
              taxTreatment: { kind: "fixed-rate", rate: 0.2 },
              canFundOrdinarySpending: true,
            },
          }),
        ],
        { endDate: "2035-01-01" },
      ),
    );

    expect(result.withdrawalOrder.map(({ taxWrapper }) => taxWrapper)).toEqual([
      "taxable",
      "isa",
      "pension",
    ]);
    expect(result.points[0]?.withdrawals).toEqual([
      {
        accountId: "taxable",
        accountName: "General account",
        taxWrapper: "taxable",
        grossWithdrawal: 600,
        tax: 108,
        fee: 12,
        netSpendingCash: 480,
      },
      {
        accountId: "isa",
        accountName: "ISA",
        taxWrapper: "isa",
        grossWithdrawal: 520,
        tax: 0,
        fee: 0,
        netSpendingCash: 520,
      },
    ]);
  });

  it("keeps retained property outside accessible capital", () => {
    const result = projectRetirementCapital(
      scenario(
        [
          account({ id: "isa", name: "ISA", balance: 2_000 }),
          account({
            id: "home",
            name: "Home",
            balance: 300_000,
            assetType: "property",
            liquidity: "illiquid",
          }),
        ],
        { endDate: "2035-01-01", withdrawalOrder: ["isa"] },
      ),
    );

    expect(result.openingAccessibleCapital).toBe(2_000);
    expect(result.openingRestrictedCapital).toBe(300_000);
    expect(result.openingNetWorth).toBe(302_000);
  });

  it("releases housing equity only in the selected scenario and settles liabilities", () => {
    const accounts = [
      account({ id: "cash", name: "Cash", balance: 0 }),
      account({
        id: "home",
        name: "Home",
        balance: 300_000,
        assetType: "property",
        liquidity: "illiquid",
      }),
      account({
        id: "mortgage",
        name: "Mortgage",
        balance: -100_000,
        assetType: "mortgage",
        liquidity: "illiquid",
        taxWrapper: undefined,
      }),
    ];
    const [retain, sell] = compareRetirementCapitalScenarios([
      scenario(accounts, {
        id: "retain",
        label: "Retain home",
        endDate: "2035-01-01",
        withdrawalOrder: ["cash"],
      }),
      scenario(accounts, {
        id: "sell",
        label: "Sell and rent",
        endDate: "2035-01-01",
        withdrawalOrder: ["cash"],
        housingReleases: [
          {
            id: "sell-home",
            date: "2035-01-01",
            sourcePropertyAccountId: "home",
            destinationAccountId: "cash",
            grossProceeds: 310_000,
            retainedHousingValue: 0,
            tax: 0,
            fees: 10_000,
            liabilitySettlements: [{ accountId: "mortgage", amount: 110_000 }],
          },
        ],
      }),
    ]);

    expect(retain?.accessibleCapitalExhaustionDate).toBe("2035-01-01");
    expect(retain?.points[0]).toMatchObject({
      spendingShortfall: 1_000,
      totalNetWorth: 200_000,
    });
    expect(sell?.points[0]).toMatchObject({
      spendingShortfall: 0,
      accessibleCapital: 199_000,
      restrictedCapital: 0,
      totalNetWorth: 199_000,
      housingReleases: [
        {
          liabilitySettlements: [{ accountId: "mortgage", amount: 100_000 }],
          netReleasedCapital: 200_000,
        },
      ],
    });
  });

  it("applies a housing release at the first forecast point after its date", () => {
    const result = projectRetirementCapital(
      scenario(
        [
          account({ id: "cash", name: "Cash", balance: 0 }),
          account({
            id: "home",
            name: "Home",
            balance: 100_000,
            assetType: "property",
            liquidity: "illiquid",
          }),
        ],
        {
          endDate: "2035-02-01",
          annualSpending: 0,
          withdrawalOrder: ["cash"],
          housingReleases: [
            {
              id: "mid-month-sale",
              date: "2035-01-15",
              sourcePropertyAccountId: "home",
              destinationAccountId: "cash",
              grossProceeds: 100_000,
              retainedHousingValue: 0,
              tax: 0,
              fees: 0,
              liabilitySettlements: [],
            },
          ],
        },
      ),
    );

    expect(result.points[0]?.housingReleases).toEqual([]);
    expect(result.points[1]).toMatchObject({
      accessibleCapital: 100_000,
      restrictedCapital: 0,
      housingReleases: [{ id: "mid-month-sale" }],
    });
  });

  it("keeps unsupported tax treatment visible and applies access delays", () => {
    const result = projectRetirementCapital(
      scenario(
        [
          account({
            id: "unsupported",
            name: "Legacy plan",
            balance: 10_000,
            taxWrapper: "pension",
            accessPolicy: {
              accessibleFromDate: "2035-01-01",
              accessDelayMonths: 0,
              withdrawalFeeRate: 0,
              taxTreatment: {
                kind: "unsupported",
                reason: "Provider-specific exit tax is not modelled",
              },
              canFundOrdinarySpending: true,
            },
          }),
          account({
            id: "delayed",
            name: "Notice account",
            balance: 10_000,
            accessPolicy: {
              accessDelayMonths: 2,
              withdrawalFeeRate: 0,
              taxTreatment: { kind: "tax-free" },
              canFundOrdinarySpending: true,
            },
          }),
        ],
        { annualSpending: 6_000 },
      ),
    );

    expect(result.points[0]?.restrictions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          accountId: "unsupported",
          reason: "unsupported-tax-treatment",
        }),
        expect.objectContaining({
          accountId: "delayed",
          reason: "not-yet-accessible",
        }),
      ]),
    );
    expect(result.points[2]?.withdrawals).toEqual([
      expect.objectContaining({
        accountId: "delayed",
        netSpendingCash: 500,
      }),
    ]);
  });
});
