import { z } from "zod";

export const InflationIndexSchema = z.enum(["CPI", "CPIH", "RPI"]);
export type InflationIndex = z.infer<typeof InflationIndexSchema>;

export const InflationFrequencySchema = z.enum(["monthly", "annual"]);
export type InflationFrequency = z.infer<typeof InflationFrequencySchema>;

export const IsoMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export const IsoYearSchema = z.string().regex(/^\d{4}$/);
export const InflationPeriodSchema = z.union([IsoMonthSchema, IsoYearSchema]);

export const InflationObservationSchema = z.object({
  period: InflationPeriodSchema,
  value: z.number().positive(),
});
export type InflationObservation = z.infer<typeof InflationObservationSchema>;

const periodsMatchFrequency = (
  observations: readonly InflationObservation[],
  frequency: InflationFrequency,
) => {
  const schema = frequency === "monthly" ? IsoMonthSchema : IsoYearSchema;
  return observations.every(({ period }) => schema.safeParse(period).success);
};

export const InflationSourceSchema = z.object({
  provider: z.literal("Office for National Statistics"),
  datasetId: z.string().min(1),
  seriesId: z.string().min(1),
  frequency: InflationFrequencySchema,
  baseDefinition: z.string().min(1),
  geography: z.string().min(1),
  coverageFrom: InflationPeriodSchema,
  coverageThrough: InflationPeriodSchema,
  sourceUrl: z.url(),
  releaseVersion: z.string().min(1),
  retrievedAt: z.iso.datetime({ offset: true }),
  checksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
});
export type InflationSource = z.infer<typeof InflationSourceSchema>;

export const InflationDatasetReleaseSchema = z
  .object({
    versionId: z.string().min(1),
    index: InflationIndexSchema,
    source: InflationSourceSchema,
    observations: z.array(InflationObservationSchema).min(1),
  })
  .superRefine((release, context) => {
    if (
      !periodsMatchFrequency(release.observations, release.source.frequency)
    ) {
      context.addIssue({
        code: "custom",
        message:
          release.source.frequency === "monthly"
            ? "Monthly releases require YYYY-MM observation periods"
            : "Annual releases require YYYY observation periods",
        path: ["observations"],
      });
      return;
    }

    const periods = release.observations.map(({ period }) => period);
    if (new Set(periods).size !== periods.length) {
      context.addIssue({
        code: "custom",
        message: "Inflation observations must have unique periods",
        path: ["observations"],
      });
    }
    const sorted = periods.toSorted((left, right) =>
      left.localeCompare(right),
    );
    if (periods.some((period, index) => period !== sorted[index])) {
      context.addIssue({
        code: "custom",
        message: "Inflation observations must be sorted by period",
        path: ["observations"],
      });
    }
    if (
      periods[0] !== release.source.coverageFrom ||
      periods.at(-1) !== release.source.coverageThrough
    ) {
      context.addIssue({
        code: "custom",
        message: "Source coverage must match the first and last observations",
        path: ["source"],
      });
    }
  });
export type InflationDatasetRelease = z.infer<
  typeof InflationDatasetReleaseSchema
>;

export const InflationDatasetArchiveSchema = z.object({
  releases: z.array(InflationDatasetReleaseSchema),
});
export type InflationDatasetArchive = z.infer<
  typeof InflationDatasetArchiveSchema
>;

export const DataLicenceSchema = z.object({
  name: z.literal("Open Government Licence v3.0"),
  url: z.literal(
    "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/",
  ),
  copyright: z.literal("Crown copyright"),
  attribution: z.string().min(1),
});

export const InflationDatasetSchema = InflationDatasetArchiveSchema.extend({
  datasetVersion: z.string().regex(/^\d{4}\.\d{2}\.\d+$/),
  releasedAt: z.iso.date(),
  supersedes: z.string().nullable(),
  corrections: z.array(
    z.object({
      releaseVersionId: z.string().min(1),
      description: z.string().min(1),
    }),
  ),
  dataLicence: DataLicenceSchema,
});
export type InflationDataset = z.infer<typeof InflationDatasetSchema>;
