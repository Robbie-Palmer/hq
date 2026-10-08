import { z } from "zod";

export const IsoMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export const HousePropertyTypeSchema = z.enum([
  "all",
  "detached",
  "semi-detached",
  "terraced",
  "flat-maisonette",
]);
export type HousePropertyType = z.infer<typeof HousePropertyTypeSchema>;

export const HousePriceIndexObservationSchema = z.object({
  period: IsoMonthSchema,
  geographyCode: z.string().min(1),
  geographyName: z.string().min(1),
  propertyType: HousePropertyTypeSchema,
  averagePrice: z.number().positive().optional(),
  salesVolume: z.number().int().nonnegative().optional(),
  index: z.number().positive(),
  provisional: z.boolean(),
});
export type HousePriceIndexObservation = z.infer<
  typeof HousePriceIndexObservationSchema
>;

export const HousePriceIndexSourceSchema = z.object({
  provider: z.literal("HM Land Registry"),
  dataset: z.literal("UK House Price Index"),
  releasePeriod: IsoMonthSchema,
  publishedAt: z.iso.date(),
  retrievedAt: z.iso.datetime({ offset: true }),
  pageUrl: z.url(),
  downloadUrl: z.url(),
  checksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  rawObjectKey: z.string().min(1),
  licence: z.literal("Open Government Licence v3.0"),
  attribution: z.string().min(1),
});
export type HousePriceIndexSource = z.infer<
  typeof HousePriceIndexSourceSchema
>;

export const HousePriceIndexReleaseSchema = z
  .object({
    versionId: z.string().min(1),
    source: HousePriceIndexSourceSchema,
    observations: z.array(HousePriceIndexObservationSchema).min(1),
  })
  .superRefine((release, context) => {
    const keys = release.observations.map(
      ({ period, geographyCode, propertyType }) =>
        `${period}:${geographyCode}:${propertyType}`,
    );
    if (new Set(keys).size !== keys.length) {
      context.addIssue({
        code: "custom",
        message: "UK HPI observations must have unique series periods",
        path: ["observations"],
      });
    }
  });
export type HousePriceIndexRelease = z.infer<
  typeof HousePriceIndexReleaseSchema
>;

export const HousePriceIndexArchiveSchema = z.object({
  releases: z.array(HousePriceIndexReleaseSchema),
});
export type HousePriceIndexArchive = z.infer<
  typeof HousePriceIndexArchiveSchema
>;
