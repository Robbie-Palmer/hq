import { z } from "zod";

export const HousingValueKindSchema = z.enum([
  "recorded-purchase",
  "recorded-valuation",
  "index-estimate",
  "regional-index-statistic",
  "completed-sale",
  "asking-price",
  "manual-override",
  "forecast",
]);
export type HousingValueKind = z.infer<typeof HousingValueKindSchema>;

export const HousingValueSourceKindSchema = z.enum([
  "transaction-record",
  "professional-valuation",
  "official-index",
  "official-completed-sale",
  "property-listing",
  "manual-entry",
  "scenario-model",
]);
export type HousingValueSourceKind = z.infer<
  typeof HousingValueSourceKindSchema
>;

export const HousingGeographySchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1).optional(),
  precision: z.enum([
    "exact-property",
    "full-postcode",
    "postcode-district",
    "local-authority",
    "region",
    "nation",
  ]),
});
export type HousingGeography = z.infer<typeof HousingGeographySchema>;

export const HousingValueSourceSchema = z.object({
  kind: HousingValueSourceKindSchema,
  name: z.string().min(1),
  date: z.iso.date(),
  dateKind: z.enum(["published", "retrieved", "recorded", "entered"]),
  geography: HousingGeographySchema,
});
export type HousingValueSource = z.infer<typeof HousingValueSourceSchema>;

export const HousingValueUncertaintySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("point"),
    explanation: z.string().min(1),
  }),
  z
    .object({
      kind: z.literal("indicative-range"),
      lower: z.number().positive(),
      upper: z.number().positive(),
      confidence: z.literal("indicative"),
      rule: z.string().min(1),
    })
    .refine(({ lower, upper }) => lower < upper, {
      message: "A housing-value range must have a lower bound below its upper bound",
      path: ["upper"],
    }),
]);
export type HousingValueUncertainty = z.infer<
  typeof HousingValueUncertaintySchema
>;

export const HousingValueSchema = z
  .object({
    id: z.string().min(1),
    kind: HousingValueKindSchema,
    amount: z.number().positive(),
    currency: z.literal("GBP"),
    asOf: z.iso.date(),
    source: HousingValueSourceSchema,
    dataStatus: z.enum(["final", "provisional", "revised"]),
    revisionNote: z.string().min(1).optional(),
    uncertainty: HousingValueUncertaintySchema,
    fallback: z
      .object({
        used: z.literal(true),
        explanation: z.string().min(1),
      })
      .optional(),
    explanation: z.string().min(1),
    freshness: z.object({
      assessedAt: z.iso.date(),
      staleAfterDays: z.number().int().nonnegative(),
    }),
  })
  .superRefine((value, context) => {
    const expectedSources: Record<HousingValueKind, HousingValueSourceKind> = {
      "recorded-purchase": "transaction-record",
      "recorded-valuation": "professional-valuation",
      "index-estimate": "official-index",
      "regional-index-statistic": "official-index",
      "completed-sale": "official-completed-sale",
      "asking-price": "property-listing",
      "manual-override": "manual-entry",
      forecast: "scenario-model",
    };
    if (value.source.kind !== expectedSources[value.kind]) {
      context.addIssue({
        code: "custom",
        message: `${value.kind} requires source kind ${expectedSources[value.kind]}`,
        path: ["source", "kind"],
      });
    }
    if (
      value.kind === "index-estimate" &&
      value.uncertainty.kind !== "indicative-range"
    ) {
      context.addIssue({
        code: "custom",
        message: "An index estimate requires an indicative range",
        path: ["uncertainty"],
      });
    }
    if (
      value.uncertainty.kind === "indicative-range" &&
      (value.amount < value.uncertainty.lower ||
        value.amount > value.uncertainty.upper)
    ) {
      context.addIssue({
        code: "custom",
        message: "The point value must sit inside its indicative range",
        path: ["amount"],
      });
    }
    if (value.dataStatus !== "final" && value.revisionNote == null) {
      context.addIssue({
        code: "custom",
        message: "Provisional and revised data require an explanation",
        path: ["revisionNote"],
      });
    }
  });
export type HousingValue = z.infer<typeof HousingValueSchema>;

export const UnsupportedHousingRegionSchema = z.object({
  status: z.literal("unsupported-region"),
  geography: HousingGeographySchema,
  sourceKind: HousingValueSourceKindSchema,
  sourceName: z.string().min(1),
  retrievedAt: z.iso.date(),
  explanation: z.string().min(1),
});
export type UnsupportedHousingRegion = z.infer<
  typeof UnsupportedHousingRegionSchema
>;

const DAY_IN_MILLISECONDS = 86_400_000;

function utcTime(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

export function housingValueAgeDays(value: HousingValue): number {
  return Math.floor(
    (utcTime(value.freshness.assessedAt) - utcTime(value.asOf)) /
      DAY_IN_MILLISECONDS,
  );
}

export function isHousingValueStale(value: HousingValue): boolean {
  const ageDays = housingValueAgeDays(value);
  return ageDays >= 0 && ageDays > value.freshness.staleAfterDays;
}

export function indicativeRange(
  amount: number,
  rangePercent: number,
  rule: string,
): HousingValueUncertainty {
  const parsedPercent = z.number().positive().max(1).parse(rangePercent);
  return {
    kind: "indicative-range",
    lower: amount * (1 - parsedPercent),
    upper: amount * (1 + parsedPercent),
    confidence: "indicative",
    rule,
  };
}
