import { describe, expect, it } from "vitest";
import {
  adaptRedundancyPackage,
  futureCashFlowForecastItems,
  type RedundancyPackage,
  RedundancyPackageSchema,
} from "@/app/_projects/personal-finance-app/domain";

const observed = <T>(value: T) => ({ value, basis: "observed" as const });
const assumed = <T>(value: T) => ({ value, basis: "assumed" as const });

function packageRecord(
  overrides: Partial<RedundancyPackage> = {},
): RedundancyPackage {
  return RedundancyPackageSchema.parse({
    id: "acme-exit-offer",
    version: 1,
    recordedAt: "2026-10-24T12:00:00Z",
    name: "ACME employment exit payment",
    employer: "ACME Ltd",
    offerDate: observed("2026-10-20"),
    leavingDate: assumed("2026-11-30"),
    currency: observed("GBP"),
    source: {
      kind: "document",
      title: "Voluntary redundancy offer",
      reference: "ACME-VR-2026-10",
    },
    calculationFacts: {
      jurisdiction: assumed("england-and-northern-ireland"),
      residence: observed("full-year-uk"),
      noticeTreatment: observed("worked-or-paid-in-full"),
      priorSection403Awards: assumed(0),
      hasOtherTaxInteractions: assumed(false),
    },
    payments: [
      {
        id: "payment-1",
        paymentDate: observed("2026-12-01"),
        destinationAccountId: observed("current"),
        grossComponents: [
          {
            id: "statutory",
            label: "Statutory redundancy",
            kind: "statutory-redundancy",
            amount: observed(12_000),
          },
          {
            id: "enhanced",
            label: "Enhanced redundancy",
            kind: "enhanced-redundancy",
            amount: observed(8_000),
          },
        ],
        deductions: [],
      },
    ],
    ...overrides,
  });
}

describe("redundancy package adapter", () => {
  it("rejects manual net amounts that cannot describe a cash payment", () => {
    const basePayment = {
      id: "payment-1",
      paymentDate: observed("2026-12-01"),
      destinationAccountId: observed("current"),
      deductions: [],
    };

    expect(() =>
      packageRecord({
        payments: [
          {
            ...basePayment,
            grossComponents: [
              {
                id: "award",
                label: "Enhanced award",
                kind: "enhanced-redundancy",
                amount: observed(10_000),
              },
            ],
            netAmount: observed(10_001),
          },
        ],
      }),
    ).toThrow("Net amount cannot exceed the cash gross components");

    expect(() =>
      packageRecord({
        payments: [
          {
            ...basePayment,
            pensionDestinationAccountId: observed("workplace-pension"),
            grossComponents: [
              {
                id: "pension",
                label: "Employer pension contribution",
                kind: "employer-pension-contribution",
                amount: observed(10_000),
              },
            ],
            netAmount: observed(9_000),
          },
        ],
      }),
    ).toThrow("A manual net amount requires at least one cash component");
  });

  it("uses an employer-provided net amount without waiting for tax support", () => {
    const record = packageRecord({
      payments: [
        {
          id: "payment-1",
          paymentDate: observed("2026-12-01"),
          destinationAccountId: observed("current"),
          grossComponents: [
            {
              id: "holiday",
              label: "Unused holiday",
              kind: "holiday-pay",
              amount: observed(5_000),
            },
            {
              id: "award",
              label: "Enhanced award",
              kind: "enhanced-redundancy",
              amount: observed(35_000),
            },
          ],
          deductions: [
            {
              id: "paye",
              label: "Employer PAYE deduction",
              kind: "income-tax",
              amount: observed(7_000),
            },
          ],
          netAmount: observed(31_000),
        },
      ],
    });

    const result = adaptRedundancyPackage(record);

    expect(result.available).toBe(true);
    if (!result.available)
      throw new Error("Expected employer net to be usable");
    expect(result.mode).toBe("employer-net");
    expect(result.futureCashFlows[0]?.stages[0]).toMatchObject({
      direction: "receipt",
      toAccountId: "current",
      amount: 31_000,
      amountBreakdown: {
        grossAmount: 40_000,
        taxAmount: 7_000,
        netAmount: 31_000,
      },
    });
    expect(result.treatments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Unused holiday",
          incomeTax: "payroll",
        }),
        expect.objectContaining({
          label: "Enhanced award",
          incomeTax: "section-403-threshold",
        }),
      ]),
    );
    expect(result.record.offerDate.basis).toBe("observed");
    expect(result.record.leavingDate.basis).toBe("assumed");
  });

  it("emits staged generic receipt events without special forecast behavior", () => {
    const record = packageRecord({
      payments: [
        {
          id: "payment-1",
          paymentDate: observed("2026-12-01"),
          destinationAccountId: observed("current"),
          grossComponents: [
            {
              id: "statutory",
              label: "Statutory redundancy",
              kind: "statutory-redundancy",
              amount: observed(12_000),
            },
          ],
          deductions: [],
        },
        {
          id: "payment-2",
          paymentDate: assumed("2027-01-15"),
          destinationAccountId: observed("savings"),
          grossComponents: [
            {
              id: "enhanced",
              label: "Enhanced redundancy",
              kind: "enhanced-redundancy",
              amount: assumed(8_000),
            },
          ],
          deductions: [],
        },
      ],
    });

    const result = adaptRedundancyPackage(record);

    expect(result.available).toBe(true);
    if (!result.available) throw new Error("Expected reviewed calculation");
    expect(result.mode).toBe("reviewed-rules");
    expect(futureCashFlowForecastItems(result.futureCashFlows)).toEqual([
      expect.objectContaining({
        date: "2026-12-01",
        amount: 12_000,
        direction: "receipt",
        toAccountId: "current",
      }),
      expect.objectContaining({
        date: "2027-01-15",
        amount: 8_000,
        direction: "receipt",
        toAccountId: "savings",
      }),
    ]);
  });

  it("keeps known deductions in the generic cash breakdown", () => {
    const record = packageRecord({
      payments: [
        {
          id: "payment-1",
          paymentDate: observed("2026-12-01"),
          destinationAccountId: observed("current"),
          grossComponents: [
            {
              id: "award",
              label: "Enhanced award",
              kind: "enhanced-redundancy",
              amount: observed(20_000),
            },
          ],
          deductions: [
            {
              id: "fee",
              label: "Administration fee",
              kind: "fee",
              amount: observed(500),
            },
            {
              id: "other",
              label: "Equipment balance",
              kind: "other",
              amount: observed(100),
            },
          ],
        },
      ],
    });

    const result = adaptRedundancyPackage(record);

    expect(result.available).toBe(true);
    if (!result.available) throw new Error("Expected reviewed calculation");
    expect(result.futureCashFlows[0]?.stages[0]).toMatchObject({
      amount: 19_400,
      amountBreakdown: {
        grossAmount: 20_000,
        feeAmount: 500,
        deductions: [{ label: "Equipment balance", amount: 100 }],
        netAmount: 19_400,
      },
    });
  });

  it("requires a manual net when one payment's deductions consume its cash", () => {
    const record = packageRecord({
      payments: [
        {
          id: "payment-1",
          paymentDate: observed("2026-12-01"),
          destinationAccountId: observed("current"),
          grossComponents: [
            {
              id: "award-1",
              label: "First award",
              kind: "enhanced-redundancy",
              amount: observed(100),
            },
          ],
          deductions: [
            {
              id: "deduction-1",
              label: "Employer deduction",
              kind: "other",
              amount: observed(100),
            },
          ],
        },
        {
          id: "payment-2",
          paymentDate: observed("2027-01-15"),
          destinationAccountId: observed("savings"),
          grossComponents: [
            {
              id: "award-2",
              label: "Second award",
              kind: "enhanced-redundancy",
              amount: observed(100),
            },
          ],
          deductions: [],
        },
      ],
    });

    const result = adaptRedundancyPackage(record);

    expect(result.available).toBe(false);
    if (result.available) throw new Error("Expected a manual-net requirement");
    expect(result.manualNetRequiredForPaymentIds).toEqual(["payment-1"]);
    expect(result.futureCashFlows).toEqual([]);
    expect(result.reasons).toContain(
      "Known deductions equal or exceed a payment's cash components and need a manual net amount.",
    );
  });

  it("separates employer pension contributions from the cash receipt", () => {
    const record = packageRecord({
      payments: [
        {
          id: "payment-1",
          paymentDate: observed("2026-12-01"),
          destinationAccountId: observed("current"),
          pensionDestinationAccountId: observed("workplace-pension"),
          grossComponents: [
            {
              id: "award",
              label: "Statutory redundancy",
              kind: "statutory-redundancy",
              amount: observed(10_000),
            },
            {
              id: "pension",
              label: "Employer pension contribution",
              kind: "employer-pension-contribution",
              amount: observed(5_000),
            },
          ],
          deductions: [],
        },
      ],
    });

    const result = adaptRedundancyPackage(record);

    expect(result.available).toBe(true);
    if (!result.available) throw new Error("Expected reviewed calculation");
    expect(result.futureCashFlows).toHaveLength(2);
    expect(result.futureCashFlows[0]?.stages[0]).toMatchObject({
      toAccountId: "current",
      amount: 10_000,
    });
    expect(result.futureCashFlows[1]?.stages[0]).toMatchObject({
      toAccountId: "workplace-pension",
      amount: 5_000,
    });
    expect(result.treatments).toContainEqual(
      expect.objectContaining({
        label: "Employer pension contribution",
        destination: "pension",
        incomeTax: "exempt",
      }),
    );
  });

  it("requires a manual net amount for unsupported treatment", () => {
    const record = packageRecord({
      calculationFacts: {
        jurisdiction: observed("other"),
        residence: observed("partial-year"),
        noticeTreatment: assumed("reduced-or-unknown"),
        priorSection403Awards: assumed(0),
        hasOtherTaxInteractions: observed(true),
      },
      payments: [
        {
          id: "payment-1",
          paymentDate: observed("2026-12-01"),
          destinationAccountId: observed("current"),
          grossComponents: [
            {
              id: "other",
              label: "Unclassified benefit",
              kind: "other",
              amount: observed(10_000),
            },
          ],
          deductions: [],
        },
      ],
    });

    const result = adaptRedundancyPackage(record);

    expect(result.available).toBe(false);
    if (result.available) throw new Error("Expected a manual-net requirement");
    expect(result.manualNetRequiredForPaymentIds).toEqual(["payment-1"]);
    expect(result.futureCashFlows).toEqual([]);
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        expect.stringContaining("jurisdiction"),
        expect.stringContaining("Partial-year"),
        expect.stringContaining("PENP"),
        expect.stringContaining("Other tax interactions"),
      ]),
    );
  });

  it("keeps event IDs stable when a later version corrects the offer", () => {
    const first = packageRecord({
      payments: [
        {
          id: "payment-1",
          paymentDate: observed("2026-12-01"),
          destinationAccountId: observed("current"),
          grossComponents: [
            {
              id: "award",
              label: "Enhanced award",
              kind: "enhanced-redundancy",
              amount: observed(35_000),
            },
          ],
          deductions: [],
          netAmount: observed(30_000),
        },
      ],
    });
    const corrected = packageRecord({
      version: 2,
      correctsVersion: 1,
      recordedAt: "2026-10-25T09:00:00Z",
      payments: [
        {
          id: "payment-1",
          paymentDate: observed("2026-12-01"),
          destinationAccountId: observed("current"),
          grossComponents: [
            {
              id: "award",
              label: "Enhanced award",
              kind: "enhanced-redundancy",
              amount: observed(36_000),
            },
          ],
          deductions: [],
          netAmount: observed(31_000),
        },
      ],
    });

    const firstResult = adaptRedundancyPackage(first);
    const correctedResult = adaptRedundancyPackage(corrected);

    expect(firstResult.available).toBe(true);
    expect(correctedResult.available).toBe(true);
    if (!(firstResult.available && correctedResult.available)) {
      throw new Error("Expected both recorded employer nets to be usable");
    }
    expect(correctedResult.futureCashFlows[0]?.id).toBe(
      firstResult.futureCashFlows[0]?.id,
    );
    expect(firstResult.futureCashFlows[0]?.stages[0]?.amount).toBe(30_000);
    expect(correctedResult.futureCashFlows[0]?.stages[0]?.amount).toBe(31_000);
    expect(correctedResult.record.correctsVersion).toBe(1);
  });
});
