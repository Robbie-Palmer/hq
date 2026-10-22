import type { z } from "zod";

export function parseContract<T>(
  value: unknown,
  schema: z.ZodType<T>,
  label: string,
): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const details = result.error.issues
    .map((issue) => {
      const field = issue.path.map(String).join(".") || label;
      return `${field}: ${issue.message}`;
    })
    .join("; ");
  throw new Error(`Invalid ${label}: ${details}`);
}
