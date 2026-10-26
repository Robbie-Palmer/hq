import { describe, expect, it } from "vitest";
import { DisjointSet, duplicateValues, setsEqual } from "../src/collections";

describe("duplicateValues", () => {
  it("returns each duplicate once in its first duplicate position", () => {
    expect(duplicateValues(["beta", "alpha", "beta", "alpha", "beta"])).toEqual([
      "beta",
      "alpha",
    ]);
  });

  it("supports non-string values with Set equality", () => {
    const shared = { id: 1 };

    expect(duplicateValues([shared, { id: 1 }, shared])).toEqual([shared]);
  });
});

describe("setsEqual", () => {
  it("ignores order and repeated input values", () => {
    expect(setsEqual(["alpha", "beta", "alpha"], ["beta", "alpha"])).toBe(
      true,
    );
  });

  it("rejects sets with different values", () => {
    expect(setsEqual(["alpha", "beta"], ["alpha", "gamma"])).toBe(false);
  });
});

describe("DisjointSet", () => {
  it("collects connected values and compresses transitive groups", () => {
    const values = new DisjointSet(["a", "b", "c", "d"]);
    values.union("a", "b").union("c", "d").union("b", "c");

    expect(values.groups()).toEqual([["a", "b", "c", "d"]]);
    expect(values.find("d")).toBe(values.find("a"));
  });

  it("keeps singletons and rejects unknown values", () => {
    const values = new DisjointSet(["known", "alone"]);

    expect(values.groups()).toEqual([["known"], ["alone"]]);
    expect(values.has("missing")).toBe(false);
    expect(() => values.union("known", "missing")).toThrow(
      "not in the disjoint set",
    );
  });
});
