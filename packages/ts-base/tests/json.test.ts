import { describe, expect, it } from "vitest";
import { canonicalJson } from "../src/json";

describe("canonicalJson", () => {
  it.each([
    [null, "null"],
    [true, "true"],
    ["value", '"value"'],
    [42, "42"],
  ])("encodes JSON primitive %#", (value, expected) => {
    expect(canonicalJson(value)).toBe(expected);
  });

  it("sorts object keys while preserving array order", () => {
    expect(canonicalJson({ z: 1, a: { y: 2, b: [3, 1] } })).toBe(
      '{"a":{"b":[3,1],"y":2},"z":1}',
    );
  });

  it.each([
    [{ missing: undefined }, "undefined"],
    [Number.NaN, "non-finite"],
    [new Date(), "plain objects"],
    [Symbol("unsupported"), "symbol"],
  ])("rejects unsupported input %#", (value, message) => {
    expect(() => canonicalJson(value)).toThrow(message);
  });
});
