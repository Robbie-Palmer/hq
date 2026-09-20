export const isNonBlankString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

export const compareStrings = (left: string, right: string): number => {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
};
