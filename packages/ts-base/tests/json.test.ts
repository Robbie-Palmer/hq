import { describe, expect, it } from "vitest";
import { canonicalJson, jsonPointer, mapJsonStrings } from "../src/json";

describe("JSON transformations", () => {
  it("maps strings recursively without changing other JSON values", () => {
    expect(
      mapJsonStrings(
        { title: " heading ", rows: [1, " cell ", null] },
        (value) => value.trim(),
      ),
    ).toEqual({ title: "heading", rows: [1, "cell", null] });
  });

  it("encodes an RFC 6901 JSON Pointer", () => {
    expect(jsonPointer(["details", "tax/rate~band", 1])).toBe(
      "/details/tax~1rate~0band/1",
    );
    expect(jsonPointer([])).toBe("");
  });
});

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
