import { describe, expect, it } from "vitest";
import { ENGLISH_MONTH_ABBREVIATIONS } from "../src/dates";

describe("date constants", () => {
  it("lists English month abbreviations in calendar order", () => {
    expect(ENGLISH_MONTH_ABBREVIATIONS).toEqual([
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ]);
  });
});
