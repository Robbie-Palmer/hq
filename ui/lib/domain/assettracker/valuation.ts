import { differenceInCalendarDays, parseISO } from "date-fns";
import { z } from "zod";
import { AccountIdSchema } from "./account";
import { type Currency, CurrencySchema } from "./currency";

export const ObservationSourceSchema = z.object({
  kind: z.enum(["manual", "import", "provider", "reference"]),
  id: z.string().min(1),
  label: z.string().min(1).optional(),
});
export type ObservationSource = z.infer<typeof ObservationSourceSchema>;

const TemporalObservationShape = {
  id: z.string().min(1),
  validAt: z.iso.date(),
  acceptedAt: z.iso.datetime({ offset: true }),
  source: ObservationSourceSchema,
  correctsId: z.string().min(1).optional(),
};

export const InstrumentSchema = z.object({
  id: z.string().min(1),
  symbol: z.string().min(1),
  name: z.string().min(1),
  currency: CurrencySchema,
});
export type Instrument = z.infer<typeof InstrumentSchema>;

export const HoldingObservationSchema = z.object({
  ...TemporalObservationShape,
  accountId: AccountIdSchema,
  instrumentId: z.string().min(1),
  quantity: z.number().nonnegative(),
});
export type HoldingObservation = z.infer<typeof HoldingObservationSchema>;

export const PriceObservationSchema = z.object({
  ...TemporalObservationShape,
  instrumentId: z.string().min(1),
  currency: CurrencySchema,
  price: z.number().nonnegative(),
});
export type PriceObservation = z.infer<typeof PriceObservationSchema>;

export const ExchangeRateObservationSchema = z
  .object({
    ...TemporalObservationShape,
    fromCurrency: CurrencySchema,
    toCurrency: CurrencySchema,
    rate: z.number().positive(),
  })
  .refine(
    (observation) => observation.fromCurrency !== observation.toCurrency,
    { message: "Exchange-rate currencies must differ" },
  );
export type ExchangeRateObservation = z.infer<
  typeof ExchangeRateObservationSchema
>;

export type ValuationIssueKind =
  | "missing_price"
  | "stale_price"
  | "missing_exchange_rate"
  | "stale_exchange_rate";

export type ValuationIssue = {
  kind: ValuationIssueKind;
  date: string;
  accountId?: string;
  instrumentId?: string;
  currency?: Currency;
  observedAt?: string;
};

type TemporalObservation = {
  id: string;
  validAt: string;
  acceptedAt: string;
  correctsId?: string;
};

/**
 * Returns records that were known by `asKnownAt`, with accepted corrections
 * replacing the records they name. The result is deterministic for late data:
 * valid time chooses what applied and accepted time chooses what was known.
 */
export function effectiveObservations<T extends TemporalObservation>(
  observations: readonly T[],
  asKnownAt?: string,
): T[] {
  const known = observations
    .filter(
      (observation) => asKnownAt == null || observation.acceptedAt <= asKnownAt,
    )
    .toSorted(
      (a, b) =>
        a.acceptedAt.localeCompare(b.acceptedAt) || a.id.localeCompare(b.id),
    );
  const corrected = new Set(
    known.flatMap((observation) =>
      observation.correctsId == null ? [] : [observation.correctsId],
    ),
  );
  return known.filter((observation) => !corrected.has(observation.id));
}

export function latestObservation<T extends TemporalObservation>(
  observations: readonly T[],
  validAt: string,
  asKnownAt?: string,
): T | null {
  return (
    effectiveObservations(observations, asKnownAt)
      .filter((observation) => observation.validAt <= validAt)
      .toSorted(
        (a, b) =>
          b.validAt.localeCompare(a.validAt) ||
          b.acceptedAt.localeCompare(a.acceptedAt) ||
          b.id.localeCompare(a.id),
      )[0] ?? null
  );
}

export function observationAgeDays(
  observationDate: string,
  valuationDate: string,
): number {
  return differenceInCalendarDays(
    parseISO(valuationDate),
    parseISO(observationDate),
  );
}

export type CurrencyConversion =
  | { status: "ok"; amount: number; rate: number; observationId?: string }
  | { status: "missing" | "stale"; issue: ValuationIssue };

export function convertCurrency(input: {
  amount: number;
  fromCurrency: Currency;
  toCurrency: Currency;
  date: string;
  observations: readonly ExchangeRateObservation[];
  maxAgeDays: number;
  asKnownAt?: string;
}): CurrencyConversion {
  if (input.fromCurrency === input.toCurrency) {
    return { status: "ok", amount: input.amount, rate: 1 };
  }
  const direct = latestObservation(
    input.observations.filter(
      (observation) =>
        observation.fromCurrency === input.fromCurrency &&
        observation.toCurrency === input.toCurrency,
    ),
    input.date,
    input.asKnownAt,
  );
  const inverse = latestObservation(
    input.observations.filter(
      (observation) =>
        observation.fromCurrency === input.toCurrency &&
        observation.toCurrency === input.fromCurrency,
    ),
    input.date,
    input.asKnownAt,
  );
  const observation = [direct, inverse]
    .filter((candidate) => candidate != null)
    .toSorted(
      (a, b) =>
        b.validAt.localeCompare(a.validAt) ||
        b.acceptedAt.localeCompare(a.acceptedAt),
    )[0];
  if (observation == null) {
    return {
      status: "missing",
      issue: {
        kind: "missing_exchange_rate",
        date: input.date,
        currency: input.fromCurrency,
      },
    };
  }
  if (observationAgeDays(observation.validAt, input.date) > input.maxAgeDays) {
    return {
      status: "stale",
      issue: {
        kind: "stale_exchange_rate",
        date: input.date,
        currency: input.fromCurrency,
        observedAt: observation.validAt,
      },
    };
  }
  const rate = observation === direct ? observation.rate : 1 / observation.rate;
  return {
    status: "ok",
    amount: input.amount * rate,
    rate,
    observationId: observation.id,
  };
}
