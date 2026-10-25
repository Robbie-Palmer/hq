export function finiteNumber(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export type Fraction = { numerator: bigint; denominator: bigint };

/** Parse a plain decimal string without passing through floating-point math. */
export function decimalFraction(value: string): Fraction {
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
    throw new TypeError(`Invalid decimal: ${value}`);
  }
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole = "0", decimal = ""] = unsigned.split(".");
  const denominator = BigInt(10) ** BigInt(decimal.length);
  const numerator = BigInt(`${whole}${decimal}`);
  return { numerator: negative ? -numerator : numerator, denominator };
}

export function multiplyFractions(
  left: Fraction,
  right: Fraction,
): Fraction {
  return {
    numerator: left.numerator * right.numerator,
    denominator: left.denominator * right.denominator,
  };
}

export function divideFractions(left: Fraction, right: Fraction): Fraction {
  if (right.numerator === BigInt(0)) {
    throw new RangeError("Cannot divide by zero");
  }
  const sign = right.numerator < BigInt(0) ? -BigInt(1) : BigInt(1);
  return {
    numerator: left.numerator * right.denominator * sign,
    denominator: left.denominator * right.numerator * sign,
  };
}

/** Format a fraction as a decimal, rounding halves away from zero. */
export function formatFraction(
  value: Fraction,
  decimalPlaces: number,
): string {
  if (
    !Number.isInteger(decimalPlaces) ||
    decimalPlaces < 0 ||
    decimalPlaces > 12
  ) {
    throw new RangeError("decimalPlaces must be an integer from 0 to 12");
  }
  if (value.denominator <= BigInt(0)) {
    throw new RangeError("Fraction denominator must be greater than zero");
  }

  const negative = value.numerator < BigInt(0);
  const numerator = negative ? -value.numerator : value.numerator;
  const scale = BigInt(10) ** BigInt(decimalPlaces);
  const rounded =
    (numerator * scale * BigInt(2) + value.denominator) /
    (value.denominator * BigInt(2));
  const whole = rounded / scale;
  const prefix = negative && rounded !== BigInt(0) ? "-" : "";
  if (decimalPlaces === 0) return `${prefix}${whole}`;
  let remainder = (rounded % scale)
    .toString()
    .padStart(decimalPlaces, "0");
  while (remainder.endsWith("0")) remainder = remainder.slice(0, -1);
  return remainder
    ? `${prefix}${whole}.${remainder}`
    : `${prefix}${whole}`;
}

export function compareDecimals(left: string, right: string): number {
  const leftFraction = decimalFraction(left);
  const rightFraction = decimalFraction(right);
  const difference =
    leftFraction.numerator * rightFraction.denominator -
    rightFraction.numerator * leftFraction.denominator;
  if (difference < BigInt(0)) return -1;
  if (difference > BigInt(0)) return 1;
  return 0;
}
