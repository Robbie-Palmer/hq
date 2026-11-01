import { differenceInMinutes, parseISO } from "date-fns";
import { z } from "zod";
import { CurrencySchema } from "./currency";

export const ForeignExchangeSourceSchema = z.object({
  provider: z.string().trim().min(1, "Source provider is required"),
  label: z.string().trim().min(1, "Source label is required"),
  url: z.url("Enter a valid source URL"),
  observedAt: z.iso.datetime({ offset: true }),
});
export type ForeignExchangeSource = z.infer<typeof ForeignExchangeSourceSchema>;

const SourcedRateSchema = z.object({
  rate: z.number().positive(),
  source: ForeignExchangeSourceSchema,
});

export const ForeignExchangeDecisionInputSchema = z
  .object({
    amount: z.number().positive(),
    sourceCurrency: CurrencySchema,
    targetCurrency: CurrencySchema,
    comparedAt: z.iso.datetime({ offset: true }),
    referenceRate: SourcedRateSchema,
    providerQuote: SourcedRateSchema.extend({
      fixedFee: z.number().nonnegative(),
      percentageFee: z.number().min(0).max(100),
    }),
    futureRate: z.number().positive(),
    stressRate: z.number().positive(),
    stagedNowPercentage: z.number().positive().lt(100),
  })
  .superRefine((input, context) => {
    if (input.sourceCurrency === input.targetCurrency) {
      context.addIssue({
        code: "custom",
        message: "Conversion currencies must differ",
        path: ["targetCurrency"],
      });
    }
    for (const [key, source] of [
      ["referenceRate", input.referenceRate.source],
      ["providerQuote", input.providerQuote.source],
    ] as const) {
      if (source.observedAt > input.comparedAt) {
        context.addIssue({
          code: "custom",
          message: "Source time cannot be later than the comparison",
          path: [key, "source", "observedAt"],
        });
      }
    }
  });
export type ForeignExchangeDecisionInput = z.infer<
  typeof ForeignExchangeDecisionInputSchema
>;

export const ForeignExchangeScenarioIdSchema = z.enum([
  "now",
  "delay-future",
  "delay-stress",
  "staged-future",
  "staged-stress",
]);
export type ForeignExchangeScenarioId = z.infer<
  typeof ForeignExchangeScenarioIdSchema
>;

export type ForeignExchangeScenarioResult = {
  id: ForeignExchangeScenarioId;
  strategy: "now" | "delay" | "staged";
  rateCase: "sourced-quote" | "future-assumption" | "stress-assumption";
  label: string;
  referenceRate: number;
  executableRate: number;
  sourceFees: number;
  grossReferenceProceeds: number;
  spreadAndFeeCost: number;
  netProceeds: number;
  breakEvenFutureRate: number | null;
  assumption: boolean;
};

export type ForeignExchangeDecisionComparison = {
  input: ForeignExchangeDecisionInput;
  spreadPercentage: number;
  quoteAgeMinutes: number;
  sources: Array<{
    input: "Reference rate" | "Available quote";
    rate: number;
    source: ForeignExchangeSource;
  }>;
  scenarios: ForeignExchangeScenarioResult[];
};

type ConversionLeg = {
  amount: number;
  referenceRate: number;
  executableRate: number;
};

function sourceFee(
  amount: number,
  quote: ForeignExchangeDecisionInput["providerQuote"],
): number {
  return Math.min(
    amount,
    quote.fixedFee + amount * (quote.percentageFee / 100),
  );
}

function resultFromLegs(input: {
  id: ForeignExchangeScenarioId;
  strategy: ForeignExchangeScenarioResult["strategy"];
  rateCase: ForeignExchangeScenarioResult["rateCase"];
  label: string;
  legs: ConversionLeg[];
  quote: ForeignExchangeDecisionInput["providerQuote"];
  breakEvenFutureRate: number | null;
  assumption: boolean;
}): ForeignExchangeScenarioResult {
  const totals = input.legs.reduce(
    (sum, leg) => {
      const fees = sourceFee(leg.amount, input.quote);
      const grossReferenceProceeds = leg.amount * leg.referenceRate;
      const netProceeds = (leg.amount - fees) * leg.executableRate;
      return {
        fees: sum.fees + fees,
        grossReferenceProceeds:
          sum.grossReferenceProceeds + grossReferenceProceeds,
        netProceeds: sum.netProceeds + netProceeds,
      };
    },
    { fees: 0, grossReferenceProceeds: 0, netProceeds: 0 },
  );
  const totalAmount = input.legs.reduce((sum, leg) => sum + leg.amount, 0);
  return {
    id: input.id,
    strategy: input.strategy,
    rateCase: input.rateCase,
    label: input.label,
    referenceRate:
      input.legs.reduce((sum, leg) => sum + leg.referenceRate * leg.amount, 0) /
      totalAmount,
    executableRate:
      input.legs.reduce(
        (sum, leg) => sum + leg.executableRate * leg.amount,
        0,
      ) / totalAmount,
    sourceFees: totals.fees,
    grossReferenceProceeds: totals.grossReferenceProceeds,
    spreadAndFeeCost: totals.grossReferenceProceeds - totals.netProceeds,
    netProceeds: totals.netProceeds,
    breakEvenFutureRate: input.breakEvenFutureRate,
    assumption: input.assumption,
  };
}

function breakEvenRate(input: {
  targetProceeds: number;
  currentLegProceeds: number;
  futureAmount: number;
  pricingMultiplier: number;
  quote: ForeignExchangeDecisionInput["providerQuote"];
}): number | null {
  const amountAfterFees =
    input.futureAmount - sourceFee(input.futureAmount, input.quote);
  const denominator = amountAfterFees * input.pricingMultiplier;
  if (denominator <= 0) return null;
  return Math.max(
    (input.targetProceeds - input.currentLegProceeds) / denominator,
    0,
  );
}

export function compareForeignExchangeDecision(
  value: ForeignExchangeDecisionInput,
): ForeignExchangeDecisionComparison {
  const input = ForeignExchangeDecisionInputSchema.parse(value);
  const pricingMultiplier = input.providerQuote.rate / input.referenceRate.rate;
  const spreadPercentage = (1 - pricingMultiplier) * 100;
  const quoteAgeMinutes = differenceInMinutes(
    parseISO(input.comparedAt),
    parseISO(input.providerQuote.source.observedAt),
  );
  const nowLeg: ConversionLeg = {
    amount: input.amount,
    referenceRate: input.referenceRate.rate,
    executableRate: input.providerQuote.rate,
  };
  const now = resultFromLegs({
    id: "now",
    strategy: "now",
    rateCase: "sourced-quote",
    label: "Convert now",
    legs: [nowLeg],
    quote: input.providerQuote,
    breakEvenFutureRate: null,
    assumption: false,
  });
  const nowAmount = input.amount * (input.stagedNowPercentage / 100);
  const futureAmount = input.amount - nowAmount;
  const stagedCurrentLeg: ConversionLeg = {
    amount: nowAmount,
    referenceRate: input.referenceRate.rate,
    executableRate: input.providerQuote.rate,
  };
  const stagedCurrentProceeds = resultFromLegs({
    id: "now",
    strategy: "now",
    rateCase: "sourced-quote",
    label: "Current staged leg",
    legs: [stagedCurrentLeg],
    quote: input.providerQuote,
    breakEvenFutureRate: null,
    assumption: false,
  }).netProceeds;
  const delayedBreakEven = breakEvenRate({
    targetProceeds: now.netProceeds,
    currentLegProceeds: 0,
    futureAmount: input.amount,
    pricingMultiplier,
    quote: input.providerQuote,
  });
  const stagedBreakEven = breakEvenRate({
    targetProceeds: now.netProceeds,
    currentLegProceeds: stagedCurrentProceeds,
    futureAmount,
    pricingMultiplier,
    quote: input.providerQuote,
  });

  function assumedScenario(
    id: Exclude<ForeignExchangeScenarioId, "now">,
    rate: number,
    rateCase: "future-assumption" | "stress-assumption",
  ): ForeignExchangeScenarioResult {
    const staged = id.startsWith("staged");
    const labelCase =
      rateCase === "future-assumption" ? "future assumption" : "stress case";
    return resultFromLegs({
      id,
      strategy: staged ? "staged" : "delay",
      rateCase,
      label: `${staged ? "Staged conversion" : "Delay conversion"}, ${labelCase}`,
      legs: staged
        ? [
            stagedCurrentLeg,
            {
              amount: futureAmount,
              referenceRate: rate,
              executableRate: rate * pricingMultiplier,
            },
          ]
        : [
            {
              amount: input.amount,
              referenceRate: rate,
              executableRate: rate * pricingMultiplier,
            },
          ],
      quote: input.providerQuote,
      breakEvenFutureRate: staged ? stagedBreakEven : delayedBreakEven,
      assumption: true,
    });
  }

  return {
    input,
    spreadPercentage,
    quoteAgeMinutes,
    sources: [
      {
        input: "Reference rate",
        rate: input.referenceRate.rate,
        source: input.referenceRate.source,
      },
      {
        input: "Available quote",
        rate: input.providerQuote.rate,
        source: input.providerQuote.source,
      },
    ],
    scenarios: [
      now,
      assumedScenario("delay-future", input.futureRate, "future-assumption"),
      assumedScenario("delay-stress", input.stressRate, "stress-assumption"),
      assumedScenario("staged-future", input.futureRate, "future-assumption"),
      assumedScenario("staged-stress", input.stressRate, "stress-assumption"),
    ],
  };
}

export const ForeignExchangeReconciliationSchema = z.object({
  completedAt: z.iso.datetime({ offset: true }),
  sourceAmount: z.number().positive(),
  targetAmount: z.number().nonnegative(),
  sourceFees: z.number().nonnegative(),
  note: z.string().trim().min(1),
});
export type ForeignExchangeReconciliation = z.infer<
  typeof ForeignExchangeReconciliationSchema
>;

export const ForeignExchangeDecisionRecordSchema = z.object({
  id: z.string().min(1),
  savedAt: z.iso.datetime({ offset: true }),
  selectedScenarioId: ForeignExchangeScenarioIdSchema,
  rationale: z.string().trim().min(1),
  assumptions: ForeignExchangeDecisionInputSchema,
  expectedNetProceeds: z.number().nonnegative(),
  reconciliation: ForeignExchangeReconciliationSchema.optional(),
});
export type ForeignExchangeDecisionRecord = z.infer<
  typeof ForeignExchangeDecisionRecordSchema
>;

export function createForeignExchangeDecisionRecord(input: {
  id: string;
  savedAt: string;
  selectedScenarioId: ForeignExchangeScenarioId;
  rationale: string;
  comparison: ForeignExchangeDecisionComparison;
}): ForeignExchangeDecisionRecord {
  const selected = input.comparison.scenarios.find(
    ({ id }) => id === input.selectedScenarioId,
  );
  if (selected == null) throw new TypeError("Selected FX scenario is missing");
  return ForeignExchangeDecisionRecordSchema.parse({
    id: input.id,
    savedAt: input.savedAt,
    selectedScenarioId: input.selectedScenarioId,
    rationale: input.rationale,
    assumptions: input.comparison.input,
    expectedNetProceeds: selected.netProceeds,
  });
}

export function reconcileForeignExchangeDecision(
  record: ForeignExchangeDecisionRecord,
  value: ForeignExchangeReconciliation,
): ForeignExchangeDecisionRecord {
  const reconciliation = ForeignExchangeReconciliationSchema.parse(value);
  if (reconciliation.completedAt < record.savedAt) {
    throw new TypeError("Completed conversion cannot predate the decision");
  }
  return ForeignExchangeDecisionRecordSchema.parse({
    ...record,
    reconciliation,
  });
}

export function foreignExchangeReconciliationSummary(
  record: ForeignExchangeDecisionRecord,
): {
  actualRate: number;
  netProceedsVariance: number;
} | null {
  const actual = record.reconciliation;
  if (actual == null) return null;
  const convertedAmount = actual.sourceAmount - actual.sourceFees;
  return {
    actualRate:
      convertedAmount <= 0 ? 0 : actual.targetAmount / convertedAmount,
    netProceedsVariance: actual.targetAmount - record.expectedNetProceeds,
  };
}
