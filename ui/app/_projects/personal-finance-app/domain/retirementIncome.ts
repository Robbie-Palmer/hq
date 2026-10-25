import { differenceInYears, parseISO } from "date-fns";
import { z } from "zod";
import { CurrencySchema, DEFAULT_BASE_CURRENCY } from "./currency";

const VersionedTaxLineageSchema = z.object({
  calculationVersion: z.string().trim().min(1),
  ruleDatasetVersion: z.string().trim().min(1),
  ruleId: z.string().trim().min(1),
});

export const RetirementIncomeProvenanceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("verified-entitlement"),
    provider: z.string().trim().min(1),
    reference: z.string().trim().min(1),
    observedAt: z.iso.datetime({ offset: true }),
  }),
  z.object({
    kind: z.literal("manual-estimate"),
    note: z.string().trim().min(1).optional(),
  }),
]);
export type RetirementIncomeProvenance = z.infer<
  typeof RetirementIncomeProvenanceSchema
>;

export const RetirementIncomeInflationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("level") }),
  z.object({
    kind: z.literal("fixed-rate"),
    annualRate: z.number().min(-1),
  }),
  z.object({
    kind: z.literal("index-linked"),
    index: z.string().trim().min(1),
    assumedAnnualRate: z.number().min(-1),
  }),
]);
export type RetirementIncomeInflation = z.infer<
  typeof RetirementIncomeInflationSchema
>;

export const RetirementIncomeTaxTreatmentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("already-net") }),
  z.object({
    kind: z.literal("tax-free"),
    lineage: VersionedTaxLineageSchema,
  }),
  z.object({
    kind: z.literal("fixed-rate"),
    rate: z.number().min(0).lt(1),
    lineage: VersionedTaxLineageSchema,
  }),
  z.object({
    kind: z.literal("unsupported"),
    reason: z.string().trim().min(1),
  }),
]);
export type RetirementIncomeTaxTreatment = z.infer<
  typeof RetirementIncomeTaxTreatmentSchema
>;

export const RetirementIncomeStreamSchema = z
  .object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
    kind: z.enum([
      "state-pension",
      "defined-benefit-pension",
      "annuity",
      "other",
    ]),
    ownerId: z.string().trim().min(1),
    amount: z.number().positive(),
    amountBasis: z.enum(["gross", "net"]),
    frequency: z.enum(["weekly", "monthly", "quarterly", "annual"]),
    currency: CurrencySchema.default(DEFAULT_BASE_CURRENCY),
    startDate: z.iso.date(),
    endDate: z.iso.date().optional(),
    inflation: RetirementIncomeInflationSchema,
    survivorTreatment: z
      .object({
        kind: z.enum(["none", "continues", "percentage"]),
        survivorOwnerId: z.string().trim().min(1).optional(),
        percentage: z.number().positive().max(1).optional(),
      })
      .optional(),
    provenance: RetirementIncomeProvenanceSchema,
    taxTreatment: RetirementIncomeTaxTreatmentSchema,
    interactingBenefits: z.array(z.string().trim().min(1)).default([]),
  })
  .superRefine((stream, context) => {
    if (stream.endDate != null && stream.endDate < stream.startDate) {
      context.addIssue({
        code: "custom",
        message: "A retirement income stream cannot end before it starts",
      });
    }
    if (
      stream.amountBasis === "net" &&
      stream.taxTreatment.kind !== "already-net"
    ) {
      context.addIssue({
        code: "custom",
        message:
          "A net retirement income amount must use already-net tax treatment",
      });
    }
    if (
      stream.amountBasis === "gross" &&
      stream.taxTreatment.kind === "already-net"
    ) {
      context.addIssue({
        code: "custom",
        message:
          "A gross retirement income amount needs an explicit tax treatment",
      });
    }
    const survivor = stream.survivorTreatment;
    if (
      survivor?.kind === "percentage" &&
      (survivor.percentage == null || survivor.survivorOwnerId == null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Percentage survivor treatment needs an owner and percentage",
      });
    }
  });
export type RetirementIncomeStream = z.infer<
  typeof RetirementIncomeStreamSchema
>;

export const RetirementIncomeOverrideSchema = z.object({
  streamId: z.string().trim().min(1),
  startDate: z.iso.date().optional(),
  amount: z.number().positive().optional(),
  inflation: RetirementIncomeInflationSchema.optional(),
});
export type RetirementIncomeOverride = z.infer<
  typeof RetirementIncomeOverrideSchema
>;

export type RetirementIncomeIssue = {
  streamId: string;
  code: "unsupported-tax" | "interacting-benefit" | "unsupported-currency";
  detail: string;
};

export type ProjectedRetirementIncome = {
  streamId: string;
  name: string;
  ownerId: string;
  sourceLabel: "Verified entitlement" | "Manual estimate";
  grossAmount: number | null;
  taxAmount: number | null;
  netAmount: number;
  taxLineage: z.infer<typeof VersionedTaxLineageSchema> | null;
};

export type RetirementIncomeProjection = {
  date: string;
  streams: ProjectedRetirementIncome[];
  grossAmount: number | null;
  taxAmount: number | null;
  netAmount: number;
  issues: RetirementIncomeIssue[];
};

const roundMoney = (amount: number): number =>
  Math.round((amount + Number.EPSILON) * 100) / 100;

const monthlyAmount = (
  amount: number,
  frequency: RetirementIncomeStream["frequency"],
): number => {
  switch (frequency) {
    case "weekly":
      return (amount * 52) / 12;
    case "monthly":
      return amount;
    case "quarterly":
      return amount / 3;
    case "annual":
      return amount / 12;
  }
};

function effectiveStream(
  stream: RetirementIncomeStream,
  override: RetirementIncomeOverride | undefined,
): RetirementIncomeStream {
  if (override == null) return stream;
  return RetirementIncomeStreamSchema.parse({
    ...stream,
    amount: override.amount ?? stream.amount,
    startDate: override.startDate ?? stream.startDate,
    inflation: override.inflation ?? stream.inflation,
  });
}

function inflatedAmount(
  amount: number,
  inflation: RetirementIncomeInflation,
  startDate: string,
  date: string,
): number {
  if (inflation.kind === "level") return amount;
  const completedYears = Math.max(
    differenceInYears(parseISO(date), parseISO(startDate)),
    0,
  );
  const rate =
    inflation.kind === "fixed-rate"
      ? inflation.annualRate
      : inflation.assumedAnnualRate;
  return amount * (1 + rate) ** completedYears;
}

export function retirementIncomeSourceLabel(
  provenance: RetirementIncomeProvenance,
): "Verified entitlement" | "Manual estimate" {
  return provenance.kind === "verified-entitlement"
    ? "Verified entitlement"
    : "Manual estimate";
}

function projectStream(input: {
  stream: RetirementIncomeStream;
  date: string;
  baseCurrency: RetirementIncomeStream["currency"];
}): {
  stream: ProjectedRetirementIncome | null;
  issues: RetirementIncomeIssue[];
} {
  const { stream, date, baseCurrency } = input;
  const issues = stream.interactingBenefits.map((benefit) => ({
    streamId: stream.id,
    code: "interacting-benefit" as const,
    detail: `${benefit} may change this income or the household tax position`,
  }));
  if (stream.currency !== baseCurrency) {
    return {
      stream: null,
      issues: [
        ...issues,
        {
          streamId: stream.id,
          code: "unsupported-currency",
          detail: `${stream.currency} income needs an exchange-rate assumption before it can fund ${baseCurrency} spending`,
        },
      ],
    };
  }
  if (stream.taxTreatment.kind === "unsupported") {
    return {
      stream: null,
      issues: [
        ...issues,
        {
          streamId: stream.id,
          code: "unsupported-tax",
          detail: stream.taxTreatment.reason,
        },
      ],
    };
  }

  const amount = roundMoney(
    inflatedAmount(
      monthlyAmount(stream.amount, stream.frequency),
      stream.inflation,
      stream.startDate,
      date,
    ),
  );
  const grossAmount = stream.amountBasis === "gross" ? amount : null;
  let taxAmount: number | null = null;
  if (stream.taxTreatment.kind === "fixed-rate") {
    taxAmount = roundMoney(amount * stream.taxTreatment.rate);
  } else if (stream.amountBasis === "gross") {
    taxAmount = 0;
  }
  return {
    stream: {
      streamId: stream.id,
      name: stream.name,
      ownerId: stream.ownerId,
      sourceLabel: retirementIncomeSourceLabel(stream.provenance),
      grossAmount,
      taxAmount,
      netAmount: roundMoney(amount - (taxAmount ?? 0)),
      taxLineage:
        stream.taxTreatment.kind === "fixed-rate" ||
        stream.taxTreatment.kind === "tax-free"
          ? stream.taxTreatment.lineage
          : null,
    },
    issues,
  };
}

function sumKnownAmounts(
  streams: readonly ProjectedRetirementIncome[],
  field: "grossAmount" | "taxAmount",
): number | null {
  if (streams.some((stream) => stream[field] == null)) return null;
  return roundMoney(
    streams.reduce((sum, stream) => sum + (stream[field] ?? 0), 0),
  );
}

export function projectRetirementIncome(input: {
  date: string;
  streams: readonly RetirementIncomeStream[];
  overrides?: readonly RetirementIncomeOverride[];
  baseCurrency?: RetirementIncomeStream["currency"];
}): RetirementIncomeProjection {
  const overrides = new Map(
    (input.overrides ?? []).map((override) => [override.streamId, override]),
  );
  const baseCurrency = input.baseCurrency ?? DEFAULT_BASE_CURRENCY;
  const projected: ProjectedRetirementIncome[] = [];
  const issues: RetirementIncomeIssue[] = [];

  for (const acceptedStream of input.streams) {
    const stream = effectiveStream(
      acceptedStream,
      overrides.get(acceptedStream.id),
    );
    if (
      input.date < stream.startDate ||
      (stream.endDate != null && input.date > stream.endDate)
    ) {
      continue;
    }
    const result = projectStream({
      stream,
      date: input.date,
      baseCurrency,
    });
    issues.push(...result.issues);
    if (result.stream != null) projected.push(result.stream);
  }

  return {
    date: input.date,
    streams: projected,
    grossAmount: sumKnownAmounts(projected, "grossAmount"),
    taxAmount: sumKnownAmounts(projected, "taxAmount"),
    netAmount: roundMoney(
      projected.reduce((sum, stream) => sum + stream.netAmount, 0),
    ),
    issues,
  };
}
