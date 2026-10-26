export interface DatabaseQueryMetrics {
  queryCount: number;
  resultRowCount: number;
  resultBytesEstimated: number;
}

export const createDatabaseQueryMetrics = (): DatabaseQueryMetrics => ({
  queryCount: 0,
  resultRowCount: 0,
  resultBytesEstimated: 0,
});

const textEncoder = new TextEncoder();

const estimatedValueBytes = (
  value: unknown,
  visited: WeakSet<object>,
): number => {
  if (value === null || value === undefined) return 0;
  if (typeof value === "string") return textEncoder.encode(value).byteLength;
  if (
    typeof value === "number" ||
    typeof value === "bigint" ||
    typeof value === "boolean"
  ) {
    return textEncoder.encode(String(value)).byteLength;
  }
  if (value instanceof Date) {
    return textEncoder.encode(value.toISOString()).byteLength;
  }
  if (value instanceof Uint8Array) return value.byteLength;
  if (typeof value !== "object") return 0;
  if (visited.has(value)) return 0;
  visited.add(value);

  if (Array.isArray(value)) {
    return value.reduce(
      (total, item) => total + estimatedValueBytes(item, visited),
      0,
    );
  }
  return Object.entries(value).reduce(
    (total, [key, item]) =>
      total +
      textEncoder.encode(key).byteLength +
      estimatedValueBytes(item, visited),
    0,
  );
};

export const estimateDatabaseResultRowBytes = (
  row: Record<string, unknown>,
): number => estimatedValueBytes(row, new WeakSet());

export const recordDatabaseResultRow = (
  metrics: DatabaseQueryMetrics,
  row: Record<string, unknown>,
): Record<string, unknown> => {
  metrics.resultRowCount += 1;
  metrics.resultBytesEstimated += estimateDatabaseResultRowBytes(row);
  return row;
};
