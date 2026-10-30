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

/**
 * Move items with selected keys first while preserving order within both
 * groups.
 */
export function prioritiseSelected<T>(
  items: T[],
  selectedKeys: string[],
  getKey: (item: T) => string,
): T[] {
  if (selectedKeys.length === 0) return items;
  const selectedKeySet = new Set(selectedKeys);
  const selected: T[] = [];
  const unselected: T[] = [];
  for (const item of items) {
    (selectedKeySet.has(getKey(item)) ? selected : unselected).push(item);
  }
  return [...selected, ...unselected];
}

export class DisjointSet<T> {
  readonly #parents = new Map<T, T>();
  readonly #ranks = new Map<T, number>();

  constructor(values: Iterable<T> = []) {
    for (const value of values) this.add(value);
  }

  add(value: T): this {
    if (!this.#parents.has(value)) {
      this.#parents.set(value, value);
      this.#ranks.set(value, 0);
    }
    return this;
  }

  has(value: T): boolean {
    return this.#parents.has(value);
  }

  find(value: T): T {
    if (!this.#parents.has(value))
      throw new Error("Cannot find a value that is not in the disjoint set");
    const parent = this.#parents.get(value) as T;
    if (Object.is(parent, value)) return value;
    const root = this.find(parent);
    this.#parents.set(value, root);
    return root;
  }

  union(first: T, second: T): this {
    const firstRoot = this.find(first);
    const secondRoot = this.find(second);
    if (Object.is(firstRoot, secondRoot)) return this;
    const firstRank = this.#ranks.get(firstRoot) ?? 0;
    const secondRank = this.#ranks.get(secondRoot) ?? 0;
    if (firstRank < secondRank) this.#parents.set(firstRoot, secondRoot);
    else {
      this.#parents.set(secondRoot, firstRoot);
      if (firstRank === secondRank) this.#ranks.set(firstRoot, firstRank + 1);
    }
    return this;
  }

  groups(): T[][] {
    const groups = new Map<T, T[]>();
    for (const value of this.#parents.keys()) {
      const root = this.find(value);
      groups.set(root, [...(groups.get(root) ?? []), value]);
    }
    return [...groups.values()];
  }
}
