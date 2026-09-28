export const isNonBlankString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

export const compareStrings = (left: string, right: string): number => {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
};

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
