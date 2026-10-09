import { z } from "zod";
import {
  buildMortgageSchedule,
  type MortgageRepaymentType,
  type MortgageScheduleRow,
} from "./mortgage";

export const MortgageCalculatorAssumptionsSchema = z.object({
  purchasePrice: z.number().positive(),
  availableFunds: z.number().nonnegative(),
  depositAmount: z.number().nonnegative(),
  initialAnnualRate: z.number().min(0).max(1),
  termMonths: z.number().int().positive().max(1_200),
  repaymentType: z.enum(["repayment", "interest-only"]),
  accrualStartDate: z.iso.date().optional(),
  firstPaymentDate: z.iso.date(),
  fixedPeriodEnd: z.iso.date().optional(),
  followOnAnnualRate: z.number().min(0).max(1),
  refinanceFee: z.number().nonnegative(),
  purchaseFees: z.number().nonnegative(),
  taxes: z.number().nonnegative(),
  transactionCosts: z.number().nonnegative(),
  monthlyOverpayment: z.number().nonnegative(),
  overpaymentAllowance: z.number().nonnegative(),
  overpaymentChargeRate: z.number().min(0).max(1),
});
export type MortgageCalculatorAssumptions = z.infer<
  typeof MortgageCalculatorAssumptionsSchema
>;

export const MortgageScenarioSourceSchema = z.object({
  mortgageAccountId: z.string().min(1).optional(),
  propertyAccountId: z.string().min(1).optional(),
  snapshotDate: z.iso.date().optional(),
});
export type MortgageScenarioSource = z.infer<
  typeof MortgageScenarioSourceSchema
>;

export const MortgageScenarioSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
  createdAt: z.iso.date(),
  assumptions: MortgageCalculatorAssumptionsSchema,
  source: MortgageScenarioSourceSchema,
  decisionRecordId: z.string().min(1).optional(),
});
export type MortgageScenario = z.infer<typeof MortgageScenarioSchema>;

export const FinancialDecisionRecordSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("mortgage"),
  title: z.string().trim().min(1),
  scenarioId: z.string().min(1),
  recordedAt: z.iso.date(),
  status: z.literal("recorded"),
});
export type FinancialDecisionRecord = z.infer<
  typeof FinancialDecisionRecordSchema
>;

export const SaveMortgageScenarioInputSchema = z.object({
  name: z.string().trim().min(1, "Give the scenario a name"),
  assumptions: MortgageCalculatorAssumptionsSchema,
  source: MortgageScenarioSourceSchema,
  recordDecision: z.boolean().default(false),
});
export type SaveMortgageScenarioInput = z.input<
  typeof SaveMortgageScenarioInputSchema
>;

export type MortgageOptionResult = {
  depositAmount: number;
  depositPercentage: number;
  openingLoan: number;
  loanToValue: number;
  retainedLiquidity: number;
  fundingShortfall: number;
  initialMonthlyPayment: number;
  totalInterest: number;
  totalFeesAndCharges: number;
  totalRequiredPayments: number;
  payoffDate: string;
  balanceAtFixExpiry: number | null;
  schedule: MortgageScheduleRow[];
};

export type MortgageRateStressResult = MortgageOptionResult & {
  rateAdjustment: number;
  initialAnnualRate: number;
  followOnAnnualRate: number;
};

export type MortgageCalculatorResult = {
  selected: MortgageOptionResult;
  depositOptions: MortgageOptionResult[];
  rateStress: MortgageRateStressResult[];
};

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function clampRate(rate: number): number {
  return Math.min(Math.max(rate, 0), 1);
}

function scheduleFor(
  assumptions: MortgageCalculatorAssumptions,
  depositAmount: number,
  rateAdjustment: number,
): MortgageOptionResult {
  const deposit = Math.min(
    Math.max(depositAmount, 0),
    assumptions.purchasePrice,
  );
  const openingLoan = roundMoney(assumptions.purchasePrice - deposit);
  const upfrontCosts =
    assumptions.purchaseFees + assumptions.taxes + assumptions.transactionCosts;
  const fixedPeriodEnd = assumptions.fixedPeriodEnd;
  const rateChanges =
    fixedPeriodEnd == null
      ? []
      : [
          {
            date: fixedPeriodEnd,
            rate: clampRate(assumptions.followOnAnnualRate + rateAdjustment),
          },
        ];
  const fees =
    fixedPeriodEnd == null || assumptions.refinanceFee <= 0
      ? []
      : [
          {
            date: fixedPeriodEnd,
            amount: assumptions.refinanceFee,
          },
        ];
  const schedule =
    openingLoan === 0
      ? []
      : buildMortgageSchedule({
          openingBalance: -openingLoan,
          initialAnnualRate: clampRate(
            assumptions.initialAnnualRate + rateAdjustment,
          ),
          rateChanges,
          repaymentType: assumptions.repaymentType,
          monthlyOverpayment: assumptions.monthlyOverpayment,
          accrualStartDate: assumptions.accrualStartDate,
          terms: {
            firstPaymentDate: assumptions.firstPaymentDate,
            remainingTermMonths: assumptions.termMonths,
            overpaymentAllowance: {
              amount: assumptions.overpaymentAllowance,
              chargeRate: assumptions.overpaymentChargeRate,
            },
            fees,
            overpayments: [],
            termChanges: [],
          },
        });
  const requiredUpfront = deposit + upfrontCosts;
  const rowAtFixExpiry =
    fixedPeriodEnd == null
      ? undefined
      : schedule.find((row) => row.date >= fixedPeriodEnd);
  return {
    depositAmount: roundMoney(deposit),
    depositPercentage: deposit / assumptions.purchasePrice,
    openingLoan,
    loanToValue: openingLoan / assumptions.purchasePrice,
    retainedLiquidity: roundMoney(
      Math.max(assumptions.availableFunds - requiredUpfront, 0),
    ),
    fundingShortfall: roundMoney(
      Math.max(requiredUpfront - assumptions.availableFunds, 0),
    ),
    initialMonthlyPayment: schedule[0]?.scheduledPayment ?? 0,
    totalInterest: roundMoney(
      schedule.reduce((sum, row) => sum + row.interest, 0),
    ),
    totalFeesAndCharges: roundMoney(
      upfrontCosts +
        schedule.reduce(
          (sum, row) => sum + row.fees + row.overpaymentCharge,
          0,
        ),
    ),
    totalRequiredPayments: roundMoney(
      requiredUpfront + schedule.reduce((sum, row) => sum + row.totalDue, 0),
    ),
    payoffDate: schedule.at(-1)?.date ?? assumptions.firstPaymentDate,
    balanceAtFixExpiry: rowAtFixExpiry?.openingBalance ?? null,
    schedule,
  };
}

function depositOptions(assumptions: MortgageCalculatorAssumptions): number[] {
  const step = assumptions.purchasePrice * 0.05;
  const sixtyPercentLtvDeposit = assumptions.purchasePrice * 0.4;
  return [
    assumptions.depositAmount - step,
    assumptions.depositAmount,
    assumptions.depositAmount + step,
    sixtyPercentLtvDeposit,
  ]
    .map((amount) =>
      Math.min(Math.max(roundMoney(amount), 0), assumptions.purchasePrice),
    )
    .filter((amount, index, values) => values.indexOf(amount) === index)
    .toSorted((a, b) => a - b);
}

export function calculateMortgageOptions(
  input: MortgageCalculatorAssumptions,
): MortgageCalculatorResult {
  const assumptions = MortgageCalculatorAssumptionsSchema.parse(input);
  const selected = scheduleFor(assumptions, assumptions.depositAmount, 0);
  return {
    selected,
    depositOptions: depositOptions(assumptions).map((deposit) =>
      scheduleFor(assumptions, deposit, 0),
    ),
    rateStress: [-0.02, 0, 0.02].map((rateAdjustment) => ({
      ...scheduleFor(assumptions, assumptions.depositAmount, rateAdjustment),
      rateAdjustment,
      initialAnnualRate: clampRate(
        assumptions.initialAnnualRate + rateAdjustment,
      ),
      followOnAnnualRate: clampRate(
        assumptions.followOnAnnualRate + rateAdjustment,
      ),
    })),
  };
}

export function repaymentTypeLabel(value: MortgageRepaymentType): string {
  return value === "repayment" ? "Repayment" : "Interest-only";
}
