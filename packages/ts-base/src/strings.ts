export const isNonBlankString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

export const compareStrings = (left: string, right: string): number => {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
};

export const normalizeWhitespace = (value: string): string =>
  value.trim().replaceAll(/\s+/g, " ");

export function truncateWithEllipsis(
  value: string,
  maxLength: number,
  ellipsis = "...",
): string {
  if (!Number.isSafeInteger(maxLength) || maxLength < ellipsis.length) {
    throw new RangeError("maxLength must fit the ellipsis");
  }
  return value.length <= maxLength
    ? value
    : `${value.slice(0, maxLength - ellipsis.length)}${ellipsis}`;
}

export function primitiveString(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  return fallback;
}

export function uniqueCsv(
  value: string | undefined,
  fallback: string[],
): string[] {
  const values = value
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return values?.length ? [...new Set(values)] : fallback;
}
