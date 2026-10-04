import { describe, expect, it } from "vitest";
import { newAuthoredTermOccurrences } from "../src/authored-terms";

describe("newAuthoredTermOccurrences", () => {
  it("ignores blank and unchanged recipe terms", () => {
    expect(
      newAuthoredTermOccurrences(
        [" salt ", "", "  ", "pepper"],
        ["Salt"],
        "en-IE",
      ),
    ).toEqual(["pepper"]);
  });

  it("preserves only additional repeated occurrences", () => {
    expect(
      newAuthoredTermOccurrences(["wok", "WOK", "wok"], ["wok", "wok"]),
    ).toEqual(["wok"]);
  });
});
