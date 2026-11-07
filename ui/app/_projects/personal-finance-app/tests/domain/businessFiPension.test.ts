import { describe, expect, it } from "vitest";
import { evaluateBusinessFiPensionContribution } from "@/app/_projects/personal-finance-app/domain";

const treatment = {
  accountId: "pension:owner",
  accessPolicy: {
    accessibleFromDate: "2035-04-06",
    accessDelayMonths: 2,
    withdrawalFeeRate: 0.01,
    taxTreatment: { kind: "fixed-rate" as const, rate: 0.2 },
    canFundOrdinarySpending: true,
  },
  inputRecordIds: ["pension-policy:owner"],
};

describe("business FI pension treatment", () => {
  it("keeps employer contributions in pension wealth until the dated access route", () => {
    const result = evaluateBusinessFiPensionContribution({
      id: "employer-pension:2026",
      planningDate: "2026-04-06",
      contributedOn: "2027-03-31",
      grossPence: 1_000_000,
      treatment,
      alreadyReflected: false,
      inputRecordIds: ["company-period:2026"],
    });

    expect(result).toMatchObject({
      supported: true,
      accessibleOn: "2035-04-06",
      grossPence: 1_000_000,
      withdrawalTaxPence: 200_000,
      withdrawalFeePence: 10_000,
      fiEligiblePence: 790_000,
      pensionWealthAddedPence: 1_000_000,
    });
    expect(result.inputRecordIds).toEqual([
      "company-period:2026",
      "pension-policy:owner",
    ]);
  });

  it("leaves a pension visible but ineligible when access or withdrawal tax is unsupported", () => {
    const result = evaluateBusinessFiPensionContribution({
      id: "employer-pension:unknown-access",
      planningDate: "2026-04-06",
      contributedOn: "2027-03-31",
      grossPence: 1_000_000,
      treatment: {
        accountId: "pension:owner",
        accessPolicy: {
          accessDelayMonths: 0,
          withdrawalFeeRate: 0,
          taxTreatment: {
            kind: "unsupported",
            reason: "Overseas pension withdrawal tax is not supported.",
          },
          canFundOrdinarySpending: true,
        },
        inputRecordIds: ["pension-policy:unknown"],
      },
      alreadyReflected: false,
      inputRecordIds: [],
    });

    expect(result.supported).toBe(false);
    expect(result.pensionWealthAddedPence).toBe(0);
    expect(result.fiEligiblePence).toBe(0);
    expect(result.issues.map(({ kind }) => kind)).toEqual([
      "pension-access-date-required",
      "unsupported-pension-tax-treatment",
    ]);
  });

  it("does not add a contribution already present in the pension balance", () => {
    const result = evaluateBusinessFiPensionContribution({
      id: "employer-pension:recorded",
      planningDate: "2026-04-06",
      contributedOn: "2027-03-31",
      grossPence: 1_000_000,
      treatment,
      alreadyReflected: true,
      inputRecordIds: ["transfer:recorded"],
    });

    expect(result).toMatchObject({
      supported: true,
      alreadyReflected: true,
      fiEligiblePence: 0,
      pensionWealthAddedPence: 0,
    });
  });
});
