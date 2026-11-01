import { z } from "zod";

import rawDataset from "../artifacts/iso-codes-2026-11-01.json";

const IsoSourceSchema = z.object({
  standard: z.string().min(1),
  publisher: z.string().min(1),
  url: z.url(),
  standardUrl: z.url(),
  sourceRevision: z.string().min(1).optional(),
  retrievedOn: z.iso.date(),
  note: z.string().min(1).optional(),
});

const sortedUniqueCodeArray = (pattern: RegExp, label: string) =>
  z
    .array(z.string().regex(pattern))
    .min(1)
    .superRefine((codes, context) => {
      const expected = [...new Set(codes)].sort();
      if (
        expected.length !== codes.length ||
        expected.some((code, index) => code !== codes[index])
      ) {
        context.addIssue({
          code: "custom",
          message: `${label} must be sorted and contain no duplicates`,
        });
      }
    });

const IsoCodeDatasetSchema = z.object({
  schemaVersion: z.literal(1),
  datasetVersion: z.iso.date(),
  sources: z.object({
    countries: IsoSourceSchema,
    currencies: IsoSourceSchema,
  }),
  countryAlpha2Codes: sortedUniqueCodeArray(
    /^[A-Z]{2}$/,
    "ISO 3166-1 alpha-2 codes",
  ),
  currencyAlphabeticCodes: sortedUniqueCodeArray(
    /^[A-Z]{3}$/,
    "ISO 4217 alphabetic codes",
  ),
});

const dataset = IsoCodeDatasetSchema.parse(rawDataset);
const countryCodeSet = new Set(dataset.countryAlpha2Codes);
const currencyCodeSet = new Set(dataset.currencyAlphabeticCodes);

export const ISO_CODE_DATASET_METADATA = Object.freeze({
  schemaVersion: dataset.schemaVersion,
  datasetVersion: dataset.datasetVersion,
  sources: dataset.sources,
});

export const ISO_3166_ALPHA_2_CODES = Object.freeze([
  ...dataset.countryAlpha2Codes,
]);

export const ISO_4217_ALPHABETIC_CODES = Object.freeze([
  ...dataset.currencyAlphabeticCodes,
]);

export const CountryCodeSchema = z
  .string()
  .refine((code) => countryCodeSet.has(code), {
    message: "Expected a currently assigned ISO 3166-1 alpha-2 code",
  })
  .brand<"Iso3166Alpha2">();

export type CountryCode = z.infer<typeof CountryCodeSchema>;

export const CurrencyCodeSchema = z
  .string()
  .refine((code) => currencyCodeSet.has(code), {
    message: "Expected a current ISO 4217 List One alphabetic code",
  })
  .brand<"Iso4217Alphabetic">();

export type CurrencyCode = z.infer<typeof CurrencyCodeSchema>;

export const isCountryCode = (value: unknown): value is CountryCode =>
  CountryCodeSchema.safeParse(value).success;

export const isCurrencyCode = (value: unknown): value is CurrencyCode =>
  CurrencyCodeSchema.safeParse(value).success;

export const parseCountryCode = (value: unknown): CountryCode =>
  CountryCodeSchema.parse(value);

export const parseCurrencyCode = (value: unknown): CurrencyCode =>
  CurrencyCodeSchema.parse(value);
