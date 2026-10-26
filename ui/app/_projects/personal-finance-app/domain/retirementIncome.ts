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

export const RentalIncomeTaxBasisSchema = z
  .object({
    annualOperatingExpenses: z.number().nonnegative(),
    annualAllowableExpenses: z.number().nonnegative(),
    annualResidentialFinanceCosts: z.number().nonnegative().default(0),
    expenseTreatment: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("actual-expenses") }),
      z.object({
        kind: z.literal("property-allowance"),
        annualAllowance: z.number().nonnegative(),
        lineage: VersionedTaxLineageSchema,
      }),
    ]),
  })
  .superRefine((basis, context) => {
    if (basis.annualAllowableExpenses > basis.annualOperatingExpenses) {
      context.addIssue({
        code: "custom",
        message:
          "Rental allowable expenses cannot exceed recorded operating expenses",
      });
    }
  });
export type RentalIncomeTaxBasis = z.infer<typeof RentalIncomeTaxBasisSchema>;

export const RetirementIncomeStreamSchema = z
  .object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
    kind: z.enum([
      "state-pension",
      "defined-benefit-pension",
      "annuity",
      "rental-income",
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
    rentalIncome: RentalIncomeTaxBasisSchema.optional(),
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
    if (stream.kind === "rental-income" && stream.rentalIncome == null) {
      context.addIssue({
        code: "custom",
        message: "Rental income needs a property-profit tax basis",
      });
    }
    if (stream.kind === "rental-income" && stream.amountBasis !== "gross") {
      context.addIssue({
        code: "custom",
        message: "Rental income must record gross rent before property costs",
      });
    }
    if (stream.kind !== "rental-income" && stream.rentalIncome != null) {
      context.addIssue({
        code: "custom",
        message: "Only rental income can have a property-profit tax basis",
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
  code:
    | "unsupported-tax"
    | "interacting-benefit"
    | "unsupported-currency"
    | "property-finance-cost-relief";
  detail: string;
};

export type ProjectedRetirementIncome = {
  streamId: string;
  name: string;
  ownerId: string;
  sourceLabel: "Verified entitlement" | "Manual estimate";
  grossAmount: number | null;
  taxableAmount: number | null;
  cashDeductions: number;
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

function rentalAmounts(
  stream: RetirementIncomeStream,
  grossAmount: number,
): { taxableAmount: number; cashDeductions: number } {
  if (stream.kind !== "rental-income" || stream.rentalIncome == null) {
    return { taxableAmount: grossAmount, cashDeductions: 0 };
  }
  const basis = stream.rentalIncome;
  const annualTaxDeduction =
    basis.expenseTreatment.kind === "actual-expenses"
      ? basis.annualAllowableExpenses
      : basis.expenseTreatment.annualAllowance;
  return {
    taxableAmount: roundMoney(
      Math.max(grossAmount - annualTaxDeduction / 12, 0),
    ),
    cashDeductions: roundMoney(
      (basis.annualOperatingExpenses + basis.annualResidentialFinanceCosts) /
        12,
    ),
  };
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
  const issues: RetirementIncomeIssue[] = stream.interactingBenefits.map(
    (benefit) => ({
      streamId: stream.id,
      code: "interacting-benefit",
      detail: `${benefit} may change this income or the household tax position`,
    }),
  );
  if (
    stream.kind === "rental-income" &&
    (stream.rentalIncome?.annualResidentialFinanceCosts ?? 0) > 0
  ) {
    issues.push({
      streamId: stream.id,
      code: "property-finance-cost-relief",
      detail:
        "Residential finance-cost tax reduction depends on the household tax position and is not included",
    });
  }
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
  const amounts = rentalAmounts(stream, amount);
  const taxableAmount =
    stream.amountBasis === "gross" ? amounts.taxableAmount : null;
  let taxAmount: number | null = null;
  if (stream.taxTreatment.kind === "fixed-rate") {
    taxAmount = roundMoney(
      (taxableAmount ?? amount) * stream.taxTreatment.rate,
    );
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
      taxableAmount,
      cashDeductions: amounts.cashDeductions,
      taxAmount,
      netAmount: roundMoney(amount - amounts.cashDeductions - (taxAmount ?? 0)),
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

function validateRentalBusinesses(
  streams: readonly RetirementIncomeStream[],
): void {
  const rentalOwnerIds = new Set<string>();
  for (const stream of streams) {
    if (stream.kind !== "rental-income") continue;
    if (rentalOwnerIds.has(stream.ownerId)) {
      throw new Error(
        `Rental properties for owner "${stream.ownerId}" must be combined into one property-business stream`,
      );
    }
    rentalOwnerIds.add(stream.ownerId);
  }
}

export function projectRetirementIncome(input: {
  date: string;
  streams: readonly RetirementIncomeStream[];
  overrides?: readonly RetirementIncomeOverride[];
  baseCurrency?: RetirementIncomeStream["currency"];
}): RetirementIncomeProjection {
  validateRentalBusinesses(input.streams);
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
