import { describe, expect, it } from "vitest";

import { finiteNumber } from "../src/numbers";

describe("finiteNumber", () => {
  it("coerces finite values and uses the fallback otherwise", () => {
    expect(finiteNumber("2.5")).toBe(2.5);
    expect(finiteNumber(null)).toBe(0);
    expect(finiteNumber(Number.POSITIVE_INFINITY, 4)).toBe(4);
    expect(finiteNumber("not-a-number", 3)).toBe(3);
  });
});
