export function duplicateValues<T>(values: Iterable<T>): T[] {
  const seen = new Set<T>();
  const duplicates = new Set<T>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

export function setsEqual<T>(
  actual: Iterable<T>,
  expected: Iterable<T>,
): boolean {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  return (
    actualSet.size === expectedSet.size &&
    [...actualSet].every((value) => expectedSet.has(value))
  );
}
