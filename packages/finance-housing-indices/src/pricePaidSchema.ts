import { z } from "zod";
import { IsoMonthSchema } from "./schema";

export const PricePaidPropertyTypeSchema = z.enum([
  "detached",
  "semi-detached",
  "terraced",
  "flat-maisonette",
  "other",
]);
export type PricePaidPropertyType = z.infer<
  typeof PricePaidPropertyTypeSchema
>;

export const PricePaidTenureSchema = z.enum([
  "freehold",
  "leasehold",
  "unknown",
]);
export type PricePaidTenure = z.infer<typeof PricePaidTenureSchema>;

export const PricePaidTransactionSchema = z.object({
  transactionId: z.string().min(1),
  price: z.number().int().positive(),
  completionDate: z.iso.date(),
  postcode: z.string().min(1).optional(),
  propertyType: PricePaidPropertyTypeSchema,
  newBuild: z.boolean(),
  tenure: PricePaidTenureSchema,
  townCity: z.string().min(1),
  district: z.string().min(1).optional(),
  county: z.string().min(1).optional(),
  recordStatus: z.enum(["added", "changed", "deleted"]),
});
export type PricePaidTransaction = z.infer<
  typeof PricePaidTransactionSchema
>;

export const PricePaidSourceSchema = z.object({
  provider: z.literal("HM Land Registry"),
  dataset: z.literal("Price Paid Data"),
  releasePeriod: IsoMonthSchema,
  publishedAt: z.iso.date(),
  retrievedAt: z.iso.datetime({ offset: true }),
  pageUrl: z.url(),
  downloadUrl: z.url(),
  coverage: z.literal("england-and-wales"),
  observedThrough: z.iso.date(),
  latestCompleteMonth: IsoMonthSchema,
  checksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  rawObjectKey: z.string().min(1),
  licence: z.literal("Open Government Licence v3.0"),
  attribution: z.string().min(1),
});
export type PricePaidSource = z.infer<typeof PricePaidSourceSchema>;

export const PricePaidReleaseSchema = z
  .object({
    versionId: z.string().min(1),
    source: PricePaidSourceSchema,
    transactions: z.array(PricePaidTransactionSchema).min(1),
  })
  .superRefine((release, context) => {
    const ids = release.transactions.map(({ transactionId }) => transactionId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        message: "Price Paid Data transactions must have unique IDs",
        path: ["transactions"],
      });
    }
  });
export type PricePaidRelease = z.infer<typeof PricePaidReleaseSchema>;

export const PricePaidArchiveSchema = z.object({
  releases: z.array(PricePaidReleaseSchema),
});
export type PricePaidArchive = z.infer<typeof PricePaidArchiveSchema>;
