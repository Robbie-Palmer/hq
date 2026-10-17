const safeErrorFields = [
  "name",
  "message",
  "code",
  "hint",
  "schema",
  "table",
  "column",
  "constraint",
  "routine",
] as const;

type SafeErrorField = (typeof safeErrorFields)[number];
type SafeErrorDetails = Partial<Record<SafeErrorField, string>>;

export function safeMigrationErrorChain(error: unknown): SafeErrorDetails[] {
  const chain: SafeErrorDetails[] = [];
  const seen = new Set<object>();
  let current: unknown = error;

  while (typeof current === "object" && current !== null && !seen.has(current)) {
    seen.add(current);

    const record = current as Record<string, unknown>;
    const details = Object.fromEntries(
      safeErrorFields.flatMap((field) =>
        typeof record[field] === "string" ? [[field, record[field]]] : [],
      ),
    );
    if (Object.keys(details).length > 0) {
      chain.push(details);
    }
    current = record.cause;
  }

  return chain;
}
