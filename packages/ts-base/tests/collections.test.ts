import { describe, expect, it } from "vitest";
import { duplicateValues, setsEqual } from "../src/collections";

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
