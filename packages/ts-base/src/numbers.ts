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
  const denominator = 10n ** BigInt(decimal.length);
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
  if (right.numerator === 0n) throw new RangeError("Cannot divide by zero");
  const sign = right.numerator < 0n ? -1n : 1n;
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
  if (value.denominator <= 0n) {
    throw new RangeError("Fraction denominator must be greater than zero");
  }

  const negative = value.numerator < 0n;
  const numerator = negative ? -value.numerator : value.numerator;
  const scale = 10n ** BigInt(decimalPlaces);
  const rounded =
    (numerator * scale * 2n + value.denominator) /
    (value.denominator * 2n);
  const whole = rounded / scale;
  const prefix = negative && rounded !== 0n ? "-" : "";
  if (decimalPlaces === 0) return `${prefix}${whole}`;
  const remainder = (rounded % scale)
    .toString()
    .padStart(decimalPlaces, "0")
    .replace(/0+$/, "");
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
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}
