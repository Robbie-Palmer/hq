import Decimal from "decimal.js";

const MAX_DECIMAL_PLACES = 18;
const ExchangeRateDecimal = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -100,
  toExpPos: 100,
});

function parseExchangeRate(value: string): Decimal {
  let rate: Decimal;
  try {
    rate = new ExchangeRateDecimal(value);
  } catch {
    throw new TypeError(`Invalid positive decimal rate "${value}"`);
  }

  if (!rate.isFinite()) {
    throw new TypeError(`Invalid positive decimal rate "${value}"`);
  }
  if (rate.lte(0)) {
    throw new TypeError("Exchange rates must be positive");
  }
  return rate;
}

function formatExchangeRate(rate: Decimal): string {
  return rate
    .toDecimalPlaces(MAX_DECIMAL_PLACES, Decimal.ROUND_HALF_UP)
    .toFixed();
}

export function invertExchangeRate(rate: string): string {
  return formatExchangeRate(
    new ExchangeRateDecimal(1).div(parseExchangeRate(rate)),
  );
}

export function triangulateExchangeRates(
  firstRate: string,
  secondRate: string,
): string {
  return formatExchangeRate(
    parseExchangeRate(firstRate).mul(parseExchangeRate(secondRate)),
  );
}
